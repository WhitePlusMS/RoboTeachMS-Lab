---
name: robotstudio-oracle
description: Oracle RobotStudio virtual controllers when ABB motion behavior needs black-box capture, automated RAPID execution, event-log diagnosis, or comparison with this simulator. Use only for virtual-controller work; ordinary project-only tests stay in the repository workflow.
---

# RobotStudio Oracle

Treat RobotStudio as a black-box oracle: pin the controller context, execute one discriminating experiment, preserve raw evidence, then compare behavior before changing project algorithms.

## 1. Lock the target and authority

Resolve the exact controller name, task, RobotWare version, robot model, tool, work object, coordinate frame, start joints, command, and policy under test. Start with read-only inspection. Controller mutation requires explicit authorization in the current request; authorization from an earlier task does not carry forward.

Completion criterion: exactly one matching controller is discovered, it reports `IsVirtual=true`, and every experiment-defining value is known or recorded as an explicit assumption.

## 2. Choose the branch

- For controller discovery, module loading, RAPID execution, recovery, file transfer, or event logs, read [references/controller-operations.md](references/controller-operations.md) before acting.
- For comparing RobotStudio output with FK/IK, Jog, or RAPID behavior in this project, read [references/motion-comparison.md](references/motion-comparison.md) before defining assertions.

Completion criterion: every active branch has loaded its reference; unrelated references remain unloaded.

## 3. Preflight

Run the helper in inspect mode:

```powershell
& ".agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1" `
  -Action Inspect `
  -ControllerName Controller1 `
  -TaskName T_ROB1
```

Confirm Auto mode, MotorsOn, RAPID status, task status, loaded modules, RWS endpoint, and recent event log. A controller outside the declared target, a non-virtual controller, or a running task is a hard stop before mutation.

Completion criterion: the inspection artifact identifies one safe target and contains enough state to restore or report the controller after the experiment.

## 4. Shape the experiment

Read the complete RAPID module before loading it. Give each controller-fatal probe a public, parameterless routine and an independent output file. Put successful baseline cases before expected failures only when they share one routine; prefer external orchestration for failures such as 50026 because ordinary RAPID `ERROR/TRYNEXT` may not regain control.

For the first run on a RobotWare 6 controller, start from this known-good shape before adding custom records or non-ASCII source text:

```rapid
MODULE OracleSmoke
    PROC main()
    ENDPROC

    PROC CaseFine()
        MoveAbsJ [[0,-25,45,0,20,0],[9E9,9E9,9E9,9E9,9E9,9E9]],v100,fine,tool0;
    ENDPROC
ENDMODULE
```

The empty `main` is required by the helper's program-pointer reset even when every experiment starts at another public routine. Keep module names, identifiers, and comments ASCII in the validated RobotWare 6 workflow. Prove the execution pipeline with built-in data such as `fine` or `z10` before introducing a custom `zonedata`; a `CheckProgram` location alone does not establish why a record declaration failed.

Completion criterion: every requested case maps to one routine, one expected output, one start state, and one acceptance or rejection observation.

## 5. Execute outside the motion task

After explicit authorization, use `RunRoutines`; do not recreate RWS or PC SDK calls ad hoc:

```powershell
& ".agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1" `
  -Action RunRoutines `
  -ControllerName Controller1 `
  -TaskName T_ROB1 `
  -ModulePath ".scratch/experiment.mod" `
  -Routines CasePlus,CaseMinus `
  -AllowControllerMutation `
  -OutputDirectory ".scratch/robotstudio-oracle/run-001"
```

The helper uploads before replacing, checks the RAPID program, sets each program pointer, starts through controller-level RAPID mastership, waits for stop, and resets before the next routine.

For an unsegmented motion time series, add `-CaptureMotionSamples -SampleIntervalMs 10`. The helper polls the task mechanical unit through PC SDK while the routine is running and writes `samples-{routine}.csv`; do not replace this with endpoint reads inside RAPID.

Completion criterion: every routine has a manifest entry with start result, terminal RAPID state, controller state, and the event-log slice covering that run.

`RunRoutines` is a RAPID execution oracle, not a manual Jog oracle. The validated PC SDK mechanical-unit surface exposes position reads (`GetPosition`) but no public manual-Jog write operation. Never label a `RunRoutines`/PC SDK trace as a manual linear Jog trace.

If a task explicitly requires manual Jog, use the interactive RobotStudio/Virtual FlexPendant path as a separate experiment. On the validated RobotStudio 26.2.11700.0 + RobotWare 6.16.0.3 setup, the Virtual FlexPendant Jogging TAF page remained on the RobotWare splash screen after launch and relaunch; no trajectory or acceptance conclusion was produced. Treat a persistent splash as an unavailable manual-Jog oracle, stop after a bounded wait, close the VFP process, restore the controller to Auto/RAPID Stopped, and report the gap. Do not substitute RAPID data silently.

For VFP UI automation, locate controls from the desktop root filtered by the VFP process id. Its child window and screen coordinates can move between launches; a cached `MainWindowHandle` is not a stable search root. Standard UI Automation patterns are not uniform: radio buttons may support `SelectionItemPattern`, custom TAF panes may expose no invoke pattern, and ribbon tabs may not support selection at all. Re-query the unique control immediately before any click and verify the controller state afterward.

## 6. Preserve and compare

Use `Download` to copy controller `$HOME` evidence into a run-specific `.scratch` directory. Keep raw values unchanged; converters produce new files. Compare acceptance first, then configuration and joint path, then TCP position and quaternion orientation. Report unsupported equivalence claims instead of weakening assertions.

Completion criterion: every conclusion points to raw RobotStudio evidence and a project-side reproduction using the same pinned context.

## 7. Leave a safe controller

Verify the target ends in Auto, MotorsOn, RAPID Stopped, expected task Stopped, and the intended module set. Terminate helper processes started by the run. Record changes in local `UPDATE_LOG.md`; keep controller logs and intermediate evidence under `.scratch`.

Unload a temporary experiment module explicitly after collecting its evidence:

```powershell
& ".agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1" `
  -Action RemoveModule `
  -ControllerName Controller1 `
  -TaskName T_ROB1 `
  -ModuleName OracleSmoke `
  -AllowControllerMutation `
  -OutputDirectory ".scratch/robotstudio-oracle/cleanup"
```

Run `Inspect` again and compare `modules` with the preflight artifact. `RemoveModule` is narrowly scoped to the exact module name and still requires virtual-controller, Auto, RAPID Stopped, mutation-authorization, uniqueness, and RAPID-mastership checks.

Completion criterion: no automation process remains, final controller state is recorded, and any abnormal state is reported prominently rather than hidden by cleanup.
