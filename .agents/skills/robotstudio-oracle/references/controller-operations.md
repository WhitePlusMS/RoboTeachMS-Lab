# Controller operations

Read this reference for discovery, file transfer, module loading, execution, recovery, or event-log work.

## Proven local stack

- RobotStudio: discover from the running `RobotStudio.exe`; the validated installation is `D:\abb`.
- PC SDK: prefer `D:\abb\Bin-net48\ABB.Robotics.Controllers.PC.dll`, then `D:\abb\Bin\ABB.Robotics.Controllers.PC.dll`.
- Controller discovery: `ABB.Robotics.Controllers.Discovery.NetworkScanner`.
- RWS authentication for a default virtual controller: Digest, user `Default User`, password `robotics`; parameters override both values.
- RWS port: discover listeners owned by `RobVC.exe`, query `/rw/system?json=1`, and accept only the endpoint whose returned system name matches the requested controller.

## Mutation sequence

1. Discover exactly one named virtual controller and verify Auto, MotorsOn, and RAPID Stopped.
2. Validate the local RAPID source before mutation: use ASCII identifiers/comments for RobotWare 6, include an empty public parameterless `main`, and begin with built-in data such as `fine` or `z10`.
3. Upload the local module with RWS `PUT /fileservice/$home/{file}` before touching the loaded module.
4. Request RAPID mastership.
5. Verify at most one loaded module with the requested module name; delete it, then load the uploaded controller path with `RapidLoadMode.Add`.
6. Run `Task.CheckProgram` under mastership and stop on every error.
7. For each parameterless routine: reset the task program pointer, set it to the routine, and call controller-level `Rapid.Start` under mastership with `RegainMode.Clear`, `ExecutionMode.Continuous`, `ExecutionCycle.Once`, and `StartCheck.None`.
8. Wait for RAPID Stopped, preserve the event-log interval, then reset before the next routine.
9. Remove the temporary module by exact name, then run a final `Inspect` and compare the module set with preflight.

`StartCheck.None` is intentional: independent service routines are not legal `main` call-chain entry points. Controller-level `Rapid.Start` matches RobotStudio's global Start button for the enabled motion task.

## Known failures and their meaning

| Signal | Meaning | Correct response |
|---|---|---|
| `C0049003` ambiguous module name | PC SDK `Replace` could not resolve a same-name module | Upload first, verify uniqueness, delete explicitly, load with `Add` |
| `C004A00C` file not found | `LoadModuleFromFile` received a Windows path | Upload via RWS and pass `HOME:/file.mod` |
| PC SDK `FileSystem.PutFile` generic exception | File transfer incompatibility in the validated RW 6.16 build | Use official RWS file upload |
| Inspect fails under PowerShell StrictMode while reading event `argv` | Some valid RobotWare event entries omit `argv` or its nested `value` | Treat event arguments as optional; the helper records `[]` while preserving timestamp, code, type, and source |
| `CheckProgram` points at a line containing non-ASCII source text on RW 6.16 | The validated RobotWare 6 source path rejected the non-ASCII comment before execution | Use ASCII module names, identifiers, and comments in oracle fixtures; retry the unchanged experiment logic |
| `C0049000` from `ResetProgramPointer` before a routine starts | The experiment module has no task entry routine named `main` | Add `PROC main() ENDPROC`; keep experiment cases as separate public parameterless routines |
| `CheckProgram` rejects a custom record declaration | A source declaration or controller/version constraint is unresolved; the line location alone does not prove a semantic rule | First prove the pipeline with system data, isolate the declaration in a minimal module, and obtain a diagnostic before documenting a custom literal |
| Need to capture manual Jog but only PC SDK is available | The validated `MechanicalUnit` API reads joint/robot positions but does not expose a public Jog-write command | Use the interactive RobotStudio/Virtual FlexPendant path and label it manual; otherwise run a separate RAPID oracle and label it RAPID, never interchange the two |
| Virtual FlexPendant Jogging remains on the RobotWare splash screen | The interactive TAF page did not initialize in the validated RobotStudio 26.2/RobotWare 6.16 run; no motion evidence exists and the underlying page failure is not established | Stop after a bounded wait, close/relaunch once, then close VFP, restore Auto/RAPID Stopped, and record manual Jog as unavailable rather than substituting RAPID silently |
| Start result `Error`, event 10021 | Start request was made through the wrong ownership or task-level path | Hold RAPID mastership and use controller-level `Rapid.Start` |
| `IllegalEntryPoint` | `StartCheck.CallChain` rejected a service routine | Use `StartCheck.None` after explicitly setting the routine pointer |
| event 50026 | Controller-level near-singularity stop | Preserve the event, wait for Stopped, externally reset PP, then run the next isolated routine |

## Guardrails

- The automation helper requires `-AllowControllerMutation` for upload, module replacement, program-pointer movement, or execution.
- The helper rejects non-virtual controllers and ambiguous controller matches.
- Upload completes before deleting the loaded module, so a controller-side recovery source exists.
- The event-log schema is not uniform: never access optional `argv.value` directly under StrictMode.
- `ResetProgramPointer` resolves the task's normal entry point before `SetProgramPointer`; every generated experiment module must therefore contain `main`.
- `RunRoutines` and PC SDK polling are RAPID-only evidence. A manual-Jog claim requires an independently operated RobotStudio/Virtual FlexPendant control path.
- VFP child controls move between launches and custom panes may not implement UI Automation invoke patterns; search by process id and re-query controls before input.
- Use task-specific variable names in PowerShell; `$HOME` is a protected shell variable and is never a scratch path.
- Keep credentials out of committed configuration when they differ from the disposable virtual-controller defaults.
- A fatal motion event is evidence. Recovery advances to the next isolated test; it does not reinterpret the failed command as success.

## Cleanup command

After preserving evidence, remove only the named temporary module:

```powershell
& ".agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1" `
  -Action RemoveModule `
  -ControllerName Controller1 `
  -TaskName T_ROB1 `
  -ModuleName OracleSmoke `
  -AllowControllerMutation `
  -OutputDirectory ".scratch/robotstudio-oracle/cleanup"
```

Then run `Inspect` into a different output directory. Cleanup is complete only when Auto, MotorsOn, RAPID Stopped, task Ready/Stopped, and the original module set are visible in the final artifact.

## Primary API reference

ABB RWS file upload: <https://developercenter.robotstudio.com/api/rwsApi/fs_file_upload_page.html>
