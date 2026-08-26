param(
    [ValidateSet('Inspect', 'RunRoutines', 'Download', 'RemoveModule')]
    [string]$Action = 'Inspect',
    [string]$ControllerName = 'Controller1',
    [string]$TaskName = 'T_ROB1',
    [string]$ModulePath,
    [string]$ModuleName,
    [string[]]$Routines = @(),
    [string[]]$DownloadFiles = @(),
    [string]$OutputDirectory,
    [string]$Username = 'Default User',
    [string]$Password = 'robotics',
    [int]$RwsPort = 0,
    [int]$TimeoutSeconds = 30,
    [int]$EventLimit = 100,
    [switch]$CaptureMotionSamples,
    [ValidateRange(5, 1000)]
    [int]$SampleIntervalMs = 10,
    [switch]$AllowControllerMutation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $OutputDirectory) {
    $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputDirectory = Join-Path (Get-Location) ".scratch/robotstudio-oracle/$runStamp"
}
$resolvedOutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force | Out-Null

function Resolve-PcSdkPath {
    $candidates = [System.Collections.Generic.List[string]]::new()
    $candidates.Add('D:\abb\Bin-net48\ABB.Robotics.Controllers.PC.dll')
    $candidates.Add('D:\abb\Bin\ABB.Robotics.Controllers.PC.dll')

    Get-Process -Name RobotStudio -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Path) {
            $binPath = Split-Path -Parent $_.Path
            $installPath = Split-Path -Parent $binPath
            $candidates.Add((Join-Path $installPath 'Bin-net48\ABB.Robotics.Controllers.PC.dll'))
            $candidates.Add((Join-Path $installPath 'Bin\ABB.Robotics.Controllers.PC.dll'))
        }
    }

    $resolved = $candidates | Select-Object -Unique | Where-Object {
        Test-Path -LiteralPath $_
    } | Select-Object -First 1
    if (-not $resolved) {
        throw 'ABB.Robotics.Controllers.PC.dll was not found.'
    }
    return $resolved
}

function Invoke-RwsGet {
    param([string]$Url)

    $response = & curl.exe --silent --show-error --fail --digest `
        --user "$Username`:$Password" `
        --header 'Accept: application/hal+json;v=2.0' `
        $Url 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "RWS GET failed for $Url with curl exit code $LASTEXITCODE."
    }
    return ($response -join "`n")
}

function Test-RwsPort {
    param([int]$Port)

    try {
        $json = Invoke-RwsGet -Url "http://127.0.0.1:$Port/rw/system?json=1"
        $system = $json | ConvertFrom-Json
        $systemState = @($system._embedded._state) | Where-Object {
            $_._type -eq 'sys-system-li' -and $_.name -eq $ControllerName
        } | Select-Object -First 1
        if ($systemState) {
            return [pscustomobject]@{
                Port = $Port
                System = $systemState
            }
        }
    }
    catch {
        return $null
    }
    return $null
}

function Resolve-RwsEndpoint {
    if ($RwsPort -gt 0) {
        $match = Test-RwsPort -Port $RwsPort
        if (-not $match) {
            throw "Port $RwsPort is not the RWS endpoint for $ControllerName."
        }
        return $match
    }

    $robVcIds = @(Get-Process -Name RobVC -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    if ($robVcIds.Count -eq 0) {
        throw 'No RobVC process is running.'
    }
    $candidatePorts = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.OwningProcess -in $robVcIds } |
        Select-Object -ExpandProperty LocalPort -Unique)

    $matches = @($candidatePorts | ForEach-Object { Test-RwsPort -Port $_ } | Where-Object { $_ })
    if ($matches.Count -ne 1) {
        throw "Expected one RWS endpoint for $ControllerName, found $($matches.Count)."
    }
    return $matches[0]
}

function Get-EventLog {
    param([int]$Port)

    $json = Invoke-RwsGet -Url "http://127.0.0.1:$Port/rw/elog/0?json=1&limit=$EventLimit"
    $eventData = $json | ConvertFrom-Json
    return @($eventData._embedded._state | ForEach-Object {
        # RobotWare 的部分事件没有 argv；StrictMode 下直接读取缺失属性会让只读预检失败。
        $arguments = @()
        $argvProperty = $_.PSObject.Properties['argv']
        if ($argvProperty -and $null -ne $argvProperty.Value) {
            $valueProperty = $argvProperty.Value.PSObject.Properties['value']
            if ($valueProperty) {
                $arguments = @($valueProperty.Value)
            }
        }
        [pscustomobject]@{
            timestamp = $_.tstamp
            code = $_.code
            message_type = $_.msgtype
            source = $_.'src-name'
            arguments = $arguments
        }
    })
}

