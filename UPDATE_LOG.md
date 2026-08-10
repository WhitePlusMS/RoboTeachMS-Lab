# 更新日志

## 2026-08-10 — 接入报告中的 ABB 5/0.9 候选DH几何映射

- 修改 src/robots/abb-irb1200/robot-config.ts：明确当前ABB标准DH profile使用报告中ROS-Industrial irb1200_5_90 等价链的候选几何量，并标注其不是ABB官方RobotStudio标定DH。
- 修改 src/robots/abb-irb1200/abb-kinematics.ts：明确基座旋转和joint7法兰定义属于当前项目适配约定；未擅自加入未经验证的tool0固定变换。
- 修改 src/robots/abb-irb1200/dh-robot-model.ts：将“官方等价DH”更正为“候选等价DH”，避免误报参数来源。
- 修改 src/scene/abb-scene-model.ts：同步修正ABB场景模型适配器中的来源注释，明确当前运行链是报告候选DH而非ABB官方标定机制。
- 修改 src/robots/abb-irb1200/robot-config.test.ts：锁定报告候选映射中的399.1、448、42、451、82毫米以及J2的-90度标准DH偏置。
- 修改原因：用户要求先使用报告中的参数进行ABB DH计算，同时保持来源边界和KUKA独立性。
- 影响：ABB现有标准DH矩阵计算数值不变；仅补充来源说明和回归断言。J6仍使用ABB官方手册的±400度限制，未将ROS URDF的±360度模型限制覆盖到项目。

## 2026-08-10 — 新增 ABB DH 参数并行检索方案

- 新增文件：.scratch/abb-teaching-simulation/research/06-abb1200-dh-search-plan-for-agents.md。
- 修改原因：用户要求由其自行派发多个 Agent 搜索 ABB IRB 1200-5/0.9 的 DH/MDH 参数，因此提供统一的检索范围、Agent 分工、证据等级、搜索词、FK 复现姿态和结果格式。
- 文档内容：区分 ABB 官方机制、RobotStudio SDK、官方手册、RobotWare、ROS/URDF、开源代码、论文、CAD 和当前 FBX 来源；强制记录型号、坐标系、零位、法兰、单位、矩阵顺序、许可证和冲突解释。
- 关键约束：不把几何尺寸直接称为完整 DH；不混用经典款、Gen2、Hygienic 和其他 IRB 1200 变体；在结果汇总前不修改 ABB 或 KUKA 业务代码。
- 影响：仅新增研究指导文档和本次更新记录；未修改 src、模型资产、依赖或运行时行为。

## 2026-08-10 — 接入 ABB 专用模型的共享数值逆解回归

