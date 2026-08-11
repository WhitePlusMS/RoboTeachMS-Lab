# 02 — 确定机器人 profile 与单位坐标契约

Type: grilling
Status: resolved
Assignee: codex
Blocked by: None
Part of: ../map.md

## Question

ABB 1200 的型号参数如何以一个可复用的机器人 profile 表达，并与现有正解、逆解和 RobotModel interface 接合？

需要一次性决定：

- profile 必须提供哪些运动学和限制字段；
- 内部统一使用的长度、角度和姿态表示；
- 基坐标、法兰坐标、工具坐标的关系；
- GLB 场景模型与 DH/数值模型不一致时谁是 ground truth；
- profile 变化后，哪些能力继续属于 core，哪些属于 ABB adapter。

目标是得到一个小而深的 interface，而不是把 KUKA 常量复制成另一份 ABB 常量。

## Answer

本票确定以下稳定契约：

- 产品操作语义以 ABB 为主。机器人运动学、RAPID 点位、工具和工件变换以 ABB 机器人基座坐标为唯一空间真值；Three.js/FBX 只负责显示，不反向定义机器人语义。
- 核心位置统一使用毫米，关节角对外统一使用度；DH adapter 内部可以使用弧度。核心 `Pose` 的姿态真值使用旋转矩阵，RAPID `[q1,q2,q3,q4]` 四元数在 RAPID seam 显式转换，欧拉角只用于界面显示。
- 核心 FK 返回六轴机械法兰位姿。默认 `tool0` 是机械法兰上的单位变换；FBX `joint7` 的 93.902208 mm 视觉偏移只属于场景显示 adapter，不属于 FK/IK 或 RAPID TCP。
- 引入最小 `RobotProfile` 概念，只聚合稳定运行信息：型号身份、`RobotModel`、六轴关节范围和回零关节状态。DH 参数、模型 URL、节点名称、颜色及 ABB→Three.js 显示转换不进入 profile interface。
- 通用 `robotics` 保持厂家无关；ABB 具体运动学、关节限制和基座/法兰约定属于 ABB adapter；RAPID 语义属于 `rapid`；FBX 节点、缩放、轴向和显示坐标变换属于 `scene`。
- KUKA 实现保留，为项目未来支持多厂家机械臂留下真实 adapter；当前不删除、不重构 KUKA，也不建设 profile 注册中心、厂家选择 UI 或其他厂家实现。
- 坐标组合固定为 `Base→Flange = Base→WorkObject × WorkObject→TargetTCP × inverse(Flange→ToolTCP)`。当前执行仍只支持单位 `wobj0 + tool0`，自定义 `tooldata/wobjdata` 留待后续里程碑。

由此形成独立的新里程碑“ABB Profile 与坐标语义修正闭环”，其地图位于 `../../abb-profile-coordinate-semantics/map.md`。该里程碑不写入本目录的后续票据。
