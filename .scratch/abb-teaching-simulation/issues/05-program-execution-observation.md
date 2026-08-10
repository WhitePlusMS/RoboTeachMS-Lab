# 05 — 确定程序解释执行与运动观察语义

Type: grilling
Status: open
Blocked by: 02, 03
Part of: ../map.md

## Question

一段教学程序如何在现有运动控制和 Three.js 场景中解释执行，并让学生观察每一步的目标、运动、轨迹和结果？

需要决定：

- 程序运行、单步、暂停、停止、回零和重置的状态转换；
- 指令之间是否串行等待完成，目标替换和连续运动如何处理；
- 轨迹按末端位姿、关节状态还是规划采样点记录；
- 失败后停在什么状态，后续指令是否还能继续；
- UI 需要暴露哪些执行日志和当前指令信息；
- 解释执行器与现有 MotionRunner、CartesianMotionPlanner、Scene controller 的 seam。

这里解决的是教学观察语义，不是构建一个通用动作队列或工业控制 runtime。