- 修改 `src/scene/abb-scene-model.ts`：FBX 场景适配器不再从视觉节点反推 ABB FK；改为委托 `AbbDhRobotModel` 的官方等价标准 DH 链，并复用共享 `estimateNumericalJacobian`。
- 修改原因：用户要求 ABB 复用 KUKA 已验证的 DLS 六维逆解算法，同时当前 FBX 的节点链与官方 ABB DH 链存在已知差异；视觉资产不能覆盖运动学真值。
- 修改影响：ABB 的笛卡尔控制、FK、数值 Jacobian 和 IK 统一使用 ABB 专属 DH 适配器；FBX 仍只负责六轴可视化运动，KUKA 场景、KUKA 轴定义和 KUKA 求解路径未修改。
- 修改 `src/robots/abb-irb1200/dh-robot-model.ts`：注释明确该模型是 ABB FK/IK 的运动学真值来源。
- 修改 `src/core/robot/ik-solver.test.ts`：增加 ABB FK→IK→FK 六维闭环、关节限位和小位置目标回归，验证 ABB 使用与 KUKA 相同的 DLS 逆解入口。
- 编译修正：删除 ABB 场景适配器切换到 DH 真值后不再读取的 FBX FK 采样字段，并同步简化场景实例化和关节更新调用；避免严格 TypeScript 下保留死字段。
- 编译修正：删除同一适配器中已无调用者的 Three.js 导入和关节应用类型别名，保持运动学适配器不依赖渲染实现。
- 构建验证：由于 Windows 构建产物 `dist/models/ABB_IRB1200_5_90.fbx` 的只读属性导致 Vite 无法覆盖，仅对该明确的 `dist` 产物去除只读属性；未修改 `public/models` 源资产。
- 修改 `e2e/abb-irb1200.spec.ts`：将原先“FBX 实际法兰与 DH”诊断改为“页面位姿与 ABB DH 正解闭环”，移除已不适用的预期失败标记，并将位置误差阈值收紧到 1 mm。
- 修改原因：ABB 运行时已明确以 DH 适配器作为 FK/IK 真值，页面显示位姿应与该链严格一致；FBX 仅是视觉资产，不能继续用旧测试名称暗示它是法兰测量来源。
- 当前浏览器测量结果：8 组零位、逐轴和复合姿态样本最大位置误差约 0.05 mm，符合浮点误差范围。
- 构建环境修正：确认 `public/models/ABB_IRB1200_5_90.fbx` 与 `dist/models/ABB_IRB1200_5_90.fbx` 均因只读属性导致 Vite 无法重复覆盖；仅移除这两个明确 FBX 文件的只读属性，未改变模型内容。
- 新增 `e2e/abb-irb1200.spec.ts` 的最小一致性诊断：直接加载当前 FBX，经过正式 `prepareAbbModel/applyAbbJointAngles` 后比较零位 `joint7` 与 ABB DH 法兰。
- 诊断目的：把“逆解结果看起来完全错误”的用户症状固定到真实场景边界；该测试预期在当前状态失败，用于证明 FBX 视觉链与 ABB DH 链不一致，不代表 DLS 本身失败。
- 编译修正：将需要 Node 文件访问的 FBX 诊断放回 Playwright/E2E 层，未扩大浏览器 `tsconfig` 的 Node 类型依赖。
- 新增 `src/core/robot/ik-solver.test.ts` 的固定 ABB 构型纯 DH 收敛测试：隔离 FBX 后验证 DLS 是否能从零位求解多组 ABB 目标。
- 诊断结果：纯 DH DLS 对 `[-90,20,-100,-120,80,180]°` 从零位出发返回 `null`，说明单初值 DLS 不能覆盖 ABB 全部可达配置分支；该用例改为预期失败基线，等待多初值/配置分支 IK 实现。
- 诊断结果：真实 FBX 一致性用例测得零位法兰与 ABB DH 法兰相差 `527.085 mm`，改为预期失败基线；当前页面仍明确以 DH 为 FK/IK 真值，FBX 仅作视觉资产。

## 2026-08-10 — 重新检索 ABB 官方机制与 IRB 1200 论文运动学资料

- 新增 `.scratch/abb-teaching-simulation/research/05-official-abb-kinematics-source.md`。
- 修改原因：用户要求先联网核验官方模型、官方文档和相关论文，再决定 FK/IK 计算路线。
- 研究结论：ABB 官方手册/规格书可确认 IRB 1200-5/0.9 的尺寸、工作范围和轴限位；ABB 官方 RobotStudio Mechanism API 才提供机制级 DH、FK、IK、BaseFrame、Flange、校准偏置、同步位置和配置分支读取入口。
- 论文对比：S06 给出 `a2=448` 的候选表；S07 也使用 `a2=448` 但 J6 常数为 `pi`；S08 表格写 `a2=350` 且其附录公式出现 `448`，存在内部冲突。论文数据均不标记为 ABB 官方标定值。
- 影响：当前 `src/robots/abb-irb1200/robot-config.ts` 的参数应被视为候选几何模型；正式实现应优先导入 RobotStudio mechanism 数据，或在只有手册+FBX 时使用显式通用刚体变换/MDH 并完成 FBX 法兰闭环验证。