function Invoke-WithRapidMastership {
    param(
        [ABB.Robotics.Controllers.Controller]$Controller,
        [scriptblock]$Operation
    )

    $mastership = [ABB.Robotics.Controllers.Mastership]::Request($Controller.Rapid)
    try {
        return (& $Operation)
    }
    finally {
        $mastership.Dispose()
    }
}

function Wait-ForRapidStop {
    param(
        [ABB.Robotics.Controllers.Controller]$Controller,
        [int]$Timeout
    )

    Start-Sleep -Milliseconds 150
    $deadline = [DateTime]::UtcNow.AddSeconds($Timeout)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Controller.Rapid.ExecutionStatus -eq
            [ABB.Robotics.Controllers.RapidDomain.ExecutionStatus]::Stopped) {
            return 'Stopped'
        }
        Start-Sleep -Milliseconds 200
    }
    return 'Timeout'
}

function Capture-MotionSamplesUntilStop {
    param(
        [ABB.Robotics.Controllers.Controller]$Controller,
        [ABB.Robotics.Controllers.RapidDomain.Task]$Task,
        [string]$Destination,
        [int]$Timeout,
        [int]$IntervalMs
    )

    $units = @($Controller.MotionSystem.MechanicalUnits | Where-Object {
        $_.Task -and $_.Task.Name -eq $Task.Name
    })
    if ($units.Count -ne 1) {
        throw "Expected one mechanical unit for task $($Task.Name), found $($units.Count)."
    }
    $unit = $units[0]
    $culture = [Globalization.CultureInfo]::InvariantCulture
    $encoding = [Text.UTF8Encoding]::new($false)
    $writer = [IO.StreamWriter]::new($Destination, $false, $encoding)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $deadline = [DateTime]::UtcNow.AddSeconds($Timeout)
    $sampleCount = 0
    try {
        $writer.WriteLine('sample_index,joint_read_ms,pose_read_ms,j1,j2,j3,j4,j5,j6,x,y,z,q1,q2,q3,q4,cf1,cf4,cf6,cfx')
        while ([DateTime]::UtcNow -lt $deadline) {
            $jointTarget = $unit.GetPosition()
            $jointReadMs = $clock.Elapsed.TotalMilliseconds
            $robTarget = $unit.GetPosition(
                [ABB.Robotics.Controllers.MotionDomain.CoordinateSystemType]::Base)
            $poseReadMs = $clock.Elapsed.TotalMilliseconds
            $values = @(
                $sampleCount,
                $jointReadMs.ToString('F3', $culture),
                $poseReadMs.ToString('F3', $culture),
                $jointTarget.RobAx.Rax_1.ToString('F6', $culture),
                $jointTarget.RobAx.Rax_2.ToString('F6', $culture),
                $jointTarget.RobAx.Rax_3.ToString('F6', $culture),
                $jointTarget.RobAx.Rax_4.ToString('F6', $culture),
                $jointTarget.RobAx.Rax_5.ToString('F6', $culture),
                $jointTarget.RobAx.Rax_6.ToString('F6', $culture),
                $robTarget.Trans.X.ToString('F6', $culture),
                $robTarget.Trans.Y.ToString('F6', $culture),
                $robTarget.Trans.Z.ToString('F6', $culture),
                $robTarget.Rot.Q1.ToString('F9', $culture),
                $robTarget.Rot.Q2.ToString('F9', $culture),
                $robTarget.Rot.Q3.ToString('F9', $culture),
                $robTarget.Rot.Q4.ToString('F9', $culture),
                $robTarget.Robconf.Cf1,
                $robTarget.Robconf.Cf4,
                $robTarget.Robconf.Cf6,
                $robTarget.Robconf.Cfx
            )
            $writer.WriteLine(($values -join ','))
            $sampleCount += 1
            if ($Controller.Rapid.ExecutionStatus -eq
                [ABB.Robotics.Controllers.RapidDomain.ExecutionStatus]::Stopped) {
                return [pscustomobject]@{ Status = 'Stopped'; Count = $sampleCount }
            }
            Start-Sleep -Milliseconds $IntervalMs
        }
        return [pscustomobject]@{ Status = 'Timeout'; Count = $sampleCount }
    }
    finally {
        $clock.Stop()
        $writer.Dispose()
    }
}

function Get-ModuleNameFromSource {
    param([string]$SourcePath)

    $source = Get-Content -LiteralPath $SourcePath -Raw
    $match = [regex]::Match($source, '(?im)^\s*MODULE\s+([A-Za-z_][A-Za-z0-9_]*)')
    if (-not $match.Success) {
        throw "No RAPID MODULE declaration found in $SourcePath."
    }
    return $match.Groups[1].Value
}

$sdkPath = Resolve-PcSdkPath
Add-Type -Path $sdkPath
$rws = Resolve-RwsEndpoint
$rwsBase = "http://127.0.0.1:$($rws.Port)"

