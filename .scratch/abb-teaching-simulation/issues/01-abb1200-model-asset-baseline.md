# 01 — 锁定 ABB IRB 1200 变体与三维模型资产

Type: task
Status: claimed
Assignee: architecture_explore
Blocked by: None
Part of: ../map.md

## Question

首期究竟使用哪一个 ABB IRB 1200 具体变体，且它对应的三维模型与运动学资料是什么？

需要在开始 profile 设计前取得并确认：

- 具体型号、负载、臂展或版本标识；
- 可在独立前端中使用的 GLB/GLTF 模型；
- 六轴关节范围、轴长或官方运动学参数；
- 模型基座、关节节点、末端法兰的命名与方向；
- 长度、角度、基坐标和工具坐标的单位约定。

回答必须形成一个可追溯的资产基准。当前仓库只有 KUKA_V1.glb，没有 ABB 1200 模型，因此不能用猜测的尺寸开始实现。

## Delegated research brief

交给其他智能体执行时，使用 [ABB IRB 1200 模型与参数检索任务](../research/01-abb1200-model-and-parameters-search-task.md)。该文档规定了联网检索顺序、模型可前端化判定、参数核验、授权边界和交付格式。