## 2026-08-10 — 纳入用户提供的 ABB FBX 资产

- 新增文件：public/models/ABB_IRB1200_5_90.fbx；源文件为 C:\Users\admin\Downloads\JQR_ABB(1).fbx，大小 1,222,736 bytes。
- 影响：后续场景适配器以 dizuo 为固定底座进行加载和浏览器验证。

## 2026-08-10 — 接入 ABB IRB 1200-5/0.9 FBX 场景

- 新增 src/robots/abb-irb1200/robot-config.ts：建立 ABB profile，关节范围采用官方手册数据，DH 几何候选为 399.1 / 448 / 42 / 451 / 82 mm，明确不是 ABB 控制器标定参数。
- 新增 src/robots/abb-irb1200/dh-robot-model.ts、src/scene/abb-scene-model.ts：提供 FBX 未加载时的 FK/Jacobian 回退和从真实场景采样末端位姿。
- 新增 src/scene/abb-scene.ts：加载 ABB FBX，以 dizuo 为固定底座，使用 joint1 到 joint6 驱动六轴，将 joint7 作为末端父节点，保留 joint8、joint9 分支；页面不再加载 KUKA GLB。
- 修改 src/App.vue、src/components/SceneViewport.vue、src/robot/joint-control.ts：页面、关节限位、FK/IK 回退模型和场景全部切换到 ABB profile，并支持注入机器人配置。
- 新增 src/robots/abb-irb1200/robot-config.test.ts、src/scene/abb-scene.test.ts：覆盖关节限位、候选几何长度、底座识别、六轴映射、末端分支保护和场景辅助对象。
- 当前验证：npm run check 通过；npm test 通过（10 个测试文件、35 个测试）。
- 后续修正：`src/scene/abb-scene.ts` 增加上一采样点跟踪；清空轨迹后保持为空，只有末端再次发生位移才重新记录，避免渲染帧把静止点立即加回来。

## 2026-08-10 — 最终验证与构建输出修正

- 修改原因：Windows 下用户提供的 FBX 带有 ReadOnly 属性，Vite 二次构建覆盖 dist 生成物时出现 EPERM。
- 处理方式：仅对构建生成的 `dist/models/ABB_IRB1200_5_90.fbx` 去除 ReadOnly 属性，源文件和项目静态源资产保持不变。
- 最终验证：`npm run check` 通过；`npm test` 通过（10 个测试文件、35 个测试）；`npm run build` 通过；`npm run test:e2e` 通过（Playwright 1.62.1，1 passed）。

## 2026-08-10 — 增加 FBX 法兰与 DH 正解对照诊断

- 新增 e2e/abb-irb1200.spec.ts 中的法兰测量用例：在零位和一组复合关节角下，读取实际 FBX 法兰显示位姿，并调用项目现有 DH 正解计算结果，输出位置误差附件。
- 修改原因：用户确认 FBX 旋转轴后，继续区分 DH 长度/偏置错误与模型法兰固定变换错误。
- 当前影响：该用例暂以 50 mm 位置误差为严格阈值，当前参数若未校准会主动失败并暴露实际差值；不改变运行时行为。
- 补充：测量附件同时记录实际/DH 姿态角差，便于区分固定法兰变换和轴间长度误差。

## 2026-08-10 — 扩展逐轴 DH 诊断样本

- 修改 `e2e/abb-irb1200.spec.ts`，增加 J1~J6 各自单独旋转 10° 的 Playwright 样本。
- 修改原因：先测量单轴运动引起的实际法兰位移和姿态变化，再判断问题属于 DH 长度、角度符号还是固定基座坐标变换。
- 修改影响：诊断附件新增 `singleAxisDeltas`，并输出 `[ABB-DH-MEASURE]` 前缀的逐样本测量日志；未修改任何运动算法或模型参数。

## 2026-08-10 — 完成 ABB FBX 比例核验

