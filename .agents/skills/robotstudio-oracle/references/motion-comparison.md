# Motion comparison

Read this reference when RobotStudio evidence will decide FK, IK, Cartesian planning, Jog, or RAPID behavior.

## Pin the context

Record RobotStudio and RobotWare versions, exact robot variant, calibration/Absolute Accuracy status, tool, work object, base frame, coordinate mode, start joints, speed, zone, `ConfL/ConfJ`, `SingArea`, target `robconf`, and whether the source is manual Jog or RAPID. A result from J5=30° is not evidence for true zero J5=0°.

## Compare in this order

1. **Acceptance:** both systems accept or reject the same command under the same policy. Preserve the ABB event code on rejection.
2. **Configuration:** compare `cf1/cf4/cf6/cfx`, unwrapped J4/J6 revolutions, and selected analytic branch.
3. **Joint path:** compare J1–J6 samples and branch continuity. Distinguish controller samples, fine-point endpoints, and commanded targets.
4. **TCP position:** compare in the same frame and with the same tool/work object.
5. **Orientation:** compare quaternion rotation distance using `abs(dot(q1,q2))`; `q` and `-q` are identical orientations.
6. **Timing:** compare only when sampling methods and controller cycle semantics are equivalent.

## Wrist singularity

At J5≈0, J4 and J6 are a coupled gauge. A large per-axis representation change can describe a continuous TCP pose, so an ordinary maximum single-joint-step test is not a valid singularity continuity metric. Compare the coupled wrist invariant and FK pose before classifying a branch jump.

RobotWare 6.16.3007 black-box evidence for IRB1200-5/0.9 true zero Y±50 established:

- `ConfL\On + SingArea\Wrist`: Y+50 and Y-50 succeed; the segmented 5 mm fine-point records return to the commanded quaternion, and the first recorded point uses J4/J6 near ±90°.
- `ConfL\Off + SingArea\Off`: both directions stop with 50026.
- `ConfL\On + SingArea\Off`: both directions stop with 50026.

These endpoint records do not prove that orientation is preserved during each MoveL. The ABB RobotWare 6 RAPID manual states that `SingArea\Wrist` joint-interpolates orientation: the TCP follows the programmed path while tool orientation can deviate during the movement. Treat it as a path-level wrist-interpolation policy constrained by analytic configuration facts. A generic DLS fallback is not equivalent evidence; compare its complete time series against RobotStudio before accepting any approximation.

Unsegmented PC SDK traces captured on RobotWare 6.16.0.3 at v50 established the process shape:

- Y+50: maximum orientation deviation 2.046845° near Y=25.1904 mm; final J4/J6=-89.9902°/+89.9901°, J5=+6.3262°.
- Y-50: maximum orientation deviation 2.044481° near Y=-25.5946 mm; final J4/J6=-90.0098°/+90.0099°, J5=-6.3262°.
- Both directions return to the programmed orientation at the fine endpoint; observed X/Z path drift stayed below 0.024 mm.

Therefore the orientation deviation is a path-shaped midpoint effect, not a fixed escape orientation that may be frozen for all later waypoints.

## Evidence quality

- Read actual state after a settling delay when logging fine-point endpoints; immediate `CRobT/CJointT` reads can lag the command.
- Segmenting a MoveL produces branch samples but is not a servo-cycle trace. Label it accordingly.
- To characterize `SingArea\Wrist`, capture `CJointT` and `CRobT` while one unsegmented MoveL is still executing; endpoint-only reads cannot measure process orientation deviation.
- Manual Jog and RAPID MoveL are separate controller semantics; capture each independently.
- Preserve raw CSV and event logs. Derived JSON, normalized quaternions, or FK recomputations are separate artifacts.
