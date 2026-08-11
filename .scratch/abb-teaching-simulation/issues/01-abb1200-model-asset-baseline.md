# 01 — 锁定 ABB IRB 1200 变体与三维模型资产

Type: task
Status: resolved
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

## Answer

当前仓库已经形成并验证首期 ABB 资产基准，可以关闭本票并进入 profile 契约阶段：

- 变体采用经典款 `ABB IRB 1200-5/0.9`；`Gen2`、`Hygienic` 和 `Lite+` 不混入当前运行链。
- 项目资产为用户提供的 `public/models/ABB_IRB1200_5_90.fbx`，工程按厘米源单位以 `0.01` 缩放到 Three.js 场景；资产加载、包围盒比例和浏览器展示已有 E2E 验证。
- 场景层已确认 `dizuo` 为底座，`joint1` 到 `joint6` 为六个主动关节，`joint6` 为机械法兰，`joint7` 为工具/末端父节点；六个轴向和逐轴运动已有单元/E2E 验证。
- 关节范围采用经典 `-5/0.9` profile：J1 ±170°、J2 −100°…+130°、J3 −200°…+70°、J4 ±270°、J5 ±130°、J6 ±400°；长度使用毫米，控制角度使用度。
- 运动学真值明确由 `ABB_IRB1200_5_90_STANDARD_DH` 候选链提供，FBX 不反推 FK/IK；FBX 与候选 DH 的可观察差异已经记录并通过诊断测试保留，避免把视觉模型误报为官方机构参数。
- 验收证据包括 `src/scene/abb-scene.test.ts`、`e2e/abb-irb1200.spec.ts` 以及 `.scratch/abb-teaching-simulation/research/08-abb-fbx-zero-calibration.md`、`09-abb-fbx-dh-link-measurements.md`。当前项目不宣称该用户提供资产具有面向第三方线上再分发的授权；若未来公开发布模型，再单独补授权审查。

下一张前沿票是 [确定机器人 profile 与单位坐标契约](02-robot-profile-contract.md)，它应把本票确认的型号、范围、单位、基座/法兰约定和候选 DH 来源收敛为稳定接口，再继续结构化运动和 RAPID 契约。
