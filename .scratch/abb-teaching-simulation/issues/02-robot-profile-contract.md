# 02 — 确定机器人 profile 与单位坐标契约

Type: grilling
Status: open
Blocked by: 01
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

