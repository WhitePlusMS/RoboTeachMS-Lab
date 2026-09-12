# Web 运动核心

## 职责与调用方向

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 界面与显示 | `components/`、`scene/` | 产生操作意图；显示唯一关节状态派生的机械臂与读数 |
| 应用编排 | `application/use-robot-controller.ts`、`application/motion/` | 手动接管、程序停止、连续会话；Coordinator 独占规划取消和运动执行 |
| RAPID 语义 | `rapid/` | 解析、运行程序，将 MoveJ/MoveL/MoveC 翻译为核心请求 |
| 规划传输 | `infrastructure/motion-worker/` | 同步或 Worker 调用同一规划器；不定义另一套运动算法 |
| 运动规划 | `robot-motion-core/` | 校验请求、坐标转换、选择路径算法、输出带时间的关节点列；playback/ 提供注入时钟的 Runner 与采样 |
| 通用几何 | `robot-geometry/` | 变换、IK 候选筛选、数值求解、通用数值 Jacobian |
| 机型装配 | `robot-models/` | 机型参数、解析 IK、限位、构型与独立视觉配置 |

核心、通用几何和机型不依赖 Vue、Three.js、DOM 或应用状态。架构测试限制这些依赖方向。`planMotion` 使用默认注册表解析机型，也可接收与请求身份一致的显式 profile。

## 四类运动意图

- `joint-target`：已知目标关节；用于关节 Jog、Home、机械零位。关节 Jog 不经过 IK。
- `pose-joint-target`：目标 TCP 位姿只在终点求 IK，再在关节空间插值；RAPID MoveJ 使用此意图，不要求 TCP 走直线。
- `linear-path`：TCP 直线与姿态插值，经过候选图验证连续性；笛卡尔 Jog 和 MoveL 共用。
- `circular-path`：起点、经过点和终点定义圆弧，再验证关节路径；MoveC 使用此意图。

Gizmo 用相同的笛卡尔路径校验，每个拖拽更新即时应用已验证终点。同步预判结果按完整请求匹配后消费一次，避免成功目标重复规划；它仍须经 Coordinator 才能写入关节。

## 时间与状态合同

请求单位为毫米、度，姿态使用 WXYZ 四元数。计划的 `timeMs` 是从零开始、严格递增的有限数值，允许小数毫秒；第一点必须精确对应请求起始关节，最后一点对应 `end`。目标已经到达时可返回单点计划，由 Coordinator 直接完成。

规划器决定 Cartesian/RAPID 时间；Runner 按时间采样，不能按数组下标或宿主 duration 重新分配。TCP 速度与姿态速度共同约束教学运动总时长。MoveJ 使用关节插值路径的 TCP 采样长度估算时间，这不是 ABB 控制器的加速度、关节动力学或伺服模型。

连续 Jog 每次从当前实际关节重新规划，累计目标保存在会话内；同一 Runner 保留完整新路径并复用帧循环。松手停止后保持当前关节，旧 generation 的异步结果不能清理新会话。

手动接管必须先停止活动 RAPID 程序，再提交新运动；程序保留已有偏离路径确认机制。界面不能自己写关节，也不能单独创建动画循环。

## 增加机型和独立使用

当前 `robot-models/registry.ts` 只装配 IRB1200，界面没有机型选择器。新增机型时提供 RobotProfile、模型求解器及视觉配置，再显式装配；不要在通用规划器里增加按型号分支。FBX 节点、转轴、偏置位于机型 `visual-profile.ts`。

运行 `npm run build:core` 得到 `dist-core/motion-core.js`，公开规划、FK、IK 候选、时间采样与注入时钟的播放器入口，可在无浏览器的 JavaScript 环境导入。移植到 C# 时仍需实现同样的数值算法并复用合同/基准测试；本次不修改 Unity DLL，也不声称 TypeScript 已自动转为 C#。

当前不支持的 fly-by 等能力仍显式返回错误，不做静默降级。

## 验证入口

- `npm run check`：类型检查。
- `npm test`：Web `src` 测试（包括架构门禁、规划、时间采样、抢占和程序运行）。
- `npm run build:core`、`npm run build`：独立核心与 Web 构建。
- 浏览器真实点击及拖拽结果见根目录 `UPDATE_LOG.md` 的 2026-09-12 验收记录。

## 内部文件职责

- `motion-planner.ts`：机型校验和四类运动的规划分派。
- `request-validation.ts`：结构与能力校验。
- `pose-frames.ts`：请求位姿与工具/工件刚体坐标转换。
- `plan-output.ts`：结果点列、残差和教学时间分配。
- `cartesian/`：直线位姿采样、候选图搜索、单点 IK 与腕部连续性。
- `playback/`：纯播放器、时间采样和关节缓动；Web 的 RAF 适配位于 application/motion/use-motion-runner.ts。