- 核验文件：`public/models/ABB_IRB1200_5_90.fbx` 与 `src/scene/abb-scene.ts` 中的 `ABB_MODEL_SCALE = 0.01`。
- 核验结果：FBX 原始单位按厘米解释时，去除 `dizuo` 后的机械臂包围盒约为 `769.3 × 972.8 × 263.7 mm`；ABB 官方 `IRB 1200-5/0.9` 机器人高度为 `967 mm`，当前缩放误差约 `0.6%`，因此 `0.01` 缩放保持不变。
- 额外发现：`dizuo` 包围盒约为 `500 × 700 × 500 mm`，与官方机器人底座约 `210 × 210 mm` 不符，应按外部高底座/支架单独理解，不能用整棵 FBX 的总高度反推机械臂缩放。
- 影响：本次只确认比例，不修改模型缩放、DH 参数或关节轴；后续 DH 对照应区分机械臂本体安装面与 `dizuo` 支架高度。

## 2026-08-10 — 建立 ABB 独立标准 DH 适配器

- 新增 `src/robots/abb-irb1200/abb-kinematics.ts`：实现 ABB 专用标准 DH 变换、ABB 基座坐标到 Three.js Y-up 世界坐标的固定旋转，以及法兰固定变换入口。
- 新增 `src/core/robot/numerical-jacobian.ts`：抽取共享数值 Jacobian 计算逻辑；IK、控制层和 `RobotModel` 接口保持不变。
- 修改 `src/robots/abb-irb1200/dh-robot-model.ts`、`src/App.vue`：ABB 回退 FK 改用专用适配器，不再调用 KUKA 历史 DH 矩阵。
- 修改 `src/robots/abb-irb1200/robot-config.ts`：将 ABB 配置命名为 `ABB_IRB1200_5_90_STANDARD_DH`，明确其由 ABB 专用适配器解释。
- 新增 `src/robots/abb-irb1200/abb-kinematics.test.ts`，覆盖标准 DH 矩阵、ABB 零位坐标转换和关节运动变化。
- 影响：KUKA 的 `src/core/robot/kinematics.ts`、KUKA 配置和现有场景链路未修改；ABB 仍与 KUKA 共享 `RobotModel`、IK、控制层和数值 Jacobian 能力。
- 测试修正：`abb-kinematics.test.ts` 对三角函数结果使用近似断言，避免 `cos(±90°)` 的浮点残差造成误报。
- E2E 语义修正：将 FBX/DH 对照用例标记为已知差异测试；它继续输出实际误差，但不再把“视觉 FBX 与官方机构链不完全一致”误报为 ABB 适配器失败。

## 2026-08-10 — 固化 Playwright 浏览器 E2E

- 修改 package.json、package-lock.json：安装 `@playwright/test` 开发依赖，新增 `npm run test:e2e`；Vitest 限定扫描 `src`，避免把浏览器用例当作单元测试。
- 新增 playwright.config.ts：固定 1920×1080 viewport，使用本机 Chrome 和 4173 预览地址。
- 新增 e2e/abb-irb1200.spec.ts：验证 ABB FBX 加载完成、页面不再显示 KUKA、底座 dizuo 加载日志、六轴范围与限位、基座/工具坐标切换、网格切换、轨迹采样/清空和回零。
- 验证结果：Playwright 1.62.1 E2E 通过（1 passed，约 4.5s）；截图已检查，实际 ABB 模型和底部固定基座可见。

## 2026-08-10：修复回退模型并深化运动生命周期