$scanner = [ABB.Robotics.Controllers.Discovery.NetworkScanner]::new()
$scanner.Scan()
$controllerMatches = @($scanner.Controllers | Where-Object {
    $_.SystemName -eq $ControllerName -and $_.IsVirtual
})
if ($controllerMatches.Count -ne 1) {
    throw "Expected exactly one virtual $ControllerName, found $($controllerMatches.Count)."
}

$controller = [ABB.Robotics.Controllers.ControllerFactory]::CreateFrom($controllerMatches[0])
$runResults = [System.Collections.Generic.List[object]]::new()

try {
    $controller.Logon([ABB.Robotics.Controllers.UserInfo]::DefaultUser)
    if (-not $controller.IsVirtual -or $controller.SystemName -ne $ControllerName) {
        throw 'Controller safety check failed.'
    }

    $task = $controller.Rapid.GetTask($TaskName)
    if (-not $task) {
        throw "Task $TaskName was not found."
    }

    $inspection = [pscustomobject]@{
        captured_at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        controller = $controller.SystemName
        system_id = $controller.SystemId
        is_virtual = $controller.IsVirtual
        robotware = $controller.RobotWareVersion.ToString()
        operating_mode = $controller.OperatingMode.ToString()
        controller_state = $controller.State.ToString()
        rapid_status = $controller.Rapid.ExecutionStatus.ToString()
        task = $TaskName
        task_status = $task.ExecutionStatus.ToString()
        modules = @($task.GetModules().Name)
        rws_port = $rws.Port
        sdk_path = $sdkPath
    }
    $inspection | ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath (Join-Path $resolvedOutputDirectory 'inspection.json') -Encoding UTF8
    Get-EventLog -Port $rws.Port | ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath (Join-Path $resolvedOutputDirectory 'events-before.json') -Encoding UTF8

    if ($Action -eq 'Inspect') {
        $inspection | Format-List
        exit 0
    }

    if ($Action -eq 'Download') {
        if ($DownloadFiles.Count -eq 0) {
            throw 'Download requires at least one -DownloadFiles value.'
        }
        foreach ($fileName in $DownloadFiles) {
            if ([IO.Path]::GetFileName($fileName) -ne $fileName) {
                throw "Download file must be a controller HOME filename: $fileName"
            }
            $encodedName = [Uri]::EscapeDataString($fileName)
            $destination = Join-Path $resolvedOutputDirectory $fileName
            & curl.exe --silent --show-error --fail --digest `
                --user "$Username`:$Password" `
                --output $destination `
                "$rwsBase/fileservice/%24home/$encodedName"
            if ($LASTEXITCODE -ne 0) {
                throw "Download failed for $fileName with curl exit code $LASTEXITCODE."
            }
        }
        exit 0
    }

    if (-not $AllowControllerMutation) {
        throw 'RunRoutines requires -AllowControllerMutation after explicit user authorization.'
    }
    if ($controller.OperatingMode.ToString() -ne 'Auto') {
        throw "Controller must be Auto; current mode is $($controller.OperatingMode)."
    }
    if ($controller.Rapid.ExecutionStatus -ne
        [ABB.Robotics.Controllers.RapidDomain.ExecutionStatus]::Stopped) {
        throw "RAPID must be Stopped; current state is $($controller.Rapid.ExecutionStatus)."
    }
    if ($Action -eq 'RemoveModule') {
        if (-not $ModuleName) {
            throw 'RemoveModule requires -ModuleName.'
        }
        Invoke-WithRapidMastership -Controller $controller -Operation {
            $matchingModules = @($task.GetModules() | Where-Object { $_.Name -eq $ModuleName })
            if ($matchingModules.Count -gt 1) {
                throw "Expected at most one $ModuleName module, found $($matchingModules.Count)."
            }
            if ($matchingModules.Count -eq 1) {
                $task.DeleteModule($ModuleName)
            }
        } | Out-Null
        [pscustomobject]@{
            removed_module = $ModuleName
            remaining_modules = @($task.GetModules().Name)
        } | Format-List
        exit 0
    }
    if (-not $ModulePath -or -not (Test-Path -LiteralPath $ModulePath)) {
        throw 'RunRoutines requires an existing -ModulePath.'
    }
    if ($Routines.Count -eq 0) {
        throw 'RunRoutines requires at least one public parameterless routine.'
    }

    $resolvedModulePath = (Resolve-Path -LiteralPath $ModulePath).Path
    if (-not $ModuleName) {
        $ModuleName = Get-ModuleNameFromSource -SourcePath $resolvedModulePath
    }
    $remoteFileName = [IO.Path]::GetFileName($resolvedModulePath)
    $encodedRemoteFileName = [Uri]::EscapeDataString($remoteFileName)
    $remoteModulePath = "HOME:/$remoteFileName"

    & curl.exe --silent --show-error --fail --digest `
        --user "$Username`:$Password" `
        --data-binary "@$resolvedModulePath" `
        --request PUT `
        "$rwsBase/fileservice/%24home/$encodedRemoteFileName"
    if ($LASTEXITCODE -ne 0) {
        throw "RWS upload failed with curl exit code $LASTEXITCODE."
    }

    Invoke-WithRapidMastership -Controller $controller -Operation {
        $existingModules = @($task.GetModules() | Where-Object { $_.Name -eq $ModuleName })
        if ($existingModules.Count -gt 1) {
            throw "Expected at most one $ModuleName module, found $($existingModules.Count)."
        }
        if ($existingModules.Count -eq 1) {
            $task.DeleteModule($ModuleName)
        }
        $loadAccepted = $task.LoadModuleFromFile(
            $remoteModulePath,
            [ABB.Robotics.Controllers.RapidDomain.RapidLoadMode]::Add)
        $check = $task.CheckProgram()
        if ($check.Errors.Count -gt 0) {
            $messages = $check.Errors | ForEach-Object {
                "$($_.TaskName)/$($_.ModuleName):$($_.Line):$($_.Column)"
            }
            throw "RAPID check failed:`n$($messages -join "`n")"
        }
        if (-not $loadAccepted) {
            throw "Controller rejected module $ModuleName without a CheckProgram diagnostic."
        }
    } | Out-Null

    foreach ($routine in $Routines) {
        if ($controller.State -ne [ABB.Robotics.Controllers.ControllerState]::MotorsOn) {
            $controller.State = [ABB.Robotics.Controllers.ControllerState]::MotorsOn
        }

        Invoke-WithRapidMastership -Controller $controller -Operation {
            $task.ResetProgramPointer()
            $task.SetProgramPointer($ModuleName, $routine)
        } | Out-Null

        $startedAt = Get-Date
        $startResult = Invoke-WithRapidMastership -Controller $controller -Operation {
            $controller.Rapid.Start(
                [ABB.Robotics.Controllers.RapidDomain.RegainMode]::Clear,
                [ABB.Robotics.Controllers.RapidDomain.ExecutionMode]::Continuous,
                [ABB.Robotics.Controllers.RapidDomain.ExecutionCycle]::Once,
                [ABB.Robotics.Controllers.RapidDomain.StartCheck]::None
            )
        }

        $sampleResult = $null
        $sampleFile = $null
        if ($startResult -eq [ABB.Robotics.Controllers.RapidDomain.StartResult]::Ok) {
            if ($CaptureMotionSamples) {
                $sampleFile = "samples-$routine.csv"
                $sampleResult = Capture-MotionSamplesUntilStop `
                    -Controller $controller `
                    -Task $task `
                    -Destination (Join-Path $resolvedOutputDirectory $sampleFile) `
                    -Timeout $TimeoutSeconds `
                    -IntervalMs $SampleIntervalMs
                $terminalStatus = $sampleResult.Status
            }
            else {
                $terminalStatus = Wait-ForRapidStop -Controller $controller -Timeout $TimeoutSeconds
            }
        }
        else {
            $terminalStatus = 'StartRejected'
        }

        if ($terminalStatus -eq 'Timeout') {
            Invoke-WithRapidMastership -Controller $controller -Operation {
                $controller.Rapid.Stop()
            } | Out-Null
        }

        $events = Get-EventLog -Port $rws.Port
        $routineEvents = @($events | Where-Object {
            [datetime]::Parse($_.timestamp.Replace(' T ', ' ')) -ge $startedAt.AddSeconds(-1)
        })
        $routineEvents | ConvertTo-Json -Depth 6 |
            Set-Content -LiteralPath (Join-Path $resolvedOutputDirectory "events-$routine.json") -Encoding UTF8

        $runResults.Add([pscustomobject]@{
            routine = $routine
            started_at = $startedAt.ToString('yyyy-MM-dd HH:mm:ss')
            start_result = $startResult.ToString()
            rapid_status = $terminalStatus
            controller_state = $controller.State.ToString()
            event_codes = @($routineEvents.code)
            sample_file = $sampleFile
            sample_count = if ($sampleResult) { $sampleResult.Count } else { 0 }
            requested_sample_interval_ms = if ($CaptureMotionSamples) { $SampleIntervalMs } else { $null }
        })
    }

    $runResults | ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath (Join-Path $resolvedOutputDirectory 'manifest.json') -Encoding UTF8
    Get-EventLog -Port $rws.Port | ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath (Join-Path $resolvedOutputDirectory 'events-after.json') -Encoding UTF8
    $runResults | Format-Table -AutoSize
}
finally {
    if ($controller) {
        $controller.Logoff()
        $controller.Dispose()
    }
}