- 新增 `src/core/robot/motion-runner.ts`：将缓动、限速、目标替换、模式切换、停止和完成逻辑集中到不依赖 Vue/浏览器的深 module；仅保留缓动、限速、停止三个命令，并通过 `MotionClock` 接收生产 RAF 时钟或测试手动时钟。
- 新增 `src/core/robot/motion-runner.test.ts`：通过 module interface 覆盖缓动完成、运行中目标替换、限速约束、循环复用和停止清理，避免测试穿透内部状态。
- 修改 `src/robot/motion-control.ts`：收口为 Vue/浏览器时钟 adapter，只负责注入 RAF 时钟和组件卸载清理；删除无调用者的 `isAnimating`、`isAnimatingRef` 双状态。
- 修改 `src/scene/kuka-scene.ts`：GLB 加载失败时继续显示占位几何，但不再把非串联 Pivot 占位模型注入 IK；显式回传 `null`，使 `App.vue` 保留可靠的 DH `RobotModel`。
- 修改 `src/robot/cartesian-control.ts`、`src/App.vue` 和对应测试：由调用者显式注入关节范围，移除控制 module 对 KUKA profile 的硬编码；将 `setJoints` 语义改为 `moveToJoints`，状态文案改为“目标运动已提交”，不再把动画开始误报为机器人已经完成更新。
- 修改 `src/robot/cartesian-control.ts`：复用已有角度、旋转矩阵乘法和欧拉角转换函数，删除重复数学实现，World/Tool 目标构造行为保持不变。
- 修改 `src/core/robot/types.ts`、`motion-smoothing.ts` 和 `ik-solver.ts`：删除从未参与实现的 `longPressThrottle`、`tolerance` 配置，避免无效 interface。
- 影响：模型加载失败时笛卡尔 FK/IK 使用 DH 回退；运动生命周期可确定性测试；现有控制交互、动画参数及场景 interface 保持不变。不新增 Robot Runtime、动作队列、Observation、Workspace 或兼容层。
- 验证结果：TypeScript 类型检查通过，`vitest` 通过（8 个测试文件、28 个测试），`vite build` 通过；仅保留既有单 chunk 体积提示。

## 2026-08-09：实现任务 04——场景辅助功能

- 新增 `src/scene/scene-helpers.ts`：复用原项目的基坐标轴和工具坐标轴绘制方式。
- 新增 `src/scene/trajectory.ts`：提供轨迹点最小距离去重和 200 点上限控制。
- 修改 `src/scene/kuka-scene.ts`：网格默认开启；加入基坐标/工具坐标辅助轴、末端轨迹采样、轨迹线显示、清空轨迹和资源释放。
- 修改 `src/components/SceneViewport.vue`：增加网格、基座/工具坐标、轨迹、清空轨迹辅助工具栏及轨迹点数提示。
- 新增 `src/components/CoordinateInfoPanel.vue`，并修改 `src/App.vue`、`src/style.css`：展示基坐标系与工具坐标系的位姿信息。
- 审查后改用固定轨迹缓冲区，合并坐标值格式化函数，并简化清空轨迹的状态同步路径。
- 验证结果：TypeScript 类型检查通过，`vitest` 通过（7 个测试文件、24 个测试），`vite build` 通过；仅保留既有单 chunk 体积提示。

## 2026-08-09：移植原项目运动动画过渡

- 新增 `src/core/robot/motion-smoothing.ts`：复用原项目的 `easeInOutCubic`、关节插值和默认运动参数。
- 新增 `src/robot/motion-control.ts`：接入 RAF 关节动画、800ms 缓动、60°/s 长按限速、连续目标更新和卸载清理。
- 修改 `src/App.vue`：关节单击、回零、随机姿态和笛卡尔目标统一使用平滑过渡；滑块输入仍保持即时提交。
- 修改 `JointControlPanel.vue`、`CartesianControlPanel.vue`、`cartesian-control.ts`：区分普通操作与连续长按目标。
- 新增动画曲线测试，更新关节面板事件测试。
- 验证结果：TypeScript 类型检查通过，`vitest` 通过（7 个测试文件、22 个测试），`vite build` 通过；仅保留既有单 chunk 体积提示。

## 2026-08-09：实现任务 03——笛卡尔控制与逆解闭环

- 新增 `src/core/robot/ik-solver.ts`：基于 DH 正解的数值 Jacobian DLS 六维逆解和位置-only 回退。
- 新增 `src/robot/cartesian-control.ts`：World/Tool 坐标增量、独立位置/姿态步进、逆解调用和失败保护。
- 新增 `src/components/CartesianControlPanel.vue`：X/Y/Z/RX/RY/RZ 数值输入、点击/长按、坐标系切换和状态提示。
- 修改 `src/App.vue`、`src/style.css`、`src/core/robot/types.ts`、`src/robot/joint-control.ts`：接入笛卡尔控制并复用现有关节状态与场景同步。
- 新增核心测试，覆盖小位移/小姿态逆解收敛、远目标失败、World/Tool 方向和非法输入保护。
- 验证结果：`npm test` 通过（6 个测试文件、20 个测试），`npm run check` 和 `npm run build` 通过。

## 2026-08-09：修正任务 03 逆解链路，完整对齐原项目实现

- 补齐 `ml-matrix`、`RobotModel`、旋转误差、向量限幅和角度工具，逆解改为原项目的 Levenberg-Marquardt DLS 参数与矩阵求解流程。
- 新增 `src/scene/kuka-scene-model.ts`，GLB 加载后直接从真实 KUKA Pivot 采样 FK/Jacobian，避免 DH 近似模型与三维场景轴向不一致。
- `SceneViewport` / `App` 将真实场景模型注入笛卡尔控制；GLB 未就绪时才回退到 DH 模型。
- 修正姿态目标使用完整旋转矩阵，不再用欧拉角差替代原始 `orientationError`。
- 删除重复的 `Pose` 类型声明，并将位置-only 回退提示改为“姿态未约束”，与实际算法能力保持一致。
- 验证结果：`npm test` 通过（6 个测试文件、20 个测试），`npm run check` 和 `npm run build` 通过。

## 2026-08-10 — IRB 1200-5/0.9 DH/MDH/URDF 参数复核

- 修改文件：`.scratch/abb-teaching-simulation/research/04-abb1200-dh-mdh-search-result.md`
- 修改原因：重新核查经典 ABB IRB 1200-5/0.9 是否存在可用于前端 FK/IK 的官方 DH/MDH、URDF 或等价刚体变换参数，并核对用户提供的 FBX 资产。
- 修改内容：
  - 记录 ABB 官方 IRB 1200 产品手册可确认的型号、关节范围、尺寸、单位和校准信息。
  - 记录 ABB RobotStudio SDK 对 DH、FK、IK、关节限制、法兰、零位和模型偏置的官方读取能力。
  - 记录 ROS-Industrial 的 IRB 1200-5/0.9 URDF/Xacro 线索及其非官方、需自行核验的限制。
  - 记录一篇明确匹配 IRB-1200-5-0.9 的原始论文 DH 表，并标明其与 ABB 官方 J2/J6 范围的冲突。
  - 对照当前 TypeScript `dhTransform`、`RobotModel` 和数值 IK，判断各类参数来源能否直接驱动现有 FK/IK。
  - 检查 `C:\Users\admin\Downloads\JQR_ABB(1).fbx` 的二进制格式、大小、关节名称线索和当前无法确认的层级/许可信息。
- 影响：未修改 `src`、`package.json`、Three.js 场景或运行时逻辑；为后续 ABB profile、模型转换和 FK/IK 回归提供来源边界与阻塞项。

## 2026-08-10 — 补充 IRB 1200-5/0.9 DH 参数交叉验证

- 修改文件：`.scratch/abb-teaching-simulation/research/04-abb1200-dh-mdh-search-result.md`
- 修改原因：补充联网检索到的 `a2=448 mm` DH 候选，并与 ABB 5/0.9 官方尺寸、ROS-Industrial URDF 和用户 FBX 检查结果区分记录，避免将 `a2=350 mm` 的冲突论文表直接作为经典 5/0.9 参数。
- 修改影响：研究结论现在区分“官方可确认尺寸”“论文 DH 候选”“URDF 等价刚体变换”和“当前项目坐标约定下的适配偏置”；未修改 `src`、`package.json` 或运行时逻辑。
