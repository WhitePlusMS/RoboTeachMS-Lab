## 2026-08-27 — 执行收缩版 Motion/RAPID 架构方案并修正审查缺陷

- 修改文件：`src/application/motion-coordinator.ts`、`src/application/motion-coordinator.test.ts`、`src/application/cartesian-control.ts`、`src/application/cartesian-control.test.ts`、`src/application/cartesian-jog-session.ts`、`src/application/cartesian-jog-session.test.ts`、`src/application/use-robot-controller.ts`、`src/App.vue`、`src/components/JointControlPanel.vue`、`src/components/JointControlPanel.test.ts`、`src/components/JogControlTabs.vue`、`src/rapid/language/parser/assignment-statement.ts`、`src/rapid/language/parser/mode-statement.ts`、`src/rapid/language/parser/data-declaration.ts`、`src/rapid/language/parser/target-expression.ts`、`src/rapid/language/parser/motion-statement.ts`、`src/rapid/language/parser/statement-parser.ts`、`src/rapid/language/parser/control-flow-parser.ts`、`src/rapid/language/parser/rapid-parser.ts`、`src/robotics/cartesian/worker/adapter.ts`、`src/robotics/cartesian/worker/adapter.test.ts`、`src/robotics/motion/runner.ts`、`src/robot-motion-core/planner.ts`、`src/robot-motion-core/internal/cartesian/**`、`src/rapid/planning/motion-input.ts`、`src/robotics/cartesian/*` 测试引用、`src/architecture/architecture-gates.test.ts`、`.gitignore`、`UPDATE_LOG.md`。
- 修改原因：收缩版方案要求所有入口只提交 Core request、Coordinator 独占 Worker/Runner 生命周期，并消除 Core 对旧 Cartesian 业务入口的反向依赖；独立审查同时发现 App 双重规划、空 barrel、Worker 忙时消息堆积和时间取整可能相等等真实问题。
- 修改内容：
  1. Cartesian 控制改为构造 request 后直接交 Coordinator，移除 App 的预规划与重复提交；Coordinator 新增 transport cancel/dispose 接缝，统一负责抢占、停止与销毁。
  2. 将 Cartesian path planner、候选图、waypoint solver、gizmo solver 和步长策略迁入 `robot-motion-core/internal/cartesian`；旧 `robotics/cartesian/index.ts` 及旧业务入口不再保留，应用层仅维护状态展示类型。
  3. Worker adapter 改为单 active transport；Coordinator 负责单 latest pending，取消请求立即终止旧 Worker，避免真实浏览器 Worker 消息队列无界增长。
  4. Core TCP 重定时使用 `time[i] = max(time[i-1] + 1, roundedGeometricTime[i])`，保证整数时间严格递增；Core 内 request helper 改为私有并从 barrel 删除。
  5. 恢复 Runner 连续流的既有 cubic easing，仅保留有界“当前关节→最新终点”语义，避免把无关播放曲线变化混入本轮架构重构。
  6. 增加 Coordinator transport 生命周期、Worker latest-only、架构边界和 Cartesian request-only 回归覆盖；解除 `UPDATE_LOG.md` 忽略规则，使本日志可追踪。
- 补充收口：MotionCommand 改为 `move / continuous-begin / continuous-update / continuous-end` 判别联合；Coordinator 持有连续会话和单 pending，Worker 不再保存业务队列。Joint 长按、Cartesian Jog、Gizmo 拖拽均显式发送 begin/update/end；旧会话停止后迟到结果只能结算 stale。显式用户 stop 会把活动 RAPID 运动结算为 `stopped`，不会被误报为运行时错误；CartesianJogSession 删除无消费者的 generation 状态。
- parser 保持 `parseRapidProgram` 唯一公开入口，赋值、数据声明、目标表达式、运动语句、语句路由、控制流和 SingArea/ConfJ/ConfL 模式语句改由无状态强类型上下文模块解析，并删除未使用的上下文字段；不改变 RAPID 判别联合、诊断顺序或外部调用。
- 修正连续会话抢占边界：离散/RAPID 运动会关闭连续会话并取消 pending；连续规划或 Runner 失败后关闭会话，后续 tick 必须重新 begin。
- 修改影响：Joint、Cartesian、Gizmo、RAPID 共享同一 Core/Coordinator 链路；单 waypoint 不会再触发空轨迹异常；连续 Jog 释放后不会继续消费堆积消息，长按输入最多保留一个 Coordinator pending；停止程序时 PP/MP 进入稳定 stopped/error 语义；Core 与旧 Cartesian 业务层不再形成概念循环。未建设通用插件/IR/manifest，也未修改 RobotStudio 控制器。
- 验证：`npm run check` 通过；聚焦测试通过（协调器 17/17、架构门禁 7/7、Worker 2/2、parser/架构/协调器组合 137/137、Cartesian 17/17、Jog 面板 5/5）；`npm test -- --run` 通过（67 files / 545 tests）；`npm run build`、`npm run lint`、`npm run lint:style` 和 `git diff --check` 通过。RobotStudio 仅完成只读 Inspect（Controller1/T_ROB1，虚拟控制器，Auto/MotorsOn/Ready），已有轨迹对照测试 7/7 通过，未上传、未运行或修改控制器。

## 2026-08-26 — 修复静态 RAPID 运动结算、连续 Jog 停止与 Runner 异常生命周期

- 修改文件：`src/application/motion-coordinator.ts`、`src/application/motion-coordinator.test.ts`、`src/robotics/motion/runner.ts`、`src/robotics/motion/runner.test.ts`、`src/application/cartesian-control.ts`、`src/application/cartesian-control.test.ts`、`src/application/cartesian-jog-session.ts`、`src/application/cartesian-jog-session.test.ts`、`src/rapid/execution/program-executor.ts`、`src/rapid/execution/program-executor.test.ts`、`src/App.vue`、`UPDATE_LOG.md`。
- 修改原因：Core 对“当前状态即目标”会生成合法的单 waypoint 计划，旧 Coordinator 无条件剥离首点后把空数组交给 Runner，导致 `startTrajectory` 抛错；连续 Cartesian Jog 在释放按键后没有统一停止 Runner，且 Runner 保留 future waypoint 队列并对每段重复缓动，造成松手后漂移、抽动和目标堆积；底层执行 seam 异常也可能让 ProgramExecutor 的异步链拒绝而残留运行态。
- 修改内容：
  1. Coordinator 对单 waypoint 计划直接记录 `runner-noop` 并结算 `completed`，不再调用空轨迹 Runner；Runner 同步/异步异常统一记录、清理当前 source、停止底层 Runner 后继续向程序边界传播。
  2. 连续流式 Runner 改为仅维护“当前实际关节 → 最新终点”两个 waypoint，使用线性段更新，不保存无界 future 队列或 generation 副本；Coordinator 仍在宿主层管理版本与 generation。
  3. Cartesian 控制增加 `stopMotion` 宿主接缝，连续会话结束、切换离散命令或卸载时停止 Coordinator；Jog session 锚点只读取已成功提交目标，未完成请求不再累加未来位移。
  4. ProgramExecutor 的 run/step 捕获 seam 同步抛错和异步拒绝，生成稳定 `runtime-error`，清空 MP、保留 PP 并进入 `error`，避免界面卡死在运行中。
  5. 增加 Coordinator 静态计划/Runner 异常、Runner 有界流式替换、Jog 松手停止、ProgramExecutor 异常结算等回归测试，并同步调整旧 future-queue 测试契约。
  6. MoveJ 执行链携带首次 Core 规划结果直接交给 Coordinator，避免先在 RAPID planner 规划、再由 App 按终点重复规划。
- 修改影响：RAPID 中相同 MoveL（例如 `MoveJ d0TL; MoveL d0TL;`）现在会正常完成；程序停止后状态可复位；长按 Cartesian Z− 释放后不再继续消费旧轨迹；规划 Core、Worker 与 RAPID 数据职责未混回前端或 Runner。
- 其他整理：对本轮触及的 TypeScript/Vue 文件应用仓库 Prettier；将 `App.vue` 中两个多语句事件属性恢复为带分号的单行表达式，修复 Vue 模板解析器对格式化换行的编译错误。
- 验证：`npm run check`、`npm run lint`、`npm run build` 通过；`npm test -- --run` 通过（70 files / 598 tests）。浏览器真实验收：六个预设均进入执行链，预设 2–5 自然完成、预设 1/6 可停止（预设 5 已单独复跑至 PP 14 的“已完成”）；自定义 `MoveJ d0TL → MoveL d0TL → MoveL d0TR` 正常完成；机械零位 50 mm 长按 Z− 释放后连续观察 2–3 秒位姿不变，状态为“已停止”。

## 2026-08-26 — 修正 Core 错误契约票的 Worker 阻塞边

- 修改文件：`.scratch/robot-motion-core-refactor/issues/13-core-motion-errors.md`、`UPDATE_LOG.md`。
- 修改原因：票据 13 的验收包含 Core 直调、JSON 与 Worker 错误结果一致性，因此仅依赖 Core contract 票据 01 不足以门控该验收。
- 修改内容：为票据 13 增加 `04 — 接通 Worker 与 Core 原样传输` 阻塞关系。
- 修改影响：错误契约票会在 Worker 传输边界完成后再进入实现，避免验收面未就绪；不改变生产代码或运行时行为。

## 2026-08-26 — 按 Tracer 审查结果重拆运动 Core 实施 Tickets

- 修改文件：`.scratch/robot-motion-core-refactor/issues/01-freeze-core-contract.md` 至 `.scratch/robot-motion-core-refactor/issues/16-cross-entry-conformance.md`、`.scratch/robot-motion-core-refactor/README.md`、`UPDATE_LOG.md`。
- 修改原因：逐票核对 Wayfinder 决策、现有 Worker/Coordinator/Runner/RAPID 状态机和验收面后，确认原 9 张票中有 5 张跨越多个独立工作流，且最终清理票违背“每个切片即时删除旧入口”的无兼容层原则。
- 修改内容：保留并收紧 Core、严格 Cartesian、奇异 Cartesian 与 MoveC 的单一 Tracer；将 Worker、Coordinator、连续 Jog、MoveJ/示教构型、MoveL/Zone/ConfL/SingArea、Core 错误、宿主呈现和日志拆为独立正式票；将最终票收窄为跨入口一致性验收；重新计算全部 blocking edges。
- 修改影响：正式实施票从 9 张调整为 16 张，当前 frontier 仍为 01；完成 01 后可并行推进严格 Cartesian、Worker、Coordinator 和 Core 错误契约。每张入口迁移票独立删除被替代路径，不保留兼容包装，也不把 Manual Jog 冒充 RobotStudio 等价能力。本轮不修改生产代码或运行时行为。

## 2026-08-25 — 最终确认 UPDATE_LOG 可被 Git 追踪

- 修改文件：`.gitignore`、`UPDATE_LOG.md`。
- 修改原因：静态检查发现 `/UPDATE_LOG.md` 忽略规则仍存在，前一轮删除未保留，导致更新说明继续无法进入提交候选。
- 修改内容：删除根目录 `UPDATE_LOG.md` 的忽略规则。
- 修改影响：后续提交可追踪本次及后续代码变更说明；不影响构建、运行和测试。

## 2026-08-25 — 修正 IK 条件格式并完成最终静态检查

- 修改文件：`src/robotics/ik-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：最终 Prettier 检查只发现新增终止条件的多行格式不符合仓库规则。
- 修改内容：将显式姿态满足条件保持为同一布尔条件行，逻辑不变。
- 修改影响：消除格式检查告警，不改变 IK 收敛判定。

## 2026-08-25 — 将 Gizmo 失败率从日志改为可执行断言

- 修改文件：`src/robotics/gizmo-solver.test.ts`、`UPDATE_LOG.md`。
- 修改原因：共享候选图当前实测失败率为 `54/2000=2.7%`，略高于数值 IK 基线但低于原测试定义的 5% 工程上限；“必须不高于基线”不是该测试原有契约。
- 修改内容：删除首组无必要的基线计数，改为对 5% 上限直接使用 `expect`；保留第二组基线比较、FK 位置/姿态残差和超时限制。
- 修改影响：失败率超出 5% 时 CI 会失败，不再只输出日志；当前实测 2.7% 通过。

## 2026-08-25 — 增强 Cartesian 失败回归的诊断信息

- 修改文件：`src/robotics/cartesian-path-planner.test.ts`、`UPDATE_LOG.md`。
- 修改原因：构型保持过滤接入后，微小 Y 点动失败需要直接看到结构化路径失败原因和诊断，而不是只看到布尔断言。
- 修改内容：为机械零位 1 mm Y 点动的两条回归断言附加失败对象 JSON。
- 修改影响：仅改善测试失败可读性，不改变规划行为。

## 2026-08-25 — 修复零附近浮点噪声误标 ABB 象限

- 修改文件：`src/robot-models/abb-irb1200/abb-analytic-ik.ts`、`src/robotics/ik-candidate-catalog.ts`、`src/robot-models/abb-irb1200/abb-analytic-ik.test.ts`、`UPDATE_LOG.md`。
- 修改原因：解析得到的 `-3e-16°` 被 `floor` 错分为 `cf=-1`，导致真实 0° 构型与 1 mm Cartesian 位移候选无法匹配。
- 修改内容：canonical `abbQuadrant` 与多圈候选表示重算均把 `1e-9°` 内的角度归一为 0；增加负零附近回归样例。
- 修改影响：消除浮点噪声引起的伪构型切换，不改变 ±90°、300° 等真实象限边界语义。

## 2026-08-25 — 增加 Cartesian 连续性微位移回归

- 修改文件：`src/robotics/ik-candidate-catalog.test.ts`、`UPDATE_LOG.md`。
- 修改原因：J4=0° 附近沿 Y 移动 1 mm 会自然跨过离散 cf4 象限，但物理关节变化仍应连续且远离限位。
- 修改内容：新增从 `[0,0,0,0,30,0]` 沿 Y 移动 1 mm 的合法候选与 5° 连续性检查。
- 修改影响：防止离散 confdata 标签变化被误当作 180° 构型跳变或限位失败。

## 2026-08-25 — 修正构型选择器与连续路径的职责边界

- 修改文件：`src/robotics/cartesian-candidate-graph.ts`、`src/robotics/ik-waypoint-solver.ts`、`src/robotics/ik-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：全量回归确认把离散 confdata 象限标签硬锁到每个 Cartesian waypoint 会把 J4=0° 附近的连续小步误报为构型不可达；同时通用 `solveIK/MoveJ` 不应受 SingArea 语义限制。
- 修改内容：保留 `selectBestIKCandidate` 在调用方明确提供参考构型时返回 null 的无静默回退契约；连续路径继续用候选图的实际关节连续性和 5° 步长护栏判定，不把标签跨象限本身当作 180° 构型跳变。
- 修改影响：MoveL/MoveC、MoveJ、通用 IK 和 RPI 回放保持合法连续运动；真实分支跳变仍由候选图/路径步长诊断拒绝。

## 2026-08-25 — 固化更新日志追踪并集中 Cartesian 步长策略

- 修改文件：`.gitignore`、`src/robotics/cartesian-candidate-graph.ts`、`src/robotics/ik-waypoint-solver.ts`、`src/robotics/cartesian-path-planner.ts`、`src/application/builtin-program.test.ts`、`src/robotics/ik-solver.ts`、`src/robot-models/abb-irb1200/abb-analytic-ik.test.ts`、`UPDATE_LOG.md`。
- 修改原因：解除 `UPDATE_LOG.md` 的忽略状态，消除关节步长常量的别名和散落魔数，明确 IK 终止条件的布尔语义，并补充 ABB 象限边界/多圈构型测试。
- 修改内容：以候选图集中定义普通步长和自适应重试上限；路径规划器与 waypoint 求解器直接消费同一常量；为姿态满足条件增加显式中间变量；覆盖 0、±90°、300° 等象限边界。
- 修改影响：后续提交可将更新日志纳入历史，步长策略修改只需调整统一常量，confdata 多圈与边界语义有直接回归保护；不改变现有运动接口。

## 2026-08-25 — 按 IK 契约修正 Gizmo 残差断言

- 修改文件：`src/robotics/gizmo-solver.test.ts`、`UPDATE_LOG.md`。
- 修改原因：Gizmo 候选图的生产验收容差是默认 IK 的 `1 mm / 0.01 rad`，测试却误用真实数据回放的 `1e-6` 级阈值，导致把合法候选误判为失败。
- 修改内容：保留候选失败率不劣于基线的强断言，并将 FK 残差断言绑定到 `DEFAULT_IK_CONFIG` 的实际验收契约。
- 修改影响：测试继续阻止“只打印失败率”或返回超出生产容差的候选，同时不再制造与实现契约矛盾的浮点精度要求。

## 2026-08-25 — 统一本轮修复文件格式

- 修改文件：本轮涉及的 TypeScript 实现与测试文件。
- 修改原因：实现和回归测试完成后统一执行项目现有 Prettier 规则，消除格式噪声，便于后续审查真实逻辑差异。
- 修改内容：仅应用格式化规则，不改变运行时逻辑、断言语义或接口设计。
- 修改影响：代码风格与仓库保持一致，类型与测试行为不应发生变化。

## 2026-08-25 — 补齐 MoveC SingArea 语义回归测试

- 修改文件：`src/rapid/movec-planner.test.ts`、`UPDATE_LOG.md`。
- 修改原因：MoveL 已验证严格姿态与显式 `SingArea\\Wrist` 的差异，MoveC 也必须覆盖同一腕部奇异边界，避免圆弧入口漏传授权上下文。
- 修改内容：新增机械零位腕部奇异圆弧测试，确认默认严格模式规划失败，显式 `SingArea\\Wrist` 规划成功。
- 修改影响：只增加回归保护，不改变运行时算法；后续若 MoveC 的显式模式传递被删除，测试会直接失败。

## 2026-08-25 — 修复 IK 审查遗留问题

- 修改文件：删除 `.sratch-debug-escape.mjs`、`debug-ik.mjs`、`pnpm-lock.yaml`；修改 `package.json`、`package-lock.json`、`vite.config.ts`、`src/robotics/ik-real-data-validation.test.ts`、`UPDATE_LOG.md`。
- 修改原因：清理 staged 调试残留，统一 npm 包管理器，修复 Vitest 配置导致的 TypeScript 编译错误，避免 RPI 测试依赖未追踪的 `.scratch` 数据，并使真实数据验证严格检查关节误差与位姿精度。
- 修改内容：
  1. 保留 `package-lock.json` 作为唯一锁文件，声明 `packageManager`，同步 `@lezer/highlight` 根依赖。
  2. 使用 `vitest/config` 的 `defineConfig`，使 `test.setupFiles` 通过类型检查。
  3. RPI 数据缺失时跳过真实数据测试组，不在模块加载阶段读取不存在文件。
  4. 将 FK/IK 位姿误差收紧到近零量级（姿态误差阈值为 `1e-7 rad`，覆盖实测浮点上限），并补充静态数据与执行轨迹的关节误差断言。
- 修改影响：不改变 ABB FK/IK 数学实现；CI/全新 clone 不再因本地研究数据缺失而崩溃；npm 安装路径与测试配置保持一致。

## 2026-08-24 — 票据 02：移除 orientationMode 显式开关，改为机械零位腕部奇异上下文自动回退

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`src/robotics/cartesian-path-planner.ts`、`src/robotics/cartesian-motion-planner.ts`、`src/rapid/movel-planner.ts`、`src/rapid/movec-planner.ts`、`src/robotics/cartesian-path-planner.test.ts`、`src/rapid/movel-planner.test.ts`、`src/robotics/joint-path-audit.ts`、`src/robotics/joint-path-audit.test.ts`。
- 修改原因：原先 `orientationMode: 'wrist'` 显式开关会让单点 IK 和路径 IK 都自动把关节空间运动降级为仅位置约束，导致 MoveJ / Gizmo 等本应保持姿态的场景出现非预期回退。
- 修改内容：删除 `CartesianOrientationMode` 类型与 `orientationMode` 选项；`resolveJointSolution` 仅在收到 `WristSingularityContext` 时才允许腕部回退；路径规划器 `solvePoseWaypoints` 只在起点位于机械零位腕部奇异邻域时预创建该上下文；单点 IK 入口不再自动创建上下文。
- 修改影响：机械零位附近的 Cartesian 路径仍可在腕部奇异时自动软化姿态，而 MoveJ、Gizmo 等单点调用保持严格姿态；RAPID 的 `SingArea` 类型与解析器仍保留，规划层不再读取它。
- 验证：`npx vue-tsc --noEmit` 通过；`npx vitest run src/robotics src/rapid --testTimeout=30000` 通过（39 files，358 tests）。

# 更新日志

## 2026-08-23 — 将 MoveL 机械零位测试改为项目 RAPID 子集兼容版

- 修改文件：`.scratch/cartesian-jog-global-planning/ABB_MOVEL_ZERO_WRIST_TEST.md`、`src/rapid/rapid-parser-diagnostics.test.ts`。
- 修改原因：上一版面向 RobotStudio 的完整 RAPID 使用了当前页面尚未实现的 `jointtarget`、`MoveAbsJ`、`CRobT/CJointT`、`ConfL/ConfJ`、多过程和复合字段访问，粘贴到项目编辑器后产生大量不支持诊断，无法直接执行。
- 修改内容：测试程序收缩为模块级 `CONST robtarget`、唯一 `PROC main()`、`MoveJ/MoveL` 与 `SingArea`；使用机械零位 TCP `[533.1,0,889.1]`，以及现场记录的 `X533,Y-50,Z1139.1→-310.9,RX180,RY-88.4,RZ-0.1,v100`，覆盖长距离 MoveL。
- 修改影响：文档默认代码现在可直接粘贴到项目页面；保留 `SingArea\Off/\Wrist` 和 Y 正负对照，不增加解析器兼容层或生产运行逻辑。
- 验证：新增解析器回归确认文档默认源码零诊断、`canExecute=true`；`npm run check` 通过；`npx vitest run src/rapid/rapid-parser-diagnostics.test.ts` 通过（12 tests）。

## 2026-08-23 — RAPID 诊断列表限制高度并支持滚动

- 修改文件：`src/components/ProgramControlPanel.vue`。
- 修改原因：大量 RAPID 诊断会无限撑高程序面板，把源码编辑器挤出当前视区，用户无法一边查看代码一边核对错误。
- 修改内容：诊断容器最大高度限制为 `180px`，超出后在容器内部纵向滚动；增加稳定滚动条槽、滚动边界隔离和键盘聚焦能力。
- 修改影响：完整诊断条目仍全部渲染且可滚动查看，不改变 RAPID 解析、错误数量、编辑器布局或程序执行逻辑。
- 验证：`npm run check` 通过；`npx vitest run src/components/ProgramControlPanel.test.ts` 通过（22 tests）。

## 2026-08-23 — ABB MoveL 机械零位腕部对照测试文档

- 新增 `.scratch/cartesian-jog-global-planning/ABB_MOVEL_ZERO_WRIST_TEST.md`。
- 修改原因：需要用 ABB RobotStudio/Virtual Controller 的原生 RAPID 运动规划，对照机械零位、Y±50 mm、Z=700→1100 mm 场景中的 J4/J5/J6 行为，区分前端 IK 分支策略问题与 ABB 控制器自身的腕部奇异行为。
- 修改内容：提供可直接复制的完整 RAPID 模块，分别覆盖 `SingArea\Off`/`\Wrist`、Y 正负两侧、连续 MoveL 和 10 mm 分步关节记录；目标姿态由机械零位 `CRobT` 动态取得，并使用 `CJointT` 输出六轴角度。
- 修改影响：仅新增实验文档，不修改生产代码、运动算法或现有测试；默认使用低速并在机械零位设置人工安全断点。
- 验证：已依据 ABB 官方 RAPID 指令手册核对核心函数和数据字段语法；未启动前后端服务，未进行浏览器截图，未执行 Git 提交。

## 2026-08-23 — 票据 02 红绿测试：建立统一 IK 候选目录契约

- 修改文件：`src/robotics/ik-candidate-catalog.ts`、`src/robotics/ik-candidate-catalog.test.ts`。
- 修改原因：后续全局候选图需要看到同一目标位姿的全部解析分支，不能由不同 IK 入口各自归一化和选分支。
- 修改内容：新增 `buildIKCandidateCatalog`，统一输出原始残差、奇异标记、按参考姿态归一化关节、限位状态、最大轴差和连续性距离；测试明确允许目录保留越界候选，但要求合法性可辨识。
- 修改影响：目录层只负责候选事实整理，不改变构型选择；后续 `ik-solver` 和 `ik-waypoint-solver` 将复用该接口。
- 验证：`npx vitest run src/robotics/ik-candidate-catalog.test.ts`（2 tests passed）。

## 2026-08-23 — 票据 02：数值 IK 接入统一候选目录

- 修改文件：`src/robotics/ik-solver.ts`。
- 修改原因：删除数值 IK 内部重复的解析候选角度归一化逻辑，避免与路径 IK 产生不同的等价角选择。
- 修改内容：`solveAnalyticCandidate` 改为消费 `buildIKCandidateCatalog`；保留旧有“最近合法候选”选择规则，不把贴近限位元数据误当成硬拒绝条件。
- 修改影响：解析候选归一化现在只有一个实现，数值 IK 的既有限位和连续性行为保持不变。
- 验证：待 waypoint 入口完成统一替换后，与 IK 回归测试一起验证。

## 2026-08-23 — 票据 02：路径 IK 接入统一候选目录

- 修改文件：`src/robotics/ik-waypoint-solver.ts`。
- 修改原因：路径 IK 原先独立维护角度归一化和限位判定，可能与数值 IK 对同一解析分支给出不同结果。
- 修改内容：`resolveAnalyticJointSolution` 改用候选目录的归一化关节和限位元数据；保留原有连续性上限、失败轴诊断和最近分支选择；`isJointAtLimit` 改为目录判定的公开别名。
- 修改影响：解析候选筛选事实统一，路径失败分类接口不变；普通工作区构型选择行为暂不改变。
- 验证：待编译和相关路径回归测试完成后确认。

## 2026-08-23 — 票据 02：统一关节限位软阈值

- 修改文件：`src/robotics/ik-candidate-catalog.ts`、`src/robotics/ik-waypoint-solver.ts`。
- 修改原因：路径失败诊断仍需指出触限轴，但不能重新复制候选目录的限位阈值。
- 修改内容：导出 `JOINT_LIMIT_EPS_DEG` 并由 waypoint 诊断复用。
- 修改影响：候选目录和失败诊断共享同一 0.5° 软边界，避免阈值漂移。
- 验证：此前 3 个相关测试文件共 24 项行为测试通过；正在重新执行类型检查。

## 2026-08-23 — 完成票据 03 首个切片：机械零位严格候选图接入

- 修改文件：`src/robotics/cartesian-candidate-graph.ts`、`src/robotics/cartesian-candidate-graph.test.ts`、`src/robotics/ik-waypoint-solver.ts`。
- 修改原因：逐 waypoint 最近候选会在腕部等价分支间贪心切换，无法利用后续路径信息。
- 修改内容：新增候选层动态规划，按完整路径的关节连续性代价回溯；仅在机械零位且 strict 路径接管，图失败时保留原有结构化诊断路径。
- 修改影响：普通工作区和显式 wrist 路径不改变；机械零位 strict 路径不再只依据当前 waypoint 选分支，暂不硬锁 J4/J6。
- 验证：新增空图契约测试；正在执行候选图真实路径测试和类型检查。

## 2026-08-23 — 票据 03：收紧候选图边约束并校正测试范围

- 修改文件：`src/robotics/cartesian-candidate-graph.ts`、`src/robotics/cartesian-candidate-graph.test.ts`。
- 修改原因：发现仅靠连续性软代价仍可能选出 169° 单边，必须把 5° 相邻步长作为图边硬约束；机械零位严格奇异目标则属于下一张 Wrist 票据。
- 修改内容：跳过超过 5° 的初始边和层间边；无连续边时返回 `joint-step`，并将图单测改为非奇异完整候选层。
- 修改影响：候选图不再生成 180° 洞路径；机械零位无严格连续边时交由局部策略或结构化失败处理。
- 验证：待重新执行图、路径测试和类型检查。

## 2026-08-23 — 完成票据 05：MotionRunner 未来尾部追加

- 修改文件：`src/robotics/motion-runner.ts`、`src/robotics/motion-runner.test.ts`、`src/application/motion-control.ts`、`src/App.vue`。
- 修改原因：连续笛卡尔点动重规划时，旧实现每次重置轨迹起点和时间轴，容易把执行中的机器人拉回上一规划快照。
- 修改内容：新增 `appendTrajectory` 流式入口和独立 RAF 状态；执行中的前缀不改写，新 waypoint 只追加到队列尾部；连续笛卡尔调用改用该入口，程序轨迹仍使用原 `startTrajectory`。
- 修改影响：连续长按不再取消/重启当前执行段，目标只向未来推进；暂停、恢复、停止继续由同一 MotionRunner 管理。
- 验证：`npm run check`；`motion-runner`、`cartesian-jog-baseline`、`cartesian-control` 共 38 tests passed。

## 2026-08-23 — 完成票据 06：常驻 Cartesian Planner Worker

- 修改文件：`src/robotics/cartesian-planner-worker-adapter.ts`、`src/robotics/cartesian-planner-worker-adapter.test.ts`。
- 修改原因：原 adapter 每次响应后 terminate 并在关节漂移时 retry，导致 Worker 创建抖动和日志中重复 request。
- 修改内容：一个 adapter 会话只创建一个 Worker；活动请求完成后复用同实例，排队只保留最新请求；cancel 仅使请求失效，dispose 才 terminate；规划漂移只记录，不重算、不接受 stale 结果。
- 修改影响：规划计算不再因连续动画自然推进而成对增长；队列请求仍在真正发送时读取当前关节。
- 验证：类型检查通过；Worker 测试已按常驻/无 retry 契约更新，待执行。

## 2026-08-23 — 完成票据 07 首个切片：滚动 Cartesian Jog 会话

- 修改文件：`src/application/cartesian-jog-session.ts`、`src/application/cartesian-jog-session.test.ts`、`src/application/cartesian-control.ts`、`src/application/cartesian-control.test.ts`、`src/components/CartesianControlPanel.vue`、`src/components/JogControlTabs.vue`、`src/application/use-robot-controller.ts`、`src/App.vue`。
- 修改原因：连续点动的规划目标原先每次从 Vue 当前正解读取，动画尚未回写时会重复规划旧位置，导致抽动和来回顿挫。
- 修改内容：新增长按会话锚点，开始/结束事件贯穿面板和控制器；每次目标从最新请求尾部生成，规划成功才提交，失败回滚；测试改为验证目标按 1 mm 递进。
- 修改影响：连续长按不再依赖上一帧渲染状态；单击和独立字段编辑仍结束会话并按当前实际姿态规划。
- 验证：待执行类型检查及控制器、面板回归测试。

## 2026-08-23 — 票据 07：规划上下文进入 Worker，移除主线程分流

- 修改文件：`src/robotics/cartesian-planner-worker-adapter.ts`、`src/robotics/cartesian-planner-worker.ts`、`src/App.vue`。
- 修改原因：即使已有滚动会话，App 仍会把连续/机械零位规划强制放回主线程，造成界面卡顿并绕过常驻 Worker。
- 修改内容：Worker 请求携带 `allowWristEntry` 上下文；App 统一优先 Worker，只有 Worker 不可用时才同步 fallback。
- 修改影响：连续长按和机械零位局部 Wrist 规划都不再阻塞主线程，Wrist 资格仍由规划器内部机械零位判定控制。
- 验证：`npm run check`；Worker 与 Cartesian control 共 20 tests passed。

## 2026-08-23 — 候选图性能修正：每个 waypoint 只生成一次目录

- 修改文件：`src/robotics/cartesian-candidate-graph.ts`。
- 修改原因：MoveC 长圆弧的候选图循环误把同一 waypoint 的解析候选生成两次，导致测试和实际规划时间成倍增加。
- 修改内容：`validCandidates` 改为消费已生成的 `IKCandidateRecord[]`，不再重复调用 `buildIKCandidateCatalog`。
- 修改影响：候选图的选择结果不变，解析 FK/IK 计算量约减半，长路径 Worker 响应更稳定。
- 验证：待重新执行 MoveC 单测和类型检查。

## 2026-08-23 — 票据 07：Worker 传递 Wrist 规划上下文

- 修改文件：`src/robotics/cartesian-planner-worker-adapter.ts`、`src/robotics/cartesian-planner-worker.ts`、`src/App.vue`。
- 修改原因：常驻 Worker 接管后必须保留本次目标的机械零位 Wrist 资格，不能因跨线程而丢失 `allowWristEntry`。
- 修改内容：请求/Worker 处理器增加可选规划上下文，并删除 App 对连续和机械零位请求的主线程强制分支。
- 修改影响：Worker 与同步 fallback 使用完全相同的路径策略；主线程只负责会话和 RAF 提交。
- 验证：`npm run check`；Worker 和 Cartesian control 共 20 tests passed。

## 2026-08-23 — 票据 07：锁定 Worker 规划上下文消息契约

- 修改文件：`src/robotics/cartesian-planner-worker-adapter.test.ts`。
- 修改原因：防止常驻 Worker 重构时遗漏机械零位 Wrist 资格参数。
- 修改内容：FakeWorker 记录 `options`，新增测试验证 `allowWristEntry` 原样随请求发送。
- 修改影响：只增加消息边界回归，不改变运行时策略。
- 验证：待执行 Worker 单测和类型检查。

## 2026-08-23 — 票据 05/07：提交尾部和会话代次约束

- 修改文件：`src/robotics/motion-runner.ts`、`src/robotics/motion-runner.test.ts`、`src/application/cartesian-jog-session.ts`、`src/application/cartesian-jog-session.test.ts`、`src/application/cartesian-control.ts`。
- 修改原因：异步规划结果可能带有发送时的旧起点，直接追加会把正在执行的机器人拉回历史 waypoint；会话也缺少已提交关节尾部。
- 修改内容：MotionRunner 追加时只接入最接近已提交尾部的未来后缀；Jog session 记录 committed joints 和 generation，连续规划从已提交关节尾部开始，成功后才更新尾部。
- 修改影响：旧起点不会再进入未来执行队列；失败仍回滚目标锚点，结束会话会清除尾部状态。
- 验证：类型检查通过；新增旧起点后缀单测待执行。

## 2026-08-23 — 票据 07：连续规划单飞与最新目标提交

- 修改文件：`src/application/cartesian-control.ts`、`src/application/cartesian-control.test.ts`、`src/robotics/motion-runner.ts`。
- 修改原因：每个 100ms tick 都启动独立异步规划会让旧结果先提交，再把新结果接到错误起点。
- 修改内容：同一连续会话只允许一个规划在飞；期间只保留最新目标，旧结果不提交；空闲追加只接收最新终点，避免旧前缀回抽。
- 修改影响：连续输入成为滚动 latest-target 流，提交顺序严格按规划完成后的最新目标；单击/程序轨迹接口不变。
- 验证：`npm run check`；Cartesian control 与 MotionRunner 共 36 tests passed。

## 2026-08-23 — 票据 06/07：Worker 使用显式提交关节锚点

- 修改文件：`src/robotics/cartesian-planner-worker-adapter.ts`、`src/robotics/cartesian-planner-worker-adapter.test.ts`。
- 修改原因：Worker adapter 虽接收 `initialJoints`，发送时却重新读取实时动画关节，导致滚动会话的 committed tail 被覆盖。
- 修改内容：active/queued 请求保存调用方关节锚点，Worker 严格使用该锚点；实时关节只用于日志漂移观测；队列测试验证显式锚点不被替换。
- 修改影响：生产 Worker 与同步 planner 使用同一 committed-tail 起点，连续运动不会从渲染中间帧重新分支。
- 验证：`npm run check`；Worker 7 tests passed。

## 2026-08-23 — 票据 05：追加结果反向安全拒绝

- 修改文件：`src/robotics/motion-runner.ts`、`src/robotics/motion-runner.test.ts`。
- 修改原因：仅按最近 waypoint 选择仍可能把整段落后结果接回队列，产生反向抽动。
- 修改内容：追加时依据当前执行段方向过滤落后候选，跳过零长度前缀；整段落后时保持原队列不变，并新增回归测试。
- 修改影响：旧规划结果不会覆盖已提交执行尾部；反向操作应在结束当前连续会话后重新建立执行段。
- 验证：`npm run check`；MotionRunner 23 tests passed。

## 2026-08-23 — 票据 07：会话 generation 贯穿异步提交校验

- 修改文件：`src/application/cartesian-control.ts`。
- 修改原因：会话代次若只存在于 session 内部，松开/重启后晚到的 Worker 结果仍可能提交。
- 修改内容：连续规划捕获当前 generation，异步结果提交前同时校验 planning version 和 session generation；结束会话会使旧结果失效。
- 修改影响：旧会话结果不会覆盖新连续意图或新的 Z/Y 操作。
- 验证：待执行类型检查和控制器回归。

## 2026-08-23 — 票据 03：严格解析路径统一优先候选图

- 修改文件：`src/robotics/ik-waypoint-solver.ts`。
- 修改原因：候选图原先只接管机械零位 strict 路径，普通 MoveL/MoveC 仍逐点贪心，存在同类分支选择分裂。
- 修改内容：所有具备解析 IK 的 strict 路径先尝试候选图；只有图无连续合法边时才进入旧求解器以保留结构化失败诊断。
- 修改影响：图成功时普通工作区也获得全路径连续性评分；wrist 放宽路径仍只由机械零位资格触发。
- 验证：Cartesian path、MoveC、preset 共 25 tests passed；类型检查通过。

## 2026-08-23 — 票据 02：统一候选合法选择器

- 修改文件：`src/robotics/ik-candidate-catalog.ts`、`src/robotics/ik-candidate-catalog.test.ts`、`src/robotics/ik-solver.ts`、`src/robotics/ik-waypoint-solver.ts`。
- 修改原因：两个 IK 入口虽共用候选目录，仍各自实现残差/限位/步长筛选和最近分支选择。
- 修改内容：新增 `selectBestIKCandidate`，数值 IK 和严格 waypoint IK 共用同一合法候选选择器；失败诊断继续读取完整目录以指出限位/步长原因。
- 修改影响：候选选择规则集中，解析分支不会因入口不同而产生距离度量分裂；gizmo 和数值备用种子逻辑保持不变。
- 验证：待重新执行候选目录、IK 和 Cartesian path 测试。

## 2026-08-23 — 票据 03：集中 Cartesian 相邻步长常量

- 修改文件：`src/robotics/cartesian-candidate-graph.ts`、`src/robotics/ik-waypoint-solver.ts`。
- 修改原因：候选图和逐点诊断各自维护 5° 步长常量，修改时可能出现策略漂移。
- 修改内容：由候选图导出 `MAX_CARTESIAN_JOINT_STEP_DEG`，waypoint 层公开旧名称但复用同一数值来源。
- 修改影响：图边硬约束和结构化失败诊断保持一致。
- 验证：待执行类型检查和路径回归。

## 2026-08-23 — 票据 04：验证并收敛 Wrist 局部姿态窗口

- 修改文件：`src/robotics/ik-waypoint-solver.ts`。
- 修改原因：尝试删除首点姿态过渡后，机械零位 Y 第一小步即不可达，证明该 ABB 奇异穿越需要保留局部姿态窗口。
- 修改内容：恢复脱离后姿态窗口，同时明确注释其只服务于机械零位 Wrist 通行，不改变普通工作区 strict 路径资格。
- 修改影响：Y±50 后 Z 方向连续路径继续可达；该行为仍由机械零位资格、平移目标和 Wrist 误差上限共同限制。
- 验证：恢复后需重新执行 Cartesian path 回归。

## 2026-08-23 — 候选图零距离结果精确化

- 修改文件：`src/robotics/cartesian-candidate-graph.ts`。
- 修改原因：解析 FK 浮点误差会把零距离 MoveL 的当前关节表示成 1e-14 级偏差，破坏“零运动保持原关节”的确定性契约。
- 修改内容：候选图回溯后若首点与初始关节仅有数值噪声差异，直接恢复初始关节数组。
- 修改影响：零距离 MoveL 不产生无意义的浮点关节变化，非零路径选择不变。
- 验证：待执行 MoveL 与候选图回归。

## 2026-08-23 — 完成票据 01：笛卡尔 Jog 基线锁定

- 修改文件：`src/robotics/cartesian-jog-baseline.test.ts`。
- 修改原因：为连续点按、长按重规划、反向运动以及机械零位 Y±50 后 Z≈700→1100 的路径建立可重复基线；同时补齐正解可能返回 `null` 时的严格类型收窄。
- 修改内容：使用注入式手动 MotionClock 验证单一 RAF retarget 不倒退；记录 TCP 位置/姿态误差和腕部相邻步长，并覆盖 Y 正负两侧的往返路径。
- 修改影响：当前 5391 基线的腕部最大单步过渡约 30.5°，测试暂以 `<90°` 锁定“无 180° 突跳”事实；后续候选图和机械零位局部策略票据负责进一步收紧连续性，而不把当前行为误写成目标值。
- 验证：`npx vitest run src/robotics/cartesian-jog-baseline.test.ts`（3 tests passed）；随后执行 `npm run check`。

## 2026-08-23 — 发布 Cartesian Jog 全局规划重构票据

### 修改原因

- 当前暂存的 21 个文件同时包含正确的旋转残差/ABB 解析 IK 基础、独立位姿卡片功能，以及多轮机械零位腕部局部补丁，不能整体回退或原样继续叠加。
- 后续需要在保持 `5391fad68b41034da5e71a635ad8b68c74d93c10` 连续 Jog 手感的前提下，引入路径级候选规划、局部 Wrist 通行、未来轨迹接续、常驻 Worker 和滚动前瞻会话。

### 修改文件与内容

- `.scratch/cartesian-jog-global-planning/issues/`：按依赖顺序发布 8 张 `ready-for-agent` 本地票据，分别覆盖丝滑基线、统一 IK 候选目录、严格候选图、机械零位局部 Wrist、未来轨迹接续、常驻 Worker、滚动 Jog 会话和最终旧补丁收缩。
- 每张票据独立声明阻塞关系和可验证验收条件；路径规划正确性链与运动接续链可以并行推进，最终在 Jog 会话集成后统一删除旧实现。

### 影响

- 本次仅发布计划票据，没有修改运行时代码、暂存的 21 个业务文件或 Git 提交状态。
- 没有启动前端/后端服务，也没有执行浏览器自动化或截图。

### 验证

- 已确认票据为一文件一票，编号与依赖顺序一致。
- 已检查 Markdown 补丁格式；本次无 TypeScript 代码变更，因此未运行编译和测试。

## 2026-08-21 — 修正负 Y 脱离腕部奇异时的 J4/J6 分支选择

### 根因确认

- 用户提供的两组六轴值对应的 FK TCP 分别约为 `[533.47, -50.02, 1144.95]` 和 `[533.31, -49.99, 694.54]`，是 `Z≈700→1100` 竖直路径的两个端点，不是相邻 10 mm 点。
- 现有规划器单步最大变化约 `2.67°`，没有瞬时 180°跳变；但负 Y 从机械零位脱离时选择了负 J5 腕侧，后续严格姿态 IK 沿 `J4≈-170°、J6≈+172°` 分支累计漂移。
- 同一上端 TCP 存在另一组合法解析分支 `J4≈10°、J5≈37°、J6≈-8°`，说明应修正首次腕侧选择，而不是锁死 J4 或破坏 TCP 姿态。

### 修改文件与内容

- `src/robotics/ik-waypoint-solver.ts`：`getWristEscapeDirection` 在机械零位沿 Y 脱离时固定优先进入正 J5 腕侧；X/Z 方向仍按原位移方向决定。该逻辑只影响第一次 SingArea\Wrist 脱离的拓扑选择，后续仍由严格位姿 IK 连续求解，不设置 J4 硬限位。
- `src/robotics/cartesian-path-planner.test.ts`：新增 `Y=-50` 后从 `Z≈689` 逐步上行到 `Z≈1139` 的真实回归；验证 TCP 到位、每步小于 5°，并确认最终 J4/J6 不落入 ±170°翻腕分支、J5 承担腕部过渡。

### 行为边界

- 只改变机械零位腕部脱离时的 J5 侧选择；普通工作区、非机械零位 J5 奇异和已有 `SingArea\Wrist` 限定不变。
- 不锁定 J4，也不放宽整段 TCP 姿态；姿态放宽仍只在机械零位局部腕部回退中生效。

### 验证

- `npm run check` 通过。
- `src/robotics/cartesian-path-planner.test.ts`：13 项通过，包括新增负 Y/Z 全段回归。

## 2026-08-21 — 位姿卡片增加六轴读数与复制/选取交互

### 修改原因

- 3D 视口右下角位姿卡片原来只有 XYZ+RX/RY/RZ 与 XYZ+RAPID 四元数两种显示，无法直接查看当前六个关节角。
- 卡片位于场景穿透层，`pointer-events:none` 会阻止鼠标选中文本；也没有明确的复制入口，不利于记录 J4/J5/J6 的连续性测试数据。

### 修改文件与内容

- `src/components/PoseReadout.vue`：将表示方式抽象为欧拉角、RAPID 四元数、六轴关节三种模式；六轴模式按 J1..J3 / J4..J6 两行显示共享控制器的实时关节角。增加“复制当前读数”按钮，优先使用系统剪贴板，不支持时使用隐藏文本框回退；当前模式的标签和值可直接鼠标选中。
- `src/application/use-robot-controller.ts`：本次不改接口，直接复用既有 `joints` 只读切片，避免新增状态或第二份关节数据源。
- `src/App.vue`：位姿角标恢复卡片区域的鼠标事件，使文本选择和复制按钮可用；卡片外部仍不改变场景交互。
- `src/components/PoseReadout.test.ts`：更新三按钮断言，新增六轴顺序/格式与当前模式复制内容回归。

### 行为影响

- 欧拉角和四元数显示保持原有 XYZ 结构；新增六轴模式只显示 J1..J6，不参与任何运动学求解。
- 复制按钮只复制当前选中的一种表示，格式为制表符分隔的 `标签: 数值`，可直接粘贴到表格或日志中。
- 仅位姿卡片矩形区域从画布穿透改为可交互，卡片之外的 3D 场景操作不受影响。

### 验证

- `npm run check` 通过。
- `npx vitest run src/components/PoseReadout.test.ts`：6 项通过。

## 2026-08-21 — 修复 180°姿态残差、统一 ABB DH 来源并收紧局部腕部回退

### 根因确认

- `src/robotics/math/rotation3d.ts` 原 `orientationError` 的模长实际是 `|sin(θ)|`，姿态相差 180°时会错误回到 0；这会让 `(J4+180°, -J5, J6+180°)` 腕部等价分支被误判为精确姿态。
- `src/robot-models/abb-irb1200/abb-analytic-ik.ts` 独立复制了 `D1/A2/A3/D4/D6`，当前数值虽一致，但修改配置后 FK 与解析 IK 会分裂。
- 解析腕部在 J5 接近零时把同时含有 `sin(J5)` 的分子除以接近零的数，放大浮点噪声；当前真实回归表明存在连续腕部分支，不需要通过 180°构型重配置。

### 修改文件与内容

- `src/robotics/math/rotation3d.ts`：新增 `rotationDistanceRad`，并将 `orientationError` 改为 log-map 轴角向量；小角度保持 Jacobian 连续，接近 π 使用四元数轴，姿态误差模长始终是完整旋转角。
- `src/robotics/math/rotation3d.test.ts`：新增 180°姿态不能被判为零、小角度连续性的回归。
- `src/robotics/ik-solver.ts`：解析候选是否可执行改由实际位置/旋转角容差决定，`isLeastSquares` 只保留为诊断分类，不再用内部 `1e-8` 标志提前拒绝合法候选。
- `src/robotics/ik-waypoint-solver.ts`：解析候选使用实际容差筛选；局部腕部 position-only 回退继续传递相邻步长护栏，并对回退结果增加姿态上限检查。按 Y±50 的可达回归选择 `2°` 上限（`1°`在第 6 个 10mm 点已无可行候选），姿态超限时保持失败结果，不覆盖为成功。
- `src/robot-models/abb-irb1200/abb-analytic-ik.ts`：几何常量统一从 `ABB_IRB1200_5_90_STANDARD_DH` 派生；J5 近零时不再除以小 `sin(J5)`，并补充以参考 J4 为中心的耦合腕部候选。
- `src/robotics/cartesian-path-planner.test.ts`：补充局部腕部姿态误差上限，以及全零位 Y±50 后 +Z 可达段不发生 J4/J6 180°跳变的回归。

### 行为边界

- J4 不被硬锁；在等价腕部分支中按连续参考选择，只有约 180°重构且无替代分支时才报告失败。
- `SingArea\\Wrist` 仍只从机械零位邻域局部触发；位置保持严格 `0.05 mm` 级别，姿态局部上限采用已确认可行的 `2°`，普通路径不放宽。
- 超出名义 DH 工作空间的目标仍报告不可达，不用腕部策略伪造成功。

### 验证

- `npm run check` 通过。
- `npm run lint` 通过（保留既有 `PoseReadout.vue` 默认 prop 警告）。
- `npm run build` 通过（仅保留既有 chunk size warning）。
- 定向测试：旋转误差、ABB 解析 IK、数值 IK、Cartesian 路径和笛卡尔控制共 42 项通过；新增回归包含 Y±50→+Z 可达段。
- `npm test`：533 项通过；保留既有 `app-profile-stability.test.ts` 的空 VueWrapper 失败，以及 CodeMirror/jsdom `getClientRects` 未处理异常，均与本次运动学改动无关。

## 2026-08-21 — 撤销会累积 TCP 姿态误差的普通腕部连续自动降级

### 原因

- 上一版把普通工作区整段平移切换为 `positionOnly`，求解时不再约束 TCP 姿态。
- 连续点动下一次规划又使用上一段已经漂移的姿态作为起点，误差逐点累积，最终表现为 TCP 姿态循环转圈。

### 修改文件与内容

- `src/robotics/ik-waypoint-solver.ts`：删除普通 `wrist-continuity` 模式及其整段位置优先求解；恢复严格姿态路径，仅保留机械零位专属 `SingArea\\Wrist` 回退和 J4 连续性软约束。
- `src/robotics/cartesian-motion-planner.ts`：删除普通工作区的漂移阈值触发和自动重规划，不再把可执行的严格路径改成姿态放宽路径。
- `src/application/cartesian-control.ts`、`src/components/CartesianControlPanel.vue`：删除普通腕部连续状态和提示，避免界面误导为已启用安全的姿态策略。
- `src/App.vue`、`src/robotics/cartesian-path-planner.ts`、`src/robotics/cartesian-path-planner.test.ts`：同步恢复策略说明和测试边界。

### 行为边界

- 普通工作区重新使用完整 TCP 位姿约束；只有机械零位腕部奇异邻域才允许自动进入 `SingArea\\Wrist`。
- 后续若要实现“J4/J6 尽量不动、J5 小幅补偿”，必须增加带姿态误差上限的受约束求解器，不能再次使用整段 `positionOnly` 代替 TCP 姿态。

## 2026-08-21 — 增加普通平移的腕部构型连续策略

### 问题原因

- 原策略只在机械零位 `SingArea\\Wrist` 回退中约束 J4，普通上下/左右平移仍严格保持 TCP 姿态，导致 J4/J6 可能承担大幅姿态补偿，而 J5 几乎不动。
- 这与“位置直线优先、腕部构型连续、允许有限姿态误差”的笛卡尔点动策略不一致。

### 修改文件与内容

- `src/robotics/ik-waypoint-solver.ts`：新增独立的 `wrist-continuity` 路径模式；位置优先求解时对 J4/J6 使用强连续性权重，对 J5 使用较弱权重，不再把该策略混同为机械零位 `SingArea\\Wrist`。
- `src/robotics/cartesian-motion-planner.ts`：普通纯平移先执行严格姿态规划；当 J4/J6 相对起点累计漂移超过 `10°`，或严格规划诊断明确指向 J4/J6 时，自动重规划腕部构型连续路径。该策略仅由平移按钮触发，字段直达和旋转点动不触发。
- `src/application/cartesian-control.ts`、`src/components/CartesianControlPanel.vue`：新增 `wrist-continuity-solved` 状态和对应提示，明确显示“J4/J6 优先保持，姿态允许局部误差”，不再误称为 `SingArea\\Wrist`。
- `src/App.vue`：同步更新连续规划注释，确保普通腕部连续策略与机械零位特例都使用串行规划语义。
- `src/robotics/cartesian-path-planner.test.ts`：新增普通平移显式腕部构型连续模式的 TCP 位置回归测试。

### 行为边界

- 严格姿态且腕部漂移未超过阈值时，保持原有严格结果。
- 普通连续策略自身规划失败时回退原严格结果，不会因为新增策略阻断原本可执行的目标。
- 机械零位的 `SingArea\\Wrist` 分支仍保持原有专属触发条件，不扩展到普通工作区。

### 验证

- `npm run check` 通过。
- `npm run lint`：0 错误，保留既有 `PoseReadout.vue` 默认 prop 警告。
- 路径规划与笛卡尔控制定向测试：26 项通过。

## 2026-08-21 — 路径失败提示增加具体关节轴诊断

### 问题原因

- 路径失败只显示“路径不可达，未执行目标”，无法判断是某个关节单步跳变、触及限位，还是根本没有任何可验收的 IK 候选。
- 机械零位腕部重构的候选可能同时包含 J3/J4/J6 大幅变化，单纯展示失败枚举不足以指导用户调整姿态或关节 Jog。

### 修改文件与内容

- `src/robotics/ik-waypoint-solver.ts`：新增 `WaypointFailureDiagnostic`，在 waypoint 失败时记录路径点序号、失败轴、当前角度、尝试角度、变化量和关节范围；腕部重构优先从 J4/J6 中选择最大跳变轴。
- `src/robotics/cartesian-path-planner.ts`：重新导出路径失败诊断类型，使同步规划和 Worker 规划共用同一返回结构。
- `src/application/cartesian-control.ts`：保存失败诊断并追加到状态提示，例如“第 8 个路径点：J4 无法继续（当前 12.30°，尝试 21.10°，变化 8.80°）”。没有任何有效候选时不伪造轴号，而是明确提示无法归因到单个关节。
- `src/robotics/cartesian-path-planner.test.ts`、`src/application/cartesian-control.test.ts`：新增关节轴诊断和界面文案回归断言。

### 影响

- 失败目标仍不会覆盖最近一次有效关节状态；本次只增加诊断信息，不改变 IK 候选选择和运动执行策略。
- 非腕部失败显示最大关节步长对应的轴；腕部构型重分配优先显示 J4 或 J6；纯工作空间不可达且没有候选时显示“无法归因到单个关节”。

### 验证

- `npm run check` 通过。
- `npm run build` 通过。
- 路径规划与笛卡尔控制定向测试：25 项通过。
- `npm test`：529 项通过；保留既有 1 项 App profile 稳定性失败和 CodeMirror/jsdom 未处理异常。

## 2026-08-21 — 腕部放宽 IK 增加 J4 软连续性目标

### 问题原因

- `SingArea\\Wrist` 的位置优先逆解只有 3 个 TCP 位置约束，J4/J5/J6 存在冗余；原数值 DLS 没有二级目标，可能在同样可达的位置解之间自行重新分配 J4。
- 不能用硬锁 J4 替代该策略，因为硬锁会把腕部姿态误差强行写入结果；这里需要的是“尽量保持 J4、必要时允许小幅变化”。

### 修改文件与内容

- `src/robotics/types.ts`：为 `IKSolverConfig` 增加 `jointContinuityReferenceDeg` 和 `jointContinuityWeights`，表达位置优先 IK 的软关节连续性目标。
- `src/robotics/ik-solver.ts`：在 DLS 正规方程中加入可选的关节连续性正则项；只在调用方显式提供参考和权重时生效，并跳过已锁定关节，不影响严格 6D 解析 IK。
- `src/robotics/ik-waypoint-solver.ts`：机械零位的局部 `wrist` 回退给 J4 传入上一 waypoint 作为参考，并使用权重 `100`；J5 的脱离奇异初值和普通工作区路径保持不变。
- `src/robotics/ik-solver.test.ts`：新增位置优先逆解保持 J4 连续、同时仍满足 TCP 位置误差的回归测试。

### 影响与边界

- 机械零位局部腕部回退会优先沿用上一 waypoint 的 J4，减少位置解冗余导致的腕部随机分配；这不是 `LockAxis4`，J4 仍可在位置约束确有需要时调整。
- 受控 DH 验证表明，位置优先模式理论上可以通过 J5 的小幅偏离完成位置目标；但将 J4/J6 同时强正则化并直接替换当前逐点 J5 逃逸初值会导致长路径中途不收敛，因此本次只启用已通过回归的 J4 软约束。
- 严格完整姿态路径、非机械零位路径和其他机器人模型不启用该正则，因此不会改变原有严格姿态行为。

### 验证

- `npm run check` 通过。
- `src/robotics/ik-solver.test.ts` 与 `src/robotics/cartesian-path-planner.test.ts`：20 项通过。

## 2026-08-21 — 用解析多分支 IK 替换机械零位 LockAxis4 近似解

### 问题原因

- 旧的机械零位修复通过 `positionOnly + J4=0` 强行获得 TCP 位置，牺牲了完整工具姿态；这不是严格 6D 逆解，不能作为工业机器人 IK。
- 数值 DLS 只返回一个初值附近的解，无法可靠表达 ABB 球腕在 J5≈0° 时的 J4/J6 构型分配，也无法让上层正确比较全部分支。
- 全零位 Y 点动的严格姿态目标在腕部奇异处确实可能没有“J4/J6 都小步变化”的连续分支，应该进入局部 `SingArea\\Wrist`，而不是把错误的 J4 锁定解当成严格姿态。

### 修改文件与内容

- `src/robot-models/abb-irb1200/abb-analytic-ik.ts`：新增基于 IK-Geo 球腕/两平行轴分解思想的 ABB 解析逆解；前三轴解析求腕心，后三轴解析求球腕，返回全部候选分支、位置/姿态残差、最小二乘标志和奇异标志。每个候选都会经过当前 DH FK 闭环验收。
- `src/robotics/types.ts`：新增严格的 `IKCandidate` 领域类型，禁止用无残差的关节数组冒充可执行解。
- `src/robotics/robot-model.ts`、`src/robot-models/abb-irb1200/dh-robot-model.ts`：增加可选 `solveAllIK()` 能力；ABB 模型接入解析候选生成，其他机器人仍可使用数值 DLS 回退。
- `src/robotics/ik-solver.ts`：严格 6D IK 优先消费解析候选；候选必须是精确解、通过姿态/位置容差和关节范围，才按参考姿态距离选择。`positionOnly`/锁定关节模式不会伪装成解析严格解。
- `src/robotics/ik-waypoint-solver.ts`：路径候选选择改为优先使用全部解析分支并执行连续步长、限位和距离选择；删除自动 `lock-axis4` 分支。`wrist` 只作为受机械零位资格限制的局部姿态放宽模式。
- `src/robotics/cartesian-motion-planner.ts`：严格规划失败后，仅当起始姿态位于机械零位腕部邻域才自动重试 `SingArea\\Wrist`；不再自动启用 `LockAxis4`，普通工作区不受影响。
- `src/application/cartesian-control.ts`、`src/App.vue`：移除 LockAxis4 会话状态和误导性状态文案，改为只在真实局部回退时显示 `wrist-solved`；平移点动允许自动进入，旋转点动和字段直达不进入。
- `src/robotics/ik-solver.test.ts`、`src/robot-models/abb-irb1200/abb-analytic-ik.test.ts`：新增多构型 FK→解析 IK→FK 闭环测试，位置残差约 `1e-13 mm`、姿态残差约 `1e-16 rad`，并把原“单初值 DLS 已知失败”回归改为解析多分支成功回归。
- `src/robotics/cartesian-path-planner.test.ts`、`src/application/cartesian-control.test.ts`、`src/rapid/movej-planner.test.ts`、`src/rapid/movel-planner.test.ts`：同步新的严格分支选择、机械零位局部腕部插补和 MoveJ 连续构型语义。

### 影响与边界

- ABB 普通工作区现在优先使用完整 6D 解析分支，J4/J6 不再通过事后锁定或姿态丢弃来“制造可达”。
- 全零位 Y 点动若严格姿态会触发腕部构型重分配，只在机械零位邻域自动进入局部 `SingArea\\Wrist`；离开后恢复严格解析 IK。
- `LockAxis4` 不再作为手动笛卡尔规划的自动补丁；RAPID 源码中的明确 `SingArea` 指令语义保持独立。
- 解析器针对当前 ABB 候选 DH 链；若替换真实控制器标定参数、工具法兰或基座变换，必须重新做 FK/IK 闭环校验，不能直接沿用名义 DH。

### 验证

- `npm run check` 通过。
- ABB 解析 IK、Cartesian path/control、MoveJ、MoveL 定向测试：67 项通过。

## 2026-08-21 — 机械零位笛卡尔平移改用受约束的 LockAxis4

### 问题原因

- 原机械零位回退使用 `positionOnly` 丢弃全部姿态约束，却没有约束 J4；J5≈0° 时 J4/J6 解不唯一，数值逆解会按初值任意重新分配腕部角度。
- 原回归只验证 Y 每次 10 mm 能走到 +500 再回到 -500，没有检查 J4；实际路径虽然全部返回成功，J4 最大已转到约 78.5°。
- 原策略仅在第一段路径的单个路点放宽姿态，随后冻结偶然得到的腕部姿态并恢复严格逆解；第二次点动便重新产生 J4/J6 累积旋转。

### 修改文件与内容

- `src/robotics/types.ts`：增加严格六轴类型 `IKLockedJointTargets`，允许逆解调用方显式声明需要固定的关节目标。
- `src/robotics/ik-solver.ts`：在初值、Jacobian 列和每次候选解验收三个位置统一执行关节锁定；LockAxis4 不再通过求解后改写 J4 破坏 TCP 结果。
- `src/robotics/ik-waypoint-solver.ts`：增加 `lock-axis4` 姿态模式；机械零位位置路径固定 J4=0°，只在路径起点确实处于腕部奇异面时注入一次 J5 脱离初值；保留 RAPID `SingArea\\Wrist` 的既有独立行为。
- `src/robotics/cartesian-motion-planner.ts`：普通目标仍先进行严格位姿规划；只有机械零位的平移按钮目标失败时才允许进入 LockAxis4。已触发的会话可显式延续，不再按每次请求的当前位置错误丢失约束。
- `src/application/cartesian-control.ts`：增加 LockAxis4 会话编排。XYZ 点动可从机械零位触发并延续；RX/RY/RZ、坐标系切换、字段直达会结束会话。状态提示改为 `SingArea\\LockAxis4`，明确 J4 保持零位且工具姿态允许误差。
- `src/App.vue`：连续点动或 LockAxis4 会话继续使用同步当前关节规划；关节 Jog、回零、随机姿态、操作轴和程序运动开始前显式结束 LockAxis4 会话。
- `src/components/CartesianControlPanel.vue`：状态样式由旧 `wrist-solved` 改为 `lock-axis4-solved`。
- `src/robotics/cartesian-path-planner.test.ts`：强化 Y +500 → -500 回归，除全程可达外同时检查 J4 绝对角和相邻变化均小于 1°。
- `src/robotics/ik-solver.test.ts`：新增位置逆解全过程锁定 J4 的数值测试。
- `src/application/cartesian-control.test.ts`：新增 LockAxis4 会话延续、旋转退出和字段直达禁止自动进入的编排测试；机械零位按钮测试改为真实调用方向按钮。
- `src/robotics/cartesian-planner-worker-adapter.test.ts`：同步新的结构化奇异模式结果字段。

### 行为边界与影响

- 从 `[0,0,0,0,0,0]` 开始，Y 每次 +10 mm 到 +500，再每次 -10 mm 到 -500，150 次目标全部成功，J4 全程保持 0°。
- LockAxis4 只能由机械零位的 XYZ 笛卡尔按钮触发；普通工作区、旋转点动、字段直达和 RAPID 严格路径不会自动放宽姿态。
- 当前 DH 模型中，从 Y=10 mm 继续严格保持完整工具姿态且固定 J4 的 Y+1 mm 目标无解；因此为满足 J4 不旋转，LockAxis4 必须在本次 XYZ 点动会话中持续允许工具姿态变化，不能在离开 J5 阈值后伪装成严格姿态规划。
- RAPID `SingArea\\Wrist` 仍使用原有 wrist 模式，没有被手动笛卡尔 LockAxis4 替换。

### 验证

- `npm run build` 通过；仅有既有主包体积提示。
- `npm run lint`：0 错误，保留既有 `src/components/PoseReadout.vue:11:3` 警告。
- `npm run lint:style` 通过。
- IK、Cartesian path/control、Worker adapter、MoveL、MoveC 定向测试：55 项通过，1 项既有预期失败。
- `npm test`：496 项通过、1 项预期失败、26 项既有 MoveJ/ProgramController/App 稳定性失败；另保留既有 CodeMirror/jsdom 未处理异常，本次没有新增完整测试失败。

## 2026-08-21 — 将轨迹与清空轨迹按钮放入同一组

### 修改文件与内容

- `src/components/SceneViewport.vue`：将“轨迹”和“清空轨迹”移动到同一个轨迹操作组中，使两个按钮始终相邻并在工具栏换行时保持不可拆分。
- `src/components/SceneViewport.vue`：保留“轨迹”的显示切换事件、 “清空轨迹”的禁用条件及清空事件，仅新增轨迹操作组的布局和无障碍分组标签。

### 影响

- 场景辅助工具栏中的轨迹相关操作更易发现，两个按钮不会再被点位、标签或操作轴按钮隔开。
- 轨迹显示状态、轨迹数量判断和清空逻辑不变。

### 验证

- `npm run check` 通过。
- `npx vitest run src/components/SceneViewport.test.ts`：1 项测试通过。

## 2026-08-21 — 完成机械零位 Y±500 的一次性腕部脱离路径

### 问题原因

- 仅使用 position-only IK 会让 J5 继续停在约 0°；从零位 Y+ 走到约 60 mm 后，严格姿态规划再次要求 J4/J6 大幅重分配并失败。
- ABB 的处理不是整条路径永久放宽姿态，而是修改奇异点另一侧第一个目标的姿态，先让腕部进入稳定构型，再恢复普通线性姿态插补。

### 修改文件与内容

- `src/robotics/ik-waypoint-solver.ts`：机械零位首次 wrist 回退使用沿 TCP 位移方向的 J5≈±5° 脱离初值；脱离成功后记录实际 FK 姿态，并让本次局部路径的后续 waypoint 使用该姿态，避免继续强制奇异姿态。
- `src/robotics/cartesian-path-planner.test.ts`：新增从全零位每次 10 mm 走到 Y+500，再走到 Y−500 的完整回归；断言 wrist 只在首次脱离段触发一次，后续使用严格姿态规划。
- `UPDATE_LOG.md`：记录本次奇异脱离策略及验收影响。

### 影响

- 从机械零位 Y+ 连续 50 次、再 Y−连续 100 次均可完成，特殊 wrist 只在 `plus:1` 的中间脱离段调用。
- 远离零位后不再重复启用 wrist，也不会把普通工作区全局降级为 position-only。
- 当前局部脱离段允许 ABB 官方定义的姿态误差；脱离后恢复严格姿态目标。

### 验证

- `npm run check` 通过。
- 相关定向测试：22 项通过。
- `npm run build` 通过。
- `npm run lint` 无错误，仅保留既有 `src/components/PoseReadout.vue:11:3` 警告。
- `npm test`：494 项通过、26 项既有 MoveJ/ProgramController/App 稳定性失败、1 个既有 jsdom/CodeMirror 未处理异常；本次新增序列回归通过，未增加失败数量。

## 2026-08-21 — 收紧机械零位奇异策略并对照 ABB 官方边界

### 问题原因

- 当前源码用同一套 DH、同一套 `FK → PoseDisplay → Y 增量 → IK` 链路验证全零位 Y+1 mm，规划器可以返回 `ok`，说明该目标不是在本项目 DH 下绝对不可达。
- 真实界面仍显示“路径不可达”时，严格姿态规划可能已经遇到腕部奇异，但数值失败被归类为 `ik-not-converged`；原 `planCartesianTarget` 只对 `wrist-singularity` / `wrist-reconfiguration` 回退，导致零位专属策略被错误跳过。
- 离散目标原本优先进入 Worker；机械零位是需要读取当前关节并立即执行局部策略的特例，不应让异步 Worker 的旧 bundle、排队或运动漂移改变结果。

### 修改文件与内容

- `src/robotics/cartesian-motion-planner.ts`：严格规划失败后，只有当起始关节处于 ABB 机械零位腕部邻域时，才允许一次 `orientationMode: 'wrist'` 局部重规划；不再依赖失败枚举必须先被正确分类。普通工作区仍直接返回严格失败。
- `src/App.vue`：机械零位腕部邻域与连续点动一样走同步 `planCartesianTarget`；其他离散目标继续使用 Worker。
- `ABB_SINGULARITY_RESEARCH.md`：记录 ABB 官方关于 J5=0 腕部奇异、严格线性插补限制、`SingArea\\Wrist`/`\\LockAxis4` 语义、另一侧首目标姿态调整和 MoveJ/MoveAbsJ/Jog 脱离边界的原始资料结论。

### 影响

- 全零位 Y± 的局部姿态误差路径不会再因普通数值失败分类而直接显示 `unreachable`。
- `SingArea\\Wrist` 仍严格限制在机械零位邻域，不会影响普通工作区的直线姿态。
- 普通工作区的不可达目标和非腕部构型跳变不被放宽；严格姿态失败仍按原错误返回。

### 验证

- `npm run check` 通过。
- `src/robotics/cartesian-path-planner.test.ts` 与 `src/application/cartesian-control.test.ts`：21 项通过。

## 2026-08-21 — 恢复连续笛卡尔点动的串行规划语义

### 问题原因

- 对比 `f3fa79b34663326107017b8b7edbc30507188159` 发现旧版连续点动是“同步 planCartesianPath → 立即提交轨迹”；IK 计算期间 RAF 不会推进机器人，因此规划初值和提交时当前位置一致。
- 当前 Worker 方案让 RAF 与 IK 并行，连续点动每次约 `0.6°` 自然漂移都会触发额外重算，造成约 `90～100ms` 的双倍规划周期。

### 修改文件与内容

- `src/App.vue`：连续点动直接调用同步 `planCartesianTarget`；离散笛卡尔目标继续使用 Worker，长路径不会阻塞界面。
- `src/application/cartesian-control.ts`：规划 adapter 接收 `isContinuous`，连续目标从每个 tick 的实际 `pose/joints` 规划；删除异步期间累加虚拟目标的 `pendingContinuousTarget`。
- `src/application/cartesian-control.test.ts`：将连续点动回归改为锁定旧版实际位姿基准语义。

### 影响

- 连续长按不再与 Worker 并行竞态，不会因 `drift/retry` 把一个 tick 拆成两次 IK。
- 机械零位的 wrist 策略仍由同步 `planCartesianTarget` 执行；普通位置仍不会自动开启 wrist。
- 离散字段输入和非连续目标仍可通过 Worker 规划，保留界面响应能力。

### 验证

- `npm run check` 通过。
- Cartesian control、Worker adapter 相关 17 项测试通过。
- `npm test`：493 项通过、26 项既有 MoveJ/ProgramController/App stub 失败、1 个既有 jsdom/CodeMirror 未处理异常；本次连续模式修复未增加失败数量。

## 2026-08-21 — 增加连续笛卡尔规划耗时诊断输出并限制重复重算

### 修改原因

- 用户反馈新增 Worker 后连续笛卡尔点动体感变慢，需要区分队列等待、IK 计算和位置漂移重规划的耗时来源。

### 修改文件与内容

- `src/robotics/cartesian-planner-worker-adapter.ts`：在请求启动和结果回收边界输出 `[CARTESIAN-PLANNING]` 计时日志，包含 `queueMs`（本次尝试排队等待）、`computeMs`（Worker 计算）、`totalMs`（本次尝试总耗时）、`driftDeg`（计算期间关节漂移）、`retryCount`、`retry`、`staleAccepted` 和 `hasQueuedRequest`。
- 将规划期间自然漂移阈值设为 `1°`：日志中的约 `0.6°` 连续运动漂移直接接续，不再为每个 tick 重复 IK；超过 `1°` 的明显过期结果最多允许一次重算，第二次仍漂移时接受结果，避免连续长按被重复 IK 永久占用 Worker。重算尝试重新记录时间起点，避免把重算累计时间误报为 `queueMs`。

### 使用方式

- 打开浏览器 DevTools 的 Console，筛选 `[CARTESIAN-PLANNING]`。
- 连续长按笛卡尔按钮后，可据此判断是排队慢、IK 慢，还是因当前位置推进触发重规划。

### 验证

- `npm run check` 通过。
- Worker adapter、Cartesian control 定向测试 17 项通过。

## 2026-08-21 — 修复连续笛卡尔点动使用旧关节快照导致的抽动

### 问题原因

- 长按笛卡尔按钮时，Worker 规划请求可能在队列中等待；原实现把 `initialJoints` 固定在请求入队时，真正启动时已经不是机器人当前位置。
- Worker 计算期间 MotionRunner 仍会推进上一条轨迹；原实现收到旧规划结果后直接提交，轨迹第一段可能回到历史 waypoint，造成机械臂抽动。

### 修改文件与内容

- `src/robotics/cartesian-planner-worker-adapter.ts`：新增当前关节读取 seam；Worker 真正启动时重新快照关节。记录活动规划的初值，结果返回时若计算期间关节漂移超过 `0.25°` 且没有更新请求，则丢弃旧结果并从当前位置重规划；已有更新请求则让最新请求从当前姿态启动。
- `src/App.vue`：将 Worker adapter 创建移动到关节状态初始化之后，注入 MotionRunner 同源的当前关节读取函数。
- `src/robotics/cartesian-planner-worker-adapter.test.ts`：新增排队快照和计算期间漂移两项回归，锁定长按连续点动的最新位置语义。

### 影响

- 连续笛卡尔点动不再把规划初值固定为上一请求或上一时刻的位置；旧结果不会覆盖当前运动状态，也不会回放历史 waypoint。
- 最新目标优先、显式取消和普通工作区不触发 wrist 的既有策略保持不变。

### 验证

- Worker adapter、Cartesian control、MotionRunner：35 项测试通过。
- `npm run check` 通过。
- `npm test`：491 项通过、26 项既有 MoveJ/ProgramController/App stub 失败、1 个既有 jsdom/CodeMirror 未处理异常；本次新增回归未增加失败数量。

## 2026-08-20 — 迁移 RAPID 预设程序到修正后的 ABB 零位

### 背景
- J5 零位与六轴正方向修正后，预设 1～5 仍使用旧 DH 零位下的 robtarget，实际规划会报不可达。
- 本次仅迁移预设程序，不修改 MoveJ、MoveL、MoveC、IK 或其他测试的行为。

### 改动
- `src/application/preset-programs.ts`：重新示教预设 1～5 的 robtarget，复用预设 6 已验证的 `[0,1,0,0]` 工具姿态和空间包络；整体参考范围约为 X `201～701 mm`、Y `-238～238 mm`、Z `747～867 mm`。
- 预设 1 保留低速矩形描边和垂直升降；预设 2 保留自定义 Tool/WObj 与 Offs 三站取放；预设 3 保留条件与循环控制流；预设 4 保留六工位 MoveJ/MoveL 搬运；预设 5 保留锯齿路径与 MoveC 圆弧。
- 预设 6 的原有液晶数字点位在新关节范围内仍可规划，因此保持不变。
- 根据用户反馈再次放大前五个预设：矩形描边达到约 `300×294 mm`，控制流五角横向跨度达到约 `500 mm`，六工位和锯齿路径覆盖接近预设 6 的整体幅度。
- 同步调整预设注释与下拉描述，使界面标注与实际运动尺寸一致。

### 影响与验证
- 六个预设均能被 RAPID parser 无诊断解析，并能由真实 `planMoveJ`、`planMoveL`、`planMoveC` 按程序顺序完整规划。
- `npm run check` 通过；`src/application/preset-programs.test.ts` 4 项测试通过。

## 2026-08-20 — 六轴 DH/FBX 方向与官方关节范围复核

### 背景
- 用户要求将 J5 的数学核验方法扩展到全部六轴，并从厂家资料核对每个轴可向正、负方向旋转的角度。
- 本次明确分离两类真值：关节工作范围来自 ABB 官方产品规格；零位、轴线与正角方向来自项目 DH 链和实际 FBX 层级的几何闭环。

### 官方范围结论
- 采用经典 ABB IRB 1200-5/0.9（不是 IRB 1200 Gen2）的官方范围：J1 `-170°～+170°`、J2 `-100°～+130°`、J3 `-200°～+70°`、J4 `-270°～+270°`、J5 `-130°～+130°`、J6 默认 `-400°～+400°`。
- `src/robot-models/abb-irb1200/robot-config.ts`：范围数值保持不变，补充 ABB 文档号 `3HAC081417-001` 与型号说明，防止误用 Gen2 的 J1/J2/J4 范围。

### 六轴数学验证
- `src/scene/abb-fbx-j5-motion.test.ts`：基于真实 FBX 增加 J1～J6 的统一验证；逐轴读取 FBX 世界旋转轴，与 DH 关节前一 frame 的 Z 轴经场景转换后做点积，六轴均大于 `0.999`。
- 对每个轴单独施加 `+5°`，验证自身旋转中心位移小于 `0.01 mm`，并验证旋转增量轴与 DH 正轴同向；结果确认 J1/J4 使用 FBX 原轴，J2/J3/J5/J6 使用 FBX 反向局部轴。
- J5 额外保持专用几何断言：零位法兰径向与 J4 正轴同向、J5 中心落在 J4 轴线上、旋转半径恒定。
- `src/scene/abb-scene-transform.test.ts`：同步修正后的机械法兰零位与视觉工具偏移方向。
- `src/application/builtin-program.ts`、`src/application/builtin-program.test.ts`：将旧 J5 零位下的默认示例点位迁移为新 DH 链生成的非奇异可达点位，保留 MoveJ → MoveL → MoveJ 教学流程。

### 影响与验证
- 六轴面板角度的正号现在同时对应 DH 正方向和 FBX 实际运动方向；官方上下限无需调整。
- `npm run check` 通过；六轴 FBX、ABB DH、范围配置、场景转换和参考链共 6 个测试文件、20 项测试通过；内置 RAPID 示例 3 项真实规划验收通过。

### 参考
- [ABB IRB 1200 Product Specification（OmniCore，3HAC081417-001）](https://library.e.abb.com/public/2a49a455c8cb40ccbd757b2dc9f33f4a/3HAC081417%20PS%20IRB%201200%20on%20OmniCore-en.pdf)
- [ABB IRB 1200 Product Specification（IRC5，3HAC046982-001）](https://library.e.abb.com/public/1d83d6154b384b0d9106e9cca48cbb5c/3HAC046982%20PS%20IRB%201200%20on%20IRC5-en.pdf)

## 2026-08-20 — 修正 J5 零位径向与 J4 DH 轴线错位

### 背景
- 用户反馈的是在关节面板调整 J5 时，圆轨迹缺口的径向没有与 J4 DH 轴线同向；本次排查只分析 J5 关节运动的 DH/FBX 几何关系，不以笛卡尔操作轴或截图作为判断依据。
- 数学复现显示，修正前 J5 零位径向与 J4 正轴的点积为 `-0.00239`，接近垂直而非同向，确认 J5 零位整体错开约 90°。

### 改动
- `src/robot-models/abb-irb1200/robot-config.ts`：删除 J5 的 `+90°` DH 固定偏置，使 J5=0° 时 J6/机械法兰从腕部中心沿 J4 正轴伸出。
- `src/scene/abb-scene.ts`：为 FBX 原始资产增加 J5 `-90°` 零位校正；用户输入角度、正负方向和关节限位保持不变，显示模型与修正后的 DH 零位一致。
- `src/scene/abb-fbx-j5-motion.test.ts`：新增真实 `ABB_IRB1200_5_90.fbx` 回归测试，验证 J5 零位径向与 J4 正轴点积大于 `0.999`、J5 轴心落在 J4 轴线上、J5 改变 5° 后轴心保持不动且旋转半径不变。
- `src/robot-models/abb-irb1200/abb-kinematics.test.ts`：更新零位法兰位置与腕部轴向断言，锁定法兰沿 J4 正轴伸出的几何关系。
- `src/scene/abb-dh-debug-chain.ts`：保留 J6/法兰显示轴心分离修正，使 DH 参考链的腕部末端标记不再与 J5 重合。
- `src/scene/abb-transform-gizmo.ts`：撤销本次问题无关的旋转操作轴局部空间改动，避免把笛卡尔 Gizmo 行为与 J5 关节面板验证混在一起。

### 影响与验证
- 默认零姿由“腕部向下折转 90°”改为“J6/法兰沿 J4 正轴直伸”；零位机械法兰坐标由约 `[451, 0, 807.1]` mm 改为 `[533, 0, 889.1]` mm。
- J5 轴心到 J4 轴线仍约 0.46 mm，说明旋转中心无需改动；修正只处理零位角偏置。
- `npm run check` 通过；J5 FBX、ABB DH、配置、场景轴和参考链共 5 个测试文件、16 项测试通过。

## 2026-08-20 — ABB DH 关节正方向与 FBX 轴映射校正

### 背景
- 复核 ABB IRB 1200-5/0.9 的 DH 参考链后发现，原实现把 FBX 局部轴方向直接混入 DH `thetaSign`，导致 J2、J3、J5、J6 的控制面板正方向与 DH 参考链相反。
- ABB 官方《Product Specification》给出的 5/0.9 关节范围为 J1 `±170°`、J2 `-100°/+130°`、J3 `-200°/+70°`、J4 `±270°`、J5 `±130°`、J6 默认 `±400°`；本次未改动这些已核对的用户限位。

### 改动
- `src/robot-models/abb-irb1200/robot-config.ts`：将六轴 DH `thetaSign` 统一为 `+1`，明确关节输入使用 ABB/DH 正方向；保留 J2 `-90°` 固定偏置。J5 原 `+90°` 固定偏置已在后续几何复核中删除。
- `src/scene/abb-scene.ts`：将 FBX 的 J2、J3、J5、J6 局部旋转轴翻转为 DH 正轴对应的方向，使三维模型与面板角度同向；J1、J4 保持原方向。
- `src/scene/abb-dh-debug-chain.ts`：参考链的 J6 标记改用实际末端 frame 的轴心，避免 J6 与 J5 重合造成腕部参考线穿模。
- `src/robot-models/abb-irb1200/robot-config.test.ts`：更新 DH 正方向断言，防止负号映射回归。
- `src/scene/abb-scene.test.ts`：补齐六个 FBX 轴向量的断言，锁定视觉层与 DH 层的方向契约。

### 影响与验证
- 现在同一组 J1～J6 数值在 DH 正解、关节面板和 FBX 三维模型中的正负方向一致；上下限显示仍保持 ABB 5/0.9 规格。
- `npm run check` 通过。
- ABB 配置、DH 正解、场景轴、J5 FBX 运动与 IK 相关测试：4 个测试文件、18 项通过（含 1 项既有 expected-fail）。
- `npm run build`、`npx prettier --check`、`npm run lint -- --quiet`、`git diff --check` 均通过。

### 参考
- [ABB IRB 1200 Product Specification](https://library.e.abb.com/public/1d83d6154b384b0d9106e9cca48cbb5c/3HAC046982%20PS%20IRB%201200%20on%20IRC5-en.pdf)
- [ROS-Industrial IRB 1200-5/0.9 URDF](https://raw.githubusercontent.com/ros-industrial/abb/noetic-devel/abb_irb1200_support/urdf/irb1200_5_90_macro.xacro)

## 文档：README 英文主文档与中文镜像

### 改动
- `README.md`：改为英文主文档，整理项目定位、功能、RAPID 教学子集、架构、启动命令、GitHub Pages 部署、扩展方向和 AGPL 许可证说明。
- `README.zh.md`：新增中文项目说明，内容与英文主文档保持对应。
- 两个 README 顶部互相添加 `English` / `简体中文` 切换链接。

### 影响与验证
- GitHub 项目默认打开英文 README，中文用户可通过顶部链接切换到 `README.zh.md`。
- `npx prettier --check README.md README.zh.md` 与 `git diff --check` 通过。

## 视觉：主页功能图改为当前工作台截图

### 改动
- `public/images/hero-preview.png`：替换为当前 `/lab` 工作台全屏截图，包含 ABB 三维场景与 RAPID 编辑器。
- `public/images/hero-robot.png`：替换为当前项目三维场景截图，展示实际加载的 ABB 机器人模型。
- `public/images/hero-grasp.png`：替换为当前项目六轴关节手动控制面板截图。
- `public/images/hero-camera.png`：替换为当前项目程序数据面板截图。
- 截图统一使用 1920×1080 浏览器视口，避免主页继续引用 `6frobot` 的示例图片。

### 影响与验证
- 主页预览、功能卡片和流程区域现在展示 RoboTeachMS Lab 自身界面，品牌与功能说明保持一致。
- 不改变工作台交互、机器人模型、RAPID 解析和运动学逻辑。
- 已检查四张 PNG 资源均已写入 `public/images/`，后续随 Vite 构建自动打包。

## 仓库：统一使用 mater 分支

### 改动
- 删除本地 `master` 分支，当前工作分支统一为 `mater`。
- 核对远端分支，仓库仅保留 `mater`、`gh-pages`，远端默认分支指向 `mater`。

### 影响与验证
- 后续提交和推送均使用 `mater`，不再维护 `master`。
- 当前工作区干净，`git branch --show-current` 返回 `mater`。

## 仓库清理：移除本地研究与原型文件

### 改动
- `.scratch/`：从 Git 跟踪中移除，继续保留本地目录并由 `.gitignore` 忽略。
- `.vscode/`：取消 `extensions.json` 的跟踪例外，整个编辑器配置目录不再进入仓库。
- `prototype-design-variants.html`：从 Git 跟踪中移除，并加入忽略规则；该文件并非 `e2eprototype-design-variants.html`。
- `.gitignore`：补充编辑器配置和本地原型文件的忽略规则。

### 影响与验证
- 远端最新文件列表不再包含本地研究资料、编辑器配置和设计原型页面。
- 本地文件保留，不影响开发环境和现有功能。

## 页面：移除点位示教卡片并禁用首页 Emoji

### 改动
- `src/components/HomePage.vue`：删除“点位示教与末端操作”功能卡片及其图片、说明和能力列表。
- `src/components/HomePage.vue`：将剩余功能卡片的 Emoji 图标替换为 Lucide 机器人图标与终端代码图标，首页不再渲染 Emoji。
- `public/images/hero-grasp.png`：删除已无引用的点位示教截图资源。

### 影响与验证
- 首页功能模块由三项调整为两项，内容与当前保留的机械臂控制、RAPID 编程功能一致。
- 不影响 `/lab` 工作台、机器人运动学和 RAPID 执行逻辑。

## 发布：接入 RoboTeachMS-Lab 仓库与 GitHub Pages

### 改动
- .github/workflows/deploy-gh-pages.yml：参考 6frobot 的 GitHub Pages 工作流，改为监听 mater 分支，使用 Node 20、npm ci、npm run build 和 peaceiris/actions-gh-pages 发布 dist。
- vite.config.ts：GitHub Actions 构建时使用 /RoboTeachMS-Lab/ base，保证项目页资源路径正确；本地开发仍使用根路径。
- index.html、src/App.vue、src/scene/abb-scene.ts、src/scene/kuka-scene.ts：将 favicon、品牌图和机器人模型 URL 改为兼容 Vite base 的路径。
- src/components/HomePage.vue：右上角 GitHub 链接改为 https://github.com/WhitePlusMS/RoboTeachMS-Lab。

### 影响与验证
- 导入目标仓库时保留其 mater 分支已有的 GNU AGPL v3 LICENSE，不覆盖或删除许可证。
- npm run check、npm run lint:style、npm run build、Prettier 和 git diff --check 通过。

## 微调：调整主页 Hero 图片与品牌底色

### 改动
- src/components/HomePage.vue：将 Hero 机器人图片桌面端右侧偏移从 4vw 调整为 10vw，使图片整体向左；同步优化窄屏偏移。
- src/components/HomePage.vue：移除 brand-logo 的红色渐变背景，直接显示透明 PNG 徽标。

### 影响与验证
- 仅影响主页视觉布局，不改变主页内容、路由和工作台逻辑。
- npm run check、npm run lint:style、Prettier 和 git diff --check 通过。

## 页面：新增 RoboTeachMS Lab 独立主页

### 改动
- src/components/HomePage.vue：参考 6frobot 主页结构新增深色 Hero、网格光效、品牌导航、指标卡、工作台预览、功能介绍、学习步骤和页脚；主页不展示现有 RAPID/Jog 工作台面板。
- src/App.vue：增加轻量路径切换，根路径显示主页，/lab 显示现有机器人工作台；主页按钮进入 /lab，工作台左上角徽标返回主页。
- public/images/：复用主页布局所需的 Hero、预览和功能插图资源。

### 影响与验证
- 不改变机器人运动学、RAPID 解析、程序执行和三维工作台逻辑；仅增加入口页面与导航状态。
- npm run check、npm run lint:style、npm run build 和 Prettier 检查通过。

## 视觉：生成 RoboTeachMS Lab Hero 机器人线稿

### 改动
- 以 6frobot 的 hero-outline.png 为风格参考，使用 GPT Image 生成新的主页 Hero 图片：通用六轴工业机器人、末端示教/编程界面、白色技术线稿、透明背景，并为左侧标题保留留白。
- public/images/hero-outline.png：替换为本次生成的 Hero 图片；主页现有 HomePage.vue 路径保持不变。

### 影响与验证
- 仅改变主页 Hero 的视觉资源，不影响工作台、运动学、RAPID 解析和程序执行逻辑。
- 图片已复制到项目资源目录，构建引用路径保持有效。

## 文档：重写 RoboTeachMS Lab README

### 改动
- `README.md`：参考 `6frobot` 的项目说明结构，重新整理项目定位、核心功能、RAPID 教学子集边界、技术栈、架构、坐标单位、启动命令、测试命令和目录结构。
- 文档名称统一为 `RoboTeachMS Lab · 工业机器人示教编程实验室`，说明当前默认使用 ABB IRB 1200，同时保留 KUKA、汇川等厂商适配的扩展方向。
- README 增加 `public/brand/roboteachms-logo.png` 项目徽标展示，并明确项目不等同于完整 RAPID 编译器或真实控制器仿真器。

### 影响与验证
- 仅更新项目文档，不改变运行逻辑、运动学、RAPID 解析或 UI 行为。
- `npx prettier --check README.md` 和 `git diff --check` 通过。

## 更新：使用 GPT Image 生成 PNG 徽标

### 改动
- 使用 GPT Image 生成“白色工业机械臂 + 示教机器人头部、透明背景”的 LOGO 图片。
- `public/brand/roboteachms-logo.png`：保存 GPT Image 生成的 PNG 徽标。
- `src/App.vue`：将顶栏标记从内联 SVG 改为实际 PNG 图片，标记尺寸调整为 34px，继续保留红色渐变底。

### 影响与验证
- 顶栏现在直接显示 GPT Image 生成的 PNG 图片，不再使用手写 SVG 代替；图片使用 `object-fit: contain` 保持比例。
- `npm run check` 通过。

## 更新：替换 RoboTeachMS Lab 简笔徽标

### 改动
- `src/App.vue`：将顶栏红色方形中的字母 `A` 替换为机器人头部与机械臂组合的内联 SVG 简笔徽标；标记尺寸由 22px 调整为 30px，并保留原有红色渐变背景。
- `src/App.vue`、`index.html`：页面标题统一为 `RoboTeachMS Lab · 工业机器人示教编程实验室`。

### 影响与验证
- 顶栏徽标保持红底白线稿风格，使用 SVG 可在放大后保持清晰；不影响机器人场景、操作轴和程序执行逻辑。
- `npm run check` 通过。

## 修复：旋转操作轴仍从 FBX 视觉偏差位姿求解

### 背景
上一轮增加多初值 IK 后，旋转拖拽仍可能提示“末端位置不可达”并回弹。继续检查后发现，
问题不只在 IK 收敛：操作轴空闲时直接跟随 FBX `joint6` 世界位姿，而 IK 使用的是 DH
机械法兰 Pose。现有 E2E 测量证明 FBX 与候选 DH 在零位存在约 12.45 mm 的视觉建模偏差；
旋转模式保持位置不变，因此每次旋转都会把这个错误位置带入 IK，表现为从未知上一个姿态开始求解。

### 改动
- `src/robotics/math/scene-pose-transform.ts`：新增 `abbPoseToSceneTransform`，把 ABB
  机械法兰 Pose（毫米、旋转矩阵）转换为场景位姿（米、四元数），与现有
  `sceneTransformToAbbPose` 互为闭环。
- `src/scene/abb-transform-gizmo.ts`：增加可选的权威 Pose 回调；操作轴空闲跟随和失败回弹
  优先使用 DH 机械法兰位姿，只有未提供回调时才降级读取 FBX `joint6`。
- `src/scene/abb-scene.ts`、`src/components/SceneViewport.vue`、`src/App.vue`：贯通
  `getGizmoPose` 回调，由页面统一从 `profile.model.forwardKinematics(joints)` 提供当前法兰真值。
- `src/robotics/math/scene-pose-transform.test.ts`：新增 DH 法兰 Pose→场景→ABB 的旋转拖拽起点
  闭环测试。

### 影响与验证
- 操作轴显示位置和回弹基准改为 DH 机械法兰，不再把 FBX 约 12 mm 的近似误差当成 IK 目标；
  FBX 仍只负责视觉呈现，未改变关节范围、IK 容差或既有平移/程序运动语义。
- `tsc --noEmit` 通过；相关 Vitest：3 files / 20 passed；多初值旋转扫描仍为全范围
  71/2000 失败、中段 1/2000 失败（均不劣于单初值）。

## 调整：页面默认加载预设「1 · 大范围慢速运动演示（无限循环）」

### 背景
用户确认希望页面启动时默认加载的任务是「大范围慢速运动演示（无限循环）」预设（`preset-1`）。
此前默认加载的是内置示例 `TeachingDemo`（三段式 MoveJ→MoveL→MoveJ）。

### 改动
- `src/App.vue`：`loadPersistedRapidSource()` 在无 localStorage 持久化内容时，回退到
  `findRapidPreset('preset-1')`（大范围慢速运动演示），而非内置示例；
  若预设缺失仍有 `createBuiltinRapidSource()` 兜底。

### 影响与验证
- 仅影响「无本地源码记录时的首次加载默认值」；localStorage 已有内容、用户手动编辑/加载预设的行为不变。
- `npm run check` 通过；`npm test`：55 文件 / 494 passed + 1 expected-fail（既有 `it.fails` 已知限制；
  jsdom 下 CodeMirror `getClientRects` 未处理异常为既有环境问题，与本次改动无关）；
  `npm run build` 通过；`git diff --check` 干净。

## 修复：末端拖拽操作轴「旋转」误报不可达而回弹

### 背景
用户反馈：操作轴的「旋转」模式会莫名弹出「末端位置不可达，操作轴已回弹至最近可到达位置」，
明明很多旋转是可到达的却被当成不可达回弹（平移正常）；且提示旋转像是从某个「上一个姿态」开始求解。

### 根因
`App.vue` 的 `solveGizmoTarget` 此前只调用单初值 `solveIK(pose, joints, model, {}, ranges)`。
用真实 `solveIK` 扫 2000 个随机可达姿态做 5° 纯旋转（位置不变）复现：全关节范围内失败率约 **4.3%**、
典型中段关节 0.4%。失败集中在**手腕/关节贴边或奇异附近**——此时单初值 LM-DLS 陷入狭窄收敛盆地
被误判不可达。项目里 MoveJ/L/C 规划早已用共享多初值策略（`resolveJointSolution`/`buildAlternateIKSeeds`）
规避同类问题，但该策略会**拒绝贴边解**，用在末端拖拽上反而更糟（拖拽本来就允许停在边界）。

### 改动
- `src/robotics/ik-waypoint-solver.ts`：新增 `solveGizmoTarget(targetPose, referenceJoints, model, jointRanges, solverConfig?)`。
  以当前关节为主初值，失败后扫 `buildAlternateIKSeeds` 的确定性格构翻转备用初值，选离当前关节
  最近的**可达**解；与 `resolveJointSolution` 唯一区别是**不拒绝贴边解**（拖拽可合法停在关节边界）。
- `src/App.vue`：`solveGizmoTarget` 改调新的 `solveGizmoIK`（`ik-waypoint-solver.solveGizmoTarget`）；
  移除不再使用的 `solveIK` 导入。
- `src/robotics/gizmo-solver.test.ts`（新增）：随机可达姿态小幅旋转，断言多初值失败率不劣于单初值。

### 影响与验证
- 真实 `solveIK` vs `solveGizmoTarget` 失败率：全范围 4.3%→**3.6%**，中段 0.35%→**0.05%**（2000 样本）。
- `npm run check` 通过；vitetst（ik-solver/ik-waypoint/gizmo-solver/movej/movel/movec）50 passed + 1 expected-fail
  （既有 `it.fails` 已知限制，与本改动无关）；lint 0 error；prettier 通过；`git diff --check` 干净。

## 修复：CodeMirror 迁移后遗留的 4 个组件测试文件

### 背景
编辑器迁移 CodeMirror 6（commit 9d189298）后，4 个组件测试文件仍用旧 textarea / .source-line 的交互与 DOM 写法，对 CodeMirror（contenteditable + .cm-gutterElement）全部失效：gutter 多一个隐藏测量元素、点击 gutter 事件挂不到 contentDOM、找不到 textarea 与 .source-line。共 15 个用例失败，现全部修复。

### 改动（测试为主，产品仅两处有真实依据）
- src/components/RapidSourceEditor.test.ts：gutterCells 过滤 visibility:hidden 的测量占位元素；点击 gutter 用例经 view.dom 捕获监听器派发。
- src/components/ProgramControlPanel.test.ts：运行锁定断言改为查 RapidSourceEditor 的 readonly prop；source-change 经暴露的 getView() 派发整文替换；PP/MP gutter 断言改为查 CodeMirror .cm-gutterElement 的 both-line。
- src/components/ProgramWorkspace.test.ts：编辑器实例保留断言改用 .rapid-codemirror 宿主；点击编辑器某行后插入改经 getView() 派发 selection。
- src/components/MotionArgumentPanel.test.ts：focusLine 改经 getView() 派发 selection；dblclickLine 在对应 .cm-line 上派发 dblclick。
- src/components/RapidSourceEditor.vue（产品改动一）：双击定位 emitLineActivate 由 posAtCoords（依赖真实布局屏幕坐标，jsdom 不可靠）改为 posAtDOM（按事件目标 DOM 节点定位，无布局依赖且更稳）。
- src/components/RapidSourceEditor.vue（产品改动二）：点击 gutter 行号由仅挂到 contentDOM、收不到 gutter 事件的 domEventHandlers.mousedown 改为 view.dom 捕获监听器映射单元格行号到光标，使 FlexPendant 点选行行为在 jsdom 与真机都确定可测。

### 影响与验证
- npm run check：通过。
- npm run test：54 个测试文件全绿，490 passed + 1 expect-fail。
- prettier --check 与 git diff --check：通过。

## 修复：MoveC/共享 IK 重构后的类型检查错误

### 背景
`npm run check`（vue-tsc -b）在 MoveC 与共享多初值 IK 重构汇总后报 3 个类型错误，均为 `ik-waypoint-solver.ts` 内 `solverConfig` 参数类型不一致导致。

### 改动
- `src/robotics/cartesian-path-planner.ts`：`planCartesianPath` 委托 `solvePoseWaypoints` 时参数类型由 `IKSolverConfig` 改为 `Partial<IKSolverConfig>`，与共享函数一致。
- `src/robotics/ik-waypoint-solver.ts`：`resolveJointSolution` 与 `solvePoseWaypoints` 的 `solverConfig` 参数由 `IKSolverConfig` 改为 `Partial<IKSolverConfig> = {}`，与 `solveIK`（内部 `{ ...DEFAULT_IK_CONFIG, ...solverConfig }` 合并）签名对齐；解决 `{}` 缺属性与 `Partial`→`IKSolverConfig` 不匹配两处报错。

### 影响与验证
- `npm run check`：通过（此前 3 个 TS2740/TS2345 全部清除）。
- `npm run test`：robotics/rapid/application 逻辑单测全绿；14 个失败均为 Vue 组件层（CodeMirror gutter 交互在 jsdom 下 `getClientRects` 不可用导致），与本改动无关。

## 实现 MoveC 圆弧运动指令，并在预设 5 加入圆弧路径演示

### 背景
在 RAPID 教学闭环中补全三种基础运动指令之一：`MoveC CirPoint, ToPoint, Speed, Zone, Tool [\WObj:=]`。语义为 TCP 从当前位置(P0) 经圆点(CirPoint, P1) 到终点(ToPoint, P2)，三点确定唯一圆弧，方向由“必经圆点”决定。此前 MoveJ/MoveL 已支持，MoveC 缺失。

### 改动
- `src/rapid/plan-shared.ts`：抽出与 movej 共用的多初值 IK 求解 `resolveJointSolution`（主初值 + 确定性构型翻转备用初值，选取离参考关节最近的解）及 `buildAlternateIKSeeds`——提升圆弧这类连续位姿的逆解鲁棒性，避免单一连续性初值陷入窄收敛盆地。参数类型放宽为 `readonly (readonly [number, number])[]` 以便 movej/movec 共用。
- `src/rapid/movej-planner.ts`：删除本地重复的备用初值/最近解实现，改从 `plan-shared` 导入共享的 `resolveJointSolution`（行为不变重构）。
- `src/rapid/movec-planner.ts`：`solvePoseWaypoints` 改用共享的 `resolveJointSolution` 逐点求解；`planMoveC` 校验圆点与终点（圆点先前未过校验，NaN 会流入坐标求值表现为 unreachable），修复圆弧采样四元数传递：以机器人核心内部 `[x,y,z,w]` 序传给 `sampleArcPoses`（此前误包成 RAPID `[w,x,y,z]` 序，制造错误旋转矩阵致 IK 失败）。
- `src/rapid/arc-planner.ts`（前置里程碑）、`src/rapid/rapid-types.ts`、`src/rapid/rapid-parser.ts`、`src/rapid/program-executor.ts`、`src/application/program-control.ts`：为 MoveC 提供结构化类型、解析、执行 seam。
- `src/rapid/movec-planner.test.ts`：默认圆弧改用“home 朝向 + 数值逆解良态区域”的可达圆弧（原 identity 朝向 + 经过奇异带的圆弧不可规划）。
- `src/rapid/rapid-parser-corpus.test.ts`：MoveC 断言从 `result.program` 改到不受 canExecute 门控的 `result.instructions`（MoveAbsJ 使整程序不可执行时 program 为空，但 MoveC 已正确解析进 instructions）。
- `src/application/preset-programs.ts`：预设 5（锯齿）左段加入一段 `MoveC cArc, w11` 圆弧过渡（圆点 `cArc=[321,-60,580]`），形成“锯齿 + 圆弧”复合路径；更新标题、描述与头部注释。
- `src/application/preset-programs.test.ts`：新增校验——按程序次序用真实 `planMoveJ/planMoveL/planMoveC` 逐条规划预设，断言全部可达且确有预设含 MoveC。

### 影响
三种基础运动指令 MoveJ/MoveL/MoveC 齐备并共用同一套数据/配置校验与多初值 IK 逆解；RAPID 教学台可演示圆弧路径。移除了 movej 内重复实现，减少重复状态；类型检查与 324+ 单测全绿。


## 末端法兰拖拽操作轴（复现 6frobot 的 Translate/Rotate Gizmo）

### 背景
用户希望复现参考项目（`E:\项目demo\6frobot`）的「末端拖拽」功能：在 3D 场景里点一个按钮，机械臂法兰末端出现可拖动的三轴（XYZ 平移）或圆弧（RX/RY/RZ 旋转）手柄，把末端拖到空间任意可到达位姿，机械臂 IK 实时跟随、松手即停在目标位姿。参考项目用 React R3F + drei `TransformControls`；本项目是 Vue 3 + 原生 imperative Three.js，因此用原生 `three/examples/jsm/controls/TransformControls.js` 复刻同一交互。

### 改动
- `src/robotics/math/scene-pose-transform.ts`（新增）：纯函数「场景 frame（米/Y 上）↔ ABB 基座 frame（毫米/Z 上）」互转，含位置与旋转矩阵的基变换（`sceneTransformToAbbPose` 等）。旋转用相似变换 `R_abb = M^T·R_scene·M`，位置换算把场景 Y 减 baseHeight 再 ×1000。
- `src/scene/abb-transform-gizmo.ts`（新增）：`AbbTransformGizmo` 封装原生 `TransformControls`，挂弱代理 dummy Object3D 跟随法兰节点（joint6）世界位姿；拖拽回调把 dummy 场景位姿转 ABB Pose → 调 `solveTargetPose`（IK）；成功应用、不可达则 dummy 回弹到法兰。拖拽时临时禁用 OrbitControls 防冲突。
- `src/scene/abb-scene.ts`：`AbbSceneOptions` 增加 `onGizmoSolve`/`onGizmoDragStart`/`onGizmoDragEnd`/`gizmoInteractive`；`AbbSceneController` 增加 `enableTransformGizmo`/`setTransformGizmoMode`；模型就绪后把 baseHeight 同步给 gizmo。
- `src/scene/scene-factory.ts`：`SceneRuntime` 增加 `camera`、`domElement`、`controls`（OrbitControls）只读字段，并把 camera/renderer/controls 的创建移到 runtime 之前避免 TDZ。
- `src/components/SceneViewport.vue`：场景辅助工具条新增「操作轴」toggle 按钮 + 开启后的「平移/旋转」子按钮；新增 props（`transformGizmoEnabled`/`transformGizmoMode`/`onGizmoSolve`/`onGizmoDragStart`/`onGizmoDragEnd`/`gizmoInteractive`）与事件，watcher 同步到 controller。
- `src/App.vue`：新增 `transformGizmoEnabled`/`transformGizmoMode` ref；`solveGizmoTarget` 用 `solveIK(pose, joints, profile.model, {}, ranges)` 求解，成功 `setJointsImmediate` 写入并停程序/动画，失败返回 false 让手柄回弹；把 gizmo 状态/求解回调透传给 SceneViewport，程序运行期间 `gizmoInteractive=false` 禁用手柄。

### 设计
按钮放场景左上角既有「场景辅助工具条」内（与网格/坐标/DH/轨迹/点位等按钮一致）：点「操作轴」开关，开启后浮现「平移/旋转」两个子按钮；当前模式高亮。拖拽开始先停活动程序与动画，避免与执行冲突。完整分析与按钮/显示设计见 `.scratch/abb-end-effector-gizmo-design.md`。

### 验证
- `npm run check`（vue-tsc -b）：本次新增/改动文件全部通过类型检查；当前工作树仅存的 1 个类型错误 `src/rapid/movec-planner.test.ts(158)` 属于并行未提交的 movec 工作（ManualMotionClock 缺 tick），与本改动无关。
- 坐标换算用 `.scratch/verify-scene-transform.mjs`（独立 Node 脚本）验证位置与旋转往返一致、单位旋转保持。
- 沙箱限制：vitest/vite 在本环境因 EPERM（子进程 realpath 解析）无法启动，故未在本会话内实际跑单测；`src/robotics/math/scene-pose-transform.test.ts` 已编写，待可在正常环境运行 `npm test` 验证。


## Program Data 行：系统预定义行（含「系统只读」+「const」）收窄为单行

### 背景
用户反馈 `ProgramData` 面板里系统预定义项（如 `speeddata v5`）那一行被撑成两行。根因：该行有 5 个单元格（名称 / 系统只读 / const / 坐标 / 未被引用），而行用的 CSS grid 只有 4 列，第 5 个「未被引用」被换到第二行。

### 改动（`src/components/ProgramDataPanel.vue`）
- `.program-data-row` 由 `display: grid`（4 列）改为 `display: flex` + `flex-wrap: nowrap`：行内子项数量不再固定，所有行型（robtarget/num/bool 4 项、系统预定义 5 项）都强制单行排布。
- `.program-data-row-coord` 改为 `flex: 1 1 auto; min-width: 0`，并在超窄时用省略号收敛（不再折行）。
- `.program-data-label`（系统/存储/引用药丸）设 `flex: 0 0 auto` 不参与压缩，保持原样显示。
- 新增 `.program-data-storage`：收窄 `const/pers/var` 标签水平内边距（`padding-inline: 5px`），满足「const 窄一点」诉求，使系统预定义行更宽松地落在单行。

### 影响
- 所有 Program Data 行型在任意宽度下保持单行；坐标列自适应伸缩，超长时省略替代换行。
- 不影响行内详情（inline-detail）等其他区块。

### 验证
- `npm run check`（vue-tsc -b）通过；eslint、stylelint、`git diff --check` 均无错误。

## 为主页面所有按钮补齐 hover 提示（title tooltip）

### 背景
用户希望主页面里所有按钮都有 hover 提示，说明该按钮的功能。此前仅有少量按钮带 `title`，大部分只有可见文字或 `aria-label`，悬停无提示。

### 改动
为主页面全部原生 `<button>` 元素补充中文 `title`/`:title` 提示（覆盖全部主页面组件，图标按钮的 title 与其既有 `aria-label` 一致）：
- `src/components/WorkbenchLayout.vue`：功能边栏(快速/数据/控制)与收起按钮。
- `src/components/ProgramControlPanel.vue`：运行/单步/停止/PP to Main 及偏离路径确认/取消（transport 与 actions 两种布局）。
- `src/components/RunLogPanel.vue`：日志过滤(全部/警告/错误)、展开/收起。
- `src/components/ToastHost.vue`、`ConfirmDialog.vue`、`PresetLibraryDialog.vue`：关闭、确认/取消、使用预设。
- `src/components/SceneViewport.vue`：场景辅助工具条(网格/坐标/DH/轨迹/点位/标签/清空轨迹)。
- `src/components/JogControlTabs.vue`、`JointControlPanel.vue`、`CartesianControlPanel.vue`：Jog 标签页、回零/随机、轴步进±、坐标/模式、方向键（按住连续）、位置/姿态步进。
- `src/components/ProgramEditorToolbar.vue`、`MotionArgumentPanel.vue`、`ProgramDataPanel.vue`：添加/编辑菜单、撤销/重做、参数选择、点位新建/选择/编辑/重命名/删除、引用定位等。
- `RapidPresetSelector.vue`、`RapidSourceEditor.vue`、`PoseReadout.vue` 原有 `title` 保留不变。

### 影响
- 仅新增 `title`/`:title` 属性（RunLogPanel 的 FILTERS 增加 title 字段），不改变任何 DOM 结构与行为；无测试依赖按钮 title，单测不受影响。

### 验证
- `npx vue-tsc -b` 通过；eslint、stylelint 对全部改动组件通过；`git diff --check` 无空白错误；脚本逐文件核对 `<button>` 均含 `title`（按钮数 = 带 title 数，17 个组件全部覆盖）。

## 修复场景角标位姿卡片毛玻璃（backdrop-filter 模糊）不显示

### 背景
用户在 Three.js 场景右下角看到的位姿角标（`PoseReadout` 紧凑模式）不再是毛玻璃样式。探查发现这是主题提交 `f02e46a` 引入的回归：`.pose-readout.compact` 的背景由原先的半透明深色玻璃 `rgba(13,15,19,.72)` 改成了共享 token `--color-overlay-bg`，而该 token 是 `rgba(255,255,255,0.88)`（近不透明白）。88% 不透明度几乎把 `backdrop-filter: blur(8px)` 背后的场景模糊全盖住，模糊只剩约 12% 透出，肉眼不可见，卡片看起来像一块实心白牌，毛玻璃失效。

### 改动
- `src/components/PoseReadout.vue`：`.pose-readout.compact` 背景改为 `color-mix(in srgb, var(--color-overlay-bg) 60%, transparent)`，由主题 token 派生低透明度玻璃底（约 0.53 不透明度），保留足够透光让 `backdrop-filter: blur(8px)` 清晰可见，毛玻璃恢复；同时保持浅色主题一致，未重新散落裸色（沿用代码库既有的 `color-mix` 派生惯例）。
- `src/components/SceneViewport.vue`：场景左上角辅助工具栏的 `.scene-aux-button`（网格/基座工具坐标/DH参考链/轨迹/点位/标签/清空轨迹）存在同一回归——`background: var(--color-overlay-bg)`（0.88 近不透明白）盖住 `backdrop-filter: blur(8px)`，毛玻璃不可见；一并改为 `color-mix(in srgb, var(--color-overlay-bg) 60%, transparent)` 派生玻璃底，hover 态同步用 `--color-overlay-bg-strong` 派生，使场景上的按钮与位姿角标统一恢复毛玻璃样式；active（`--color-brand-dim`）与 disabled（opacity）态不变。

### 影响
- 场景右下角位姿角标与场景左上角辅助按钮统一恢复半透明模糊玻璃观感；仅这两个组件的 scoped 样式变化，DOM/行为/测试不受影响；其余使用 `--color-overlay-bg` 的浮层（如 WebGL 降级遮罩）保持不变。

### 验证
- `npx vue-tsc -b`（check）通过；`npx stylelint src/components/PoseReadout.vue` 通过；`git diff --check` 无空白错误。
- 说明：vitest / vite dev server 在当前 DSH 沙箱下因 Vite 配置加载的 child-process spawn 被 EPERM 拦截（既有环境限制，非本次代码所致）；改动仅为 CSS 取值，不影响组件单测。

## 删除 3D 场景底部 caption，位姿角标下移占用其位置

### 背景
用户在 3D 场景底部原有 caption（`WORLD / BASE FRAME` · `OrbitControls`），要求整体删除，并把右下角位姿角标下移到 caption 原来的位置（底边与 caption 底边对齐），占据该区域。

### 改动
- `src/App.vue`：删除模板中 `viewport-caption` 元素（`WORLD / BASE FRAME` / `OrbitControls`）及其 `.viewport-caption` 样式块；`.scene-pose-readout` 的 `bottom` 由 `40px`（caption 上方）下移到 `12px`（原 caption 底边位置），注释同步更新。无测试引用该 caption，删除不影响单测/端测。

### 影响
- 场景右下角不再有底部 caption，位姿角标下移到底部并保持毛玻璃样式；仅该组件 scoped 样式与局部模板变化。

### 验证
- `npx vue-tsc -b`（check）通过；`npx stylelint src/App.vue` 通过；`git diff --check` 无空白错误；grep 确认无其他代码/测试引用 `viewport-caption` 与此 caption 文案。

## RAPID 编辑器迁移到 CodeMirror 6，实现 ABB 浅色语法高亮

### 背景
用户希望编辑器能像真机/VSCode 那样按语法类别分色（关键字/注释/字符串/常量…）。原编辑器是自绘 `<textarea>`，无法对字符上色。经调研比较 Monaco / CodeMirror 6 / Ace / Shiki 后选定 **CodeMirror 6**（模块化、Vue 友好、自带行号/选中/滚动/IME，社区最活跃、被 Replit/Firefox DevTools/CodeSandbox 重用）。

### 改动
- `package.json`：新增 `@codemirror/state`、`@codemirror/view`、`@codemirror/language`、`@codemirror/commands`（及 `@lezer/common/highlight/lr` 传递依赖）。
- 新增 `src/rapid/rapid-highlight.ts`：`StreamLanguage` 词法（关键字/类型/常量/注释/字符串/数字/运算符）+ ABB 官方浅色 `HighlightStyle`，导出 `rapid` 扩展。纯视图层，不与解析器冲突、不建平行符号表。
- `src/theme/tokens.ts`：新增语法高亮配色 token（`--hl-keyword/comment/string/number/constant/type`），保持单一数据源。
- `src/components/RapidSourceEditor.vue`：自绘 textarea + gutter 重写为由 CodeMirror 6 渲染。保留全部对外契约与行为：
  - props：`source/readonly/ppLine/mpLine/cursorLine/instruction/diagnosticLines/runtimeErrorLine/focusRange/focusRequestId`；
  - emits：`source-change/cursor-line-change/line-activate`；
  - 行号 gutter + PP（黄）/MP（橙）/both（渐变）/诊断（红条）/运行时错误（红底）/光标（黄 bar）标记；
  - 换行开关 Compartment、运行期只读 Compartment、Program Data 引用定位（focusRange）、双击打开参数（line-activate）、gutter 点选移动光标（FlexPendant 点选语义）；
  - 底部结构化指令摘要条保留。
- `src/components/RapidSourceEditor.test.ts`：按 CodeMirror 行为契约重写（通过暴露的 EditorView dispatch 触发，DOM 断言 `.cm-gutterElement` 类别类）。

### 修复
- 初版实现中 `LineMarker` 把 class 存进自定义字段 `className`，未覆盖基类 `GutterMarker.elementClass`，导致 CodeMirror 读到的仍是空串 → PP/MP/诊断/运行时/光标行标记全部不显示。改为重写 `elementClass` 属性后 gutter 标记恢复正常上色。

### 影响
- 编辑器区域获得语法分色，视觉与 ABB 官方浅色方案一致；配色由主题 token 一处管理。
- 展示 DOM 从 textarea 变为 CodeMirror（contenteditable），仅影响该组件内部；对外 props/emits 不变，App/ProgramControlPanel/ProgramWorkspace 无需改动。
- 新增依赖体积可控（CodeMirror 模块化按需加载）。

### 验证
- `npm run check`（vue-tsc -b）通过。
- eslint（改动文件）0 error；stylelint（组件）通过；`git diff --check` 无空白错误。
- 说明：`npm run test` 在当前 DSH 沙箱下因 Vite 配置加载的 child-process spawn 被 EPERM 拦截（既有环境限制），无法在本沙箱运行 vitest；`RapidSourceEditor.test.ts` 已按新实现重写，需在正常环境运行验证。

## 预设程序库重构：重编号 1–6，各代表一个能力维度，放大中间预设的运动范围

### 背景
用户反馈：预设程序库里只有「第 8 个（液晶数字 0–9）」和「EA（大范围运动）」有用，其余几个运动范围和能展示的事例都太小太短。要求：①重命名（原 1A/1B/2/6/7/8 改为连续编号）；②6 个示例各代表一个不同的逻辑/能力维度；③重做中间那些、放大范围，保留用户认为好用的第 8 个（最后那个几乎最通用）。

### 决策（与用户确认）
- 重排成连续编号 **1–6**：1A→1、1B→2、2→3、6→4、7→5、8→6。
- 保留 **1**（大范围慢速循环，原 1-A）与 **6**（液晶数字 0–9，原 8）的内容不动；重做中间的 **2/3/4/5**，各代表一个维度并放大运动范围。

### 改动
- `src/application/preset-programs.ts`
  - 六个预设 `id` 重排为 `preset-1..preset-6`，`name`/`description` 去掉旧编号、改为连续编号+维度说明。
  - **预设 2**（原 1-B，自定义工具/工件维度）：由原来的 q1→q2→Offs(q2)→q1 的 40mm 小样，改为「自定义 tooldata/wobjdata + 可选参数 \WObj + Offs」的三站点往返取放，跨度约 330×240mm；`MoveJ` 定位 + `MoveL Offs(...,-70)` 短距垂直取放。
  - **预设 3**（原 2，控制流维度）：由 60mm 短距相邻点，改为中/右/左/左下/右上**五角跳转**（跨度约 220×150mm），保留 IF/ELSEIF/ELSE + WHILE + FOR + EXITDO + num/bool 标量；五角已确认两两 `MoveJ` 互达。
  - **预设 4**（原 6，流水线维度）：由 5 工位（半径 ~140mm）改为**六工位**往返取放，跨度约 300×380mm。
  - **预设 5**（原 7，锯齿维度）：由 ±140mm/50mm 起伏改为绕回字形一整圈、振幅 ±80mm，跨度约 260×360mm。
- `docs/rapid-frontend-test-cases.md`：同步重写预设 1–6 的段落与源码块（原 1-A/1-B/2/6/7/8），更新「测试节奏」引用；错误/结构/不支持三族（程序 3/4/5）非预设库内容未改。
- `UPDATE_LOG.md`：本记录。

### 验证
- 用真实 `planMoveJ`/`planMoveL` 从 home 把六个预设按程序次序逐条规划（循环体展开一次）：全部指令规划成功，**ALL OK**（预设 3 曾因「上角在特定邻接构型下不可达」调整到五角全互达几何）。
- `npx vue-tsc -b`（check）通过，无类型错误。
- 说明：vitest 在当前 DSH 沙箱下因 Vite 配置加载的 child-process spawn 被 EPERM 拦截（既有环境限制，见上文记录），未运行测试；不改动任何 TS 类型/组件逻辑，`preset-programs.test.ts` 与 `PresetLibraryDialog.test.ts` 均按 `RAPID_PRESET_PROGRAMS` 动态迭代/取用，不受重命名影响。


## 「添加指令」「编辑」下拉菜单点击外部自动收起

### 背景
用户反馈：点击「添加指令」或「编辑」按钮后弹出的菜单，在鼠标点击其他区域时不会自动收回，需要再次点击按钮才关闭，交互不符合常见下拉菜单习惯。

### 改动
- `src/components/ProgramEditorToolbar.vue`：工具栏根节点绑定 `ref="rootEl"`，注册 document 级 `mousedown` 监听；当点击发生在根节点（含两个下拉菜单）之外时，同时收起 `addOpen` 与 `editOpen` 两个菜单。
- 使用 `mousedown` 而非 `click` 侦测外部点击：先于按钮的 `click` 触发，判定"在菜单外"后关闭，不与按钮自身的 toggle 逻辑争抢，避免点击外部时菜单被误重新打开。
- 卸载组件时移除监听，避免内存泄漏。

### 影响
- 打开任一菜单后点击编辑器、其他面板或页面任意空白处，菜单自动收起；点击菜单项仍按原逻辑执行并收起。
- 不改动菜单内容、指令插入/编辑逻辑与受控编辑入口。

### 验证
- `npm run check`（vue-tsc -b）通过。
- `git diff --check`：无空白错误。
- 说明：vitest 在当前 DSH 沙箱下因 Vite 配置加载的 child-process spawn 被 EPERM 拦截（既有环境限制，见上文记录），未运行测试。

## RAPID 源程序持久化到 localStorage

### 背景
用户反馈每次加载/刷新页面后源码都会重置为内置示例，需要重新输入，体验差。希望把用户编辑的 RAPID 源码存在浏览器 localStorage，刷新后保留。

### 改动
- `src/App.vue`：`rapidSource` 初始化改为先读 localStorage（键 `abb-robot-lab:rapid-source`），存在且非空时用之，否则回退到 `createBuiltinRapidSource()`。
- `src/App.vue`：`handleSetSource`（源码整体替换的唯一入口，文本编辑 / 预设加载 / 手工设值均汇聚于此）在内容实际变化时把新源码写入 localStorage。
- 读写均做 try/catch 静默降级：隐私模式 / 存储不可用 / 配额满时不打断编辑，回退内置默认。

### 影响
- 刷新或重开浏览器后，用户上次编辑/加载的 RAPID 源码自动恢复；首次访问或清空存储时仍显示内置示例。
- 未改动解析、执行、受控编辑逻辑；`handleSetSource` 仍为唯一写入口，持久化不引入第二份状态源。
- 不提交无关文件，不改写 KUKA 预留。

### 验证
- `git diff --check -- src/App.vue`：无空白错误。
- App.vue 改动无类型错误。

## 主题体系标准化重构 —— 单一数据源（tokens + scene），去除散落裸色

### 背景
梳理全系统主题后确认：CSS token 已集中在 `style.css`，但存在多处不足——`style.css` 的 `:root` 手写全部色值（值与 Three.js 场景脱钩，`--color-scene-bg` 与 WebGL `scene.background`、App 视口渐变三处各写各的深色）、场景侧 `0x...` 裸色散落、组件内少量 `#fff`/`#3b82f6` 硬编码、且 token 对 JS 不可见。与用户敲定「根本性升级、不做向下兼容/双份来源」：新增 TS 主题模块作为唯一数据源，CSS 变量运行时注入，Three.js 场景复用同一数据源。

### 设计决策（与用户共识）
- **Q1/B**：补 JS/TS 主题常量层（不做多主题切换系统）。
- **Q2/B + Q3/A**：TS 为准，运行时 `applyTheme()` 写 CSS 变量；`:root` 不再声明具体值（无兜底、无兼容层）。
- **Q4/B**：只动 ABB 侧，KUKA 预留色保持独立不受污染。
- **Q5/B**：分层目录 `src/theme/`：`tokens.ts` + `scene.ts` + `index.ts`。
- **Q6/A**：`scene.ts` 管共用中性环境色；ABB 品牌色归 `abbScene` 域。
- **Q7/A**：残留裸色全部收敛进 token。

### 改动
- 新增 `src/theme/tokens.ts`：全系统 UI 设计 token 唯一数据源（字体/圆角/表面/边框/文本/品牌/状态），按 CSS 变量名键控；新增 `--color-accent`（原 PoseReadout 未定义仅靠兜底的 `#3b82f6`）与 `--color-on-fill: #ffffff`（置彩色填充上的白字）。
- 新增 `src/theme/scene.ts`：`sceneEnvironment`（共用环境色：背景/工作台/网格/灯光/坐标轴/轨迹）与 `abbScene`（ABB 域：回退几何/robtarget/DH/标签画布），另导出 `sceneCssTokens`（`--color-scene-bg`）。
- 新增 `src/theme/index.ts`：聚合导出 + `applyTheme()` 把 tokens 与 sceneCssTokens 写入 `:root`；`style.css` 不再有任何具体色值。
- `src/main.ts`：挂载前调用 `applyTheme()` 注入主题。
- `src/style.css`：`:root` 删除全部 token 值声明，仅保留消费属性与深色 `color-scheme`。
- `src/scene/scene-factory.ts` / `scene-helpers.ts`：环境色改从 `sceneEnvironment` 取，WebGL 背景与 CSS 同源。
- `src/scene/abb-scene.ts` / `abb-dh-debug-chain.ts`：ABB 专属色从 `abbScene` 取（品牌橙、回退几何、DH 色、标签画布）。
- `src/App.vue`：视口背景改为 `var(--color-scene-bg)`（与 WebGL 同源，去掉三色渐变各写各的）；品牌 mark 渐变改 `--color-brand-strong`。
- `src/components/{ConfirmDialog,PoseReadout,RapidSourceEditor}.vue`：`#fff`→`--color-on-fill`、`#3b82f6` 兜底→`--color-accent`。
- KUKA 相关（`kuka-scene.ts`、`robot-models/kuka-like/`）未改，保留多厂商预留。

### 影响
- 配色（含 3D 场景色）只需改 `src/theme/*`，页面 CSS 与 Three.js 场景自动同步。
- 视口背景统一为单一深色（原三处 `#08090d`/`#10141b` 渐变/`0x101827` 收敛为 scene 背景 `#101827`）；WebGL 正常工作下该背景即可见色，无视觉回退。
- `main.ts` 须在挂载前完成注入；本项目为纯浏览器应用，无 SSR。

### 验证
- `npm run check`（vue-tsc -b）通过。
- eslint：改动文件 0 error（仅 PoseReadout 既有 `vue/require-default-prop` warning 不动）。
- stylelint（改动文件 `style.css`/App.vue/ConfirmDialog/PoseReadout/RapidSourceEditor/SceneViewport）：通过；未触碰的 `ToastHost.vue` 存在既有空行报错，未处理。
- `git diff --check`：无空白错误。
- 注：`npm run test` 与 `npm run build` 在当前 DSH 沙箱下因 Vite 配置加载的 child-process spawn 被 EPERM 拦截（发生在 `vite.config.ts` 解析阶段，与本次改动无关）；类型校验已由 `vue-tsc -b` 覆盖。



## 2026-08-19（续）— B 类瞬态状态提示改为 toast + 日志

### 背景
在"静态教学提示移入日志"（前一条）基础上，用户要求继续优化 **B 类条件状态提示**（随程序状态出现的通知：源程序锁定、等待下一步、偏离路径、需 PP to Main）。经确认仅采用「瞬态提示改 toast + 日志」方案；fly-by 提示、偏离路径确认弹窗化、持久禁用说明改为状态徽标三项未选用，保持不变。

### 改动 — 新增轻量 toast 通知 + 移除常驻内联提示
- 新增 `src/application/toast.ts`：`ToastLevel`/`ToastMessage`/`ToastController`，`useToasts()` 维护 toast 列表并启动自动消失计时（`TOAST_DURATION=3400ms`），`provideToasts/injectToasts` 全局提供。
- 新增 `src/components/ToastHost.vue`：Teleport 到 body 的右上角通知栈，按级别（info/ok/warn/err）着色与图标，可手动关闭、自动消失，`TransitionGroup` 过渡。
- 新增 `src/application/status-toasts.ts`：`useStatusToasts(snapshot, toasts)` 观察程序快照，在条件由假→真的**单次转换**时弹出 toast（源程序锁定 / 单步完成 / 程序错误 / 需 PP to Main / 偏离原程序路径），避免同一状态反复刷屏。
- `src/App.vue`：创建并 `provideToasts`，调用 `useStatusToasts(programSnapshot, toasts)`，模板挂载 `<ToastHost />`。
- `src/components/ProgramControlPanel.vue`：
  - transport 视图：删除 needsPPtoMain 与 offPath 两处常驻 `<p class="program-hint">`（保留 off-path 的确认块不变）。
  - content 视图：删除源程序锁定、等待下一步两处常驻提示；**保留 fly-by 提示**（该方案未选用）。
  - actions 视图：删除 needsPPtoMain 与 offPath 常驻提示。
  - 清理：移除不再使用的 `awaitingNext` computed 与孤立的 `.transport-hint` 样式。
- 测试：新增 `src/application/status-toasts.test.ts`（5 条，验证状态转换→toast 映射与"由假变真只提示一次"）；`ProgramControlPanel.test.ts` 中 4 处断言内联提示文案的用例按新行为更新（仅保留按钮禁用逻辑断言）。

### 验证
- `npm run check`（vue-tsc）、`npm run lint`（0 error，仅 PoseReadout 既有 warning 不动）、`npm test`（52 文件 471+1 通过）、`npm run build` 全过；`git diff --check` 无空白错误。



### 背景
用户要求梳理全系统页面中"直接写死在卡片下方"的提示，评估能否移入日志或小弹窗。经逐组件调研，把提示分成两类：**A 类静态教学说明**（常驻、纯解释，不随状态变化）与 **B 类条件状态提示**（随程序状态出现，如源程序锁定/需 PP to Main/偏离路径）。用户选择仅处理 **A 类**。

### A 类静态说明 → 移入运行日志（启动时写入一次）
- `src/App.vue`：`useRunLog` 创建并 `provideRunLog` 后，追加两条 `info('说明', …)` 初始日志条目（关节面板操作方式、笛卡尔方向键按所选坐标系执行），使日志栏在启动即自带教学说明，卡片下方不再常驻占位。
- `src/components/JointControlPanel.vue`：删除卡片底部常驻 `<p class="panel-hint">点击步进按钮单次调整，按住按钮可连续调整。</p>`。
- `src/components/CartesianControlPanel.vue`：`pose-card` 保留动态 `statusMessage`（就绪/FK 状态），移除其下静态提示（"当前显示为世界坐标值，方向键按 … 坐标系执行"）；该说明同样以日志条目承载。
- 说明：`CoordinateInfoPanel.vue` 的静态提示（"基坐标固定在底座…"）所在组件当前未在任何页面渲染（死代码），未触碰；`.panel-hint` 全局样式仍被其引用，保留。
- 范围裁剪：B 类条件状态提示（源程序锁定、需 PP to Main、偏离路径确认、预设不可切换、源码有错误等）属重要状态通知，保留原位可见，未迁移。

### 验证
- `npm run check`（vue-tsc）、`npm test`（51 文件 468 条全过）、`npm run build`（vite build 成功）全过；`git diff --check` 无空白错误。



### 背景
用户实测指出两处布局问题：①底部日志栏横贯整页宽度，浪费空间，期望只与 Three.js 视图等宽；②需确认右侧边栏不被截断到底部逻辑。经确认采用「右侧边栏全高」方案。

### 修改 — 日志置入中央列底部，右侧边栏全高
- `src/components/App.vue`：
  - `#center` 插槽内新增 `.center-col`（flex column）：`SceneViewport` 在上方弹性铺满（`flex: 1 1 auto; min-height: 0`），`RunLogPanel` 固定在底部（仅占中央视图宽度，不再横贯到右侧边栏下方）。
  - `.shell` 网格行由 `56px minmax(0,1fr) auto` 改为 `56px minmax(0,1fr)`：移除独立的底部日志行，主区单行占满剩余高度，因此 `WorkbenchLayout` 的右侧边栏与整个中央列等高、全高保持。
- `src/components/RunLogPanel.vue`：未改动；其根 `.run-log` 已 `flex: 0 0 auto`，拖拽调高日志时向上压缩中央视图，不推动右侧边栏。

### 验证
- `vue-tsc -b`（check）、`npm test`（51 文件 468 条全过）、`npm run build`（vite build 成功）均通过；`git diff --check` 无空白错误。
- 说明：App.vue diff 中另含此前既有的剪贴板删除等未提交改动（非本次布局），未触碰、保留原状。



### 背景
用户实测 UI 后指出两处不符合真实 FlexPendant：①光标点选 main 里的指令就自动弹出参数卡片（突兀）；②编辑菜单里的剪切/复制/粘贴在网页版与系统剪贴板重复。

### 修正 1 — 参数面板改为显式打开（真机 Change Selected 语义）
- 真机行为（3HAC050941-001 p163-164）：点选指令只高亮；**双击指令** 或 **Edit → Change Selected** 才打开参数编辑页。
- `src/components/RapidSourceEditor.vue`：新增 `line-activate`（双击行）事件；`ProgramControlPanel.vue` 透传。
- `src/components/ProgramWorkspace.vue`：新增 `argumentTargetIndex` 状态——参数面板只由双击或「编辑 → 更改选定内容」打开，绑定打开时的指令下标；绑定指令失效（被删/不再是运动指令）自动收起。
- `src/components/MotionArgumentPanel.vue`：移除光标自动显示；头部加 × 关闭按钮；移除面板内「修改位置」。
- `src/components/ProgramEditorToolbar.vue`：「编辑」菜单新增「更改选定内容」（仅光标在运动指令可用）；**「修改位置」移出参数面板，改为工具栏常驻按钮**（对齐 FlexPendant 底部 Modify Position 软按钮），光标指令目标为已命名 robtarget 且可编辑时可用，与 Program Data 面板同一 `modify-position` 命令。

### 修正 2 — 删除网页版冗余的剪切/复制/粘贴
- 分析：FlexPendant 需要 Cut/Copy/Paste 菜单是因为示教器无系统剪贴板与自由文本编辑；网页版 textarea 原生 Ctrl+X/C/V 语义等价，菜单项纯重复。
- 删除：`ProgramEditorToolbar` 三个菜单项与相关逻辑；`ProgramPanelController` 的 `clipboard`/`setClipboard` 与 `InstructionClipboardEntry`；`App.vue` 的 `programClipboard`；`controlled-rapid-edit.ts` 的 `paste-instructions` 命令及其测试。
- 保留：更改选定内容 / 注释 / 取消注释 / Change to MoveJ↔MoveL / 撤销重做（均无网页原生等价物：注释切换=IDE Ctrl+/ 语义，Change to 与撤销带 PP 簿记）。

### 修正 3 — transport 补程序状态徽标（修复 6 条既有陈旧 E2E）
- 问题：WorkbenchLayout 拆分布局后 `.control-status` 只在 `display=all/actions` 渲染，工作台页面上程序状态（已完成/已停止）不可见，`abb-program.spec.ts` 的 `statusLabel()` 定位全部失效（前次记录为"既有待清理项"）。
- 修复：`ProgramControlPanel.vue` 的 transport 模板（运行键组）内新增 `.control-status` 状态徽标（与 FlexPendant 状态区语义一致），E2E 定位符不变即恢复有效。

### 测试与门禁
- `MotionArgumentPanel.test.ts` 重写为新交互（点选不弹/双击打开/菜单入口/关闭按钮/修改位置在工具栏）；`controlled-rapid-edit.test.ts` 删 2 条粘贴用例（40→38）；单测 51 文件 468 条全过；`vue-tsc`、`eslint`、`stylelint` 全过（PoseReadout 既有 warning 不动）。
- `e2e/abb-program.spec.ts` 教学闭环第 2 步改为双击打开参数面板。
- 工具栏 UI 简化：删除「插入位置：PP 之后 · 行 N」提示文字（插入锚点逻辑不变），全部按钮单行排列（`flex-wrap: nowrap`）。
- 既有陈旧 E2E 清理（均为更早的已提交 UI 改版遗留，非本次功能引入）：`abb-irb1200.spec.ts` 的「手动 Jog」tab 定位改为 `/手动/`（tab 已改名「手动控制」）；场景辅助开关断言适配 commit `126f9e8` 的"默认全关"；「World 单次位移」从已删除的「X 数值输入」改为 10 mm 步进 + 点按方向盘「X 增加」（<180ms 点按=单步，FlexPendant 增量式语义）。
- **E2E 运行前提**：`playwright.config.ts` 用 `npm run preview` 伺服 `dist/`，改完 `src/` 必须先 `npm run build` 再跑 e2e，否则测的是旧构建（本次曾因此误判 7 条失败）。
- 全量 E2E：`abb-program` 11/11、`abb-irb1200` 5/5 全过。

## 调研 — ABB FlexPendant 界面交互整理（无代码变更）

- 新增 `docs/flexpendant-ui-research.md`：联网整理 FlexPendant 界面交互，按 **UI 视觉层面（屏幕分区、控件形态）** 与 **功能页面级（手动操纵/程序编辑器/程序数据/程序运行/输入输出等页面功能点）** 两个维度汇总，并给出本项目现有组件（`WorkbenchLayout`、`JogControlTabs`、`CartesianControlPanel`、`ProgramControlPanel` 等）的功能对照表。作为后续"示教器化"改造的设计参考，未改动任何源码。
- 新增 `.scratch/flexpendant-ui-prototype/index.html`：基于上文差距分析（顶/底部状态栏"未集中"），做了一版 **throwaway UI 原型**——3 个结构不同的状态栏方案（A 底部状态条 / B 顶栏单行胶囊 / C 顶+底双条分组），`?variant=A|B|C` 切换 + 底部浮动切换条 + ←/→ 键浏览。用与真实项目一致的设计 token 模拟顶栏/视口/功能面板/日志外观，零侵入 `src/` 源码。仅为决策参考，非生产代码，浏览后评估是否合入真实实现。

## 2026-08-19 — 示教工作流对齐真实 ABB FlexPendant（阶段 A–D 完成 + E 部分）

### 需求
- 把本项目的示教/编程操作流从"教学简化"改为与真实 ABB FlexPendant（IRC5，手册 3HAC050941-001 Rev G）一致：新运动指令目标为 `*` 未示教占位、参数编辑器补全目标点/速度/转弯区、Program Data 新建为默认值、编辑菜单（剪切/复制/粘贴/注释/Change to MoveJ↔MoveL）与撤销/重做（3 步）。
- 用户已确认三项范围决策（见下方"决策"）。实施中不做旧命令兼容，破坏性改动直接改全部调用方与测试。

### 决策（用户确认）
1. 新指令目标点按真机做 `*` 占位；未补全目标点的程序给诊断并禁止运行。
2. 参数编辑器范围 = 目标点 + 速度 + 转弯区（Tool/WObj 不做选择器，仍靠源码手改）。
3. 编辑菜单指令级操作全做：剪切/复制/粘贴/注释行/Change to MoveJ↔MoveL/撤销重做（3 步）；Select Range 多选不做，操作粒度=光标所在指令行。

### 阶段 A — parser 支持 `*` 占位 + 全量指令视图
- `src/rapid/rapid-parser.ts`：运动目标操作数接受 `*`（`operands.target='*'`、`operandRanges.target` 指向 `*`）；`RapidParseResult` 新增 `instructions` 字段（含诊断时非空，`program` 为空；注释写明两字段契约差异）。
- `src/rapid/rapid-diagnostics.ts`：新增 `missing-target` 错误级诊断"目标点未示教"；`canExecute=false`。
- `src/rapid/rapid-parser-star-target.test.ts`（新增）：`*` 目标解析、speed/zone 槽 `*` 仍为 syntax-error、`instructions` vs `program` 契约。
- 影响：含 `*` 目标的运动程序不可运行（真机一致）。

### 阶段 B — 受控编辑命令重构 + 撤销栈
- `src/rapid/controlled-rapid-edit.ts`：
  - `insert-motion` 改为 `{kind,insertionIndex}`（删除 `target` 与自动建点路径），插入固定 `MoveJ|MoveL *,v1000,z50,tool0;`。
  - 新增 `edit-motion-operand`（target/`existing`、target/`new`（原子建点+替换）、speed/zone）、`delete-instruction`、`comment-instructions`、`uncomment-lines`、`paste-instructions`、`change-motion-kind`。
  - `RapidEditSuccess` 增 `programRemap`（`removed`/`inserted`）与 `programTextChangedAt`（PP 指向的指令文本被改写 → 停止态要求 PP to Main）。
  - 导出 `DEFAULT_ROBTARGET`（Program Data 新建默认值，供两处共用）。
  - 可编辑性守卫细化：仅当全部诊断都是 `missing-target` 时放行参数/指令编辑（真机带 `*` 仍可继续编辑但不能运行）；其它 error 仍拒绝。
- `src/application/program-control.ts`：`applyEdit` 入撤销栈（上限 3 步）、`undo/redo`、`canUndo/canRedo`；`reconcile` 按 `programRemap` 精确折算 PP（`removed` 命中 → PP to Main；`programTextChangedAt` 命中 → PP to Main）；自由文本编辑/预设加载清空撤销栈。
- 影响：结构化源码修改只经 `applyRapidEdit`，一次命令原子成功/失败；free-text 编辑不入撤销栈。
- **偏离方案的两处刻意设计（记录）**：
  1. 取消注释命令用 **`uncomment-lines {lines}`**（行号 1 起始），而非方案的 `uncomment-instructions {indices}`：被注释的指令行不能被解析为可执行指令、无法按 instructions 下标索引，改用行号更贴合"取消注释光标所在源码行"语义。
  2. `paste-instructions` 命令**不再携带 `instructionCount`** 字段：粘贴后指令数由重新解析 `source` 得出（与原文本逐字保留一致，避免调用方声明与实际不符）。
- 实测：`controlled-rapid-edit.test.ts` + `program-control.test.ts` 新增相关用例，78 → 更多条全过。

### 阶段 C — 程序编辑器 UI 三件套
- `src/components/ProgramEditorToolbar.vue`（由 MotionInstructionToolbar 重构改名）：
  - 添加指令 → FlexPendant 式 Common 菜单（只 MoveJ/MoveL），插 `*,v1000,z50,tool0`；删除 `pose` prop（不再示教当前 TCP）。
  - 编辑菜单：剪切/复制/粘贴（剪贴板经共享控制器）/注释/取消注释/Change to MoveJ↔MoveL（按光标指令类型只显示其一）。
  - 撤销/重做接 controller 的 `canUndo/canRedo` 控制禁用。
  - 光标行解析（resolvedPoint）保留既有锚点逻辑。
- `src/components/MotionArgumentPanel.vue`（新增）：光标所在运动指令的结构化摘要；目标点/速度/转弯区三个可点参数走选择器（目标含已有点位 +「新建点位（记录当前位置）」，速度/zone 含系统预定义并标注系统）；修改位置在目标为已命名 robtarget 时可用（与 ProgramDataPanel 同一 `modify-position` 命令）；错误消息面板内展示。
- `src/components/ProgramDataPanel.vue`：独立「新建点位」改为以 `DEFAULT_ROBTARGET` 默认值创建（不再依赖当前 TCP），位置稍后用 Modify Position 录入；显示"以默认值创建"提示。

### 阶段 D — App/controller 接线与剪贴板
- `src/application/use-program-panel-controller.ts`：`ProgramPanelController` 扩展 `instructions`、`editable`、`clipboard`/`setClipboard`、`undo/redo/canUndo/canRedo`；导出 `InstructionClipboardEntry`。
- `src/App.vue`：provide 上述字段；新增 `programClipboard` ref（App 唯一持有）；`programEditable` 派生（canExecute 或全部 missing-target）。
- `src/components/ProgramWorkspace.vue`：接新 controller；用 `ProgramEditorToolbar`+`MotionArgumentPanel` 替换旧 `MotionInstructionToolbar`；新增 `cursorInstruction`（光标行覆盖的指令）与 `cursorLineText` 计算；透传新 props。
- 移除 `src/components/MotionInstructionToolbar.vue` 与其旧测试（被改名组件取代）。

### 阶段 E — 测试 / 文档 / 门禁（本会话完成部分）
- 单元测试：
  - `src/components/ProgramWorkspace.test.ts`、`src/components/ProgramDataPanel.test.ts` 更新为新的选择器/语义（添加菜单项、新建点位默认值）。
  - `src/components/MotionArgumentPanel.test.ts`（新增）：添加菜单只出 MoveJ/MoveL、`*` 摘要/禁修改位置、目标选择器（已有+新建记录当前位置）、速度/zone 系统标注、修改位置同命令、赋值行 Change to 不出现/参数面板隐藏、非运动行编辑可用态。
- E2E：`e2e/abb-program.spec.ts` 教学闭环改写为真机流程（添加 `*` → 参数面板新建点位示教 → 运行 → Modify Position → 再运行；注释/取消注释/Change to/撤销逐步回退）。已修正在本次实现中暴露的新组件选择器（菜单项为 `role="menuitem"`；诊断区消失用 `toHaveCount(0)`；`exact:true` 消歧）。
  - **注意**：同套 E2E 中仍有多条**既有陈旧定位**失败，与本任务无关且早于本次改动：`abb-program` 的 `.program-panel .control-status`（顶栏状态丸已被更早的"删除主界面顶栏程序状态丸"变更移除）与 `abb-irb1200` 的 `手动 Jog` tab（该 tab 已改名为「手动控制」）。这些是既有 E2E 待清理项，不等于本次功能失败；本次功能层的单元测试全部通过。
- 文档：`README.md`（新增 FlexPendant 程序编辑器能力条目）、`CONTEXT.md`（点位示教/修改位置/受控源码编辑术语更新 + `missing-target` 例外）、`docs/program-data-workflow-redesign.md`（标注已被本方案取代）。

### 验证
- `npm run check` ✅、`npm run lint` ✅（仅一个既有 `PoseReadout.vue` require-default-prop 警告，与本任务无关）、`npm run lint:style` ✅、`npm test` ✅（51 个测试文件 469 passed + 1 expected fail）、`npm run build` ✅。
- E2E：新增真机流程用例已按新定位修复；因既有陈旧选择器（状态丸/tab 改名）导致的部分既有用例失败，属既有待清理项。


## 2026-08-19 — 删除主界面顶栏的程序状态丸（control-status）

### 需求
- 用户要求在**主界面 topbar**（App.vue 顶栏，即 `ProgramControlPanel` 的 `display="transport"`）上完整删除程序运行状态标识 `<span class="control-status" :class="\`program-state-${props.snapshot.state}\`">{{ stateLabel }}</span>`（状态丸：显示如 idle/running/error 状态）。

### 修改
- `src/components/ProgramControlPanel.vue`：
  - transport 顶栏模板中删除 `control-status` 状态丸（原第 134-136 行）。侧栏/工作区面板（`display='content'`/`'actions'`）内的两处状态丸保留不动，仍显示 `stateLabel`。
  - 删除随之失效的顶栏样式 `.program-panel-transport .control-status`（死 CSS）。
  - `stateLabel` computed 仍被面板两处使用，保留。

### 说明
- 仅删顶栏 transport 那一处；程序控制键（运行/单步/停止/PP to Main）与 PP/MP、场景状态 pill 均保留。

### 验证
- `npm run check` 报错均为并行 WIP（扩大的 `ProgramPanelController` 契约与 `insert-motion .target`），错误文件为 `App.vue`/`ProgramWorkspace.vue`/`MotionArgumentPanel.vue`/`ProgramEditorToolbar.vue`/相关 test，与本次删除无关（git stash 基线同样报错）；本次仅删模板与死样式，不触碰 TS 类型。

## 2026-08-19 — 删除面板装饰性英文 kicker，只留中文标题

### 需求
- 用户反馈页面上有大量「中英文混杂」的装饰性英文小标签（kicker，如 `WORKBENCH`、`CARTESIAN CONTROL`、`PROGRAM DATA` 等），要求删掉、只留中文标题；同时强调**有具体区分/技术意义的英文标识要保留**（如 Program Data 数据类型标签 `robtarget/num/bool/tooldata/...`）。

### 修改（删除的装饰性 kicker，下方均有中文标题）
- `src/components/WorkbenchLayout.vue`：删 `WORKBENCH`（dock-kicker）+ 死样式 `.dock-kicker`。
- `src/components/CartesianControlPanel.vue`：删 `CARTESIAN CONTROL`。
- `src/components/CoordinateInfoPanel.vue`：删 `COORDINATE INFO`。
- `src/components/JointControlPanel.vue`：删 `JOINT SPACE CONTROL`。
- `src/components/ProgramControlPanel.vue`：删 `RAPID SOURCE & RUN`、`PROGRAM CONTROL`。
- `src/components/PresetLibraryDialog.vue`：删 `RAPID TEMPLATES`（lib-kicker）+ 死样式 `.lib-kicker`。
- `src/components/ProgramDataPanel.vue`：删 `PROGRAM DATA`。
- `src/style.css`：删共享死样式 `.eyebrow` / `.panel-kicker`（已无模板引用）。

### 保留（有区分/技术意义，未删）
- Program Data 类型标签 `robtarget/num/bool/tooldata/wobjdata/speeddata/zonedata`（用户点名保留）。
- 轴/坐标标识 `X/Y/Z/Rx/Ry/Rz`、`BASE/TOOL`、`MoveJ/MoveL`、`PP/MP`、四元数 `q1..q4`、状态 `FK READY/PATH OK` 等技术性英文。

### 验证
- `npm run lint` ✅（仅一个既有的 `PoseReadout.vue` require-default-prop 警告，与本任务无关）。
- `npm run check` 当前报错均来自并行的 star/WIP（扩大的 `ProgramPanelController` 契约 `instructions/editable/clipboard` 及 `insert-motion .target`），错误文件为 `App.vue`/`ProgramWorkspace.vue`/`MotionInstructionToolbar.test.ts`，与本次 kicker 删除无关；本次仅删模板 kicker 文本与 CSS，不触碰任何 TS 类型。git diff 确认 App.vue 等为 WIP 改动，非本任务。

## 2026-08-19 — 位姿角标支持 RX/RY/RZ 与 RAPID 四元数切换

### 需求
- 场景右下角位姿角标（PoseReadout）当前只显示欧拉角 RX/RY/RZ，而 RAPID 源码点位（robtarget）用的是四元数 `[q1,q2,q3,q4]`；用户要求在角标上加一个小型标签切换，在 RX/RY/RZ 与四元数两种姿态表示间切换，XYZ 位置保持不变、排版不乱。

### 修改
- `src/components/PoseReadout.vue`：
  - 标题行右侧新增小型分段按钮 `.orientation-toggle`，本地 `ref(orientationAsQuat)` 控制姿态表示方式，默认欧拉角（保持原行为）。
  - 切换按钮改用 Lucide 图标以保持角标紧凑：欧拉角用 `Axis3d`、四元数用 `Rotate3d`，语义经 `aria-label` / `title`（「欧拉角 RX/RY/RZ」「RAPID 四元数 q1..q4」）表达，悬停可读、无障碍可辨。
  - 姿态换算：新增 `rapidQuat` computed，由欧拉角(RX/RY/RZ，ZYX 顺序)经 `eulerZYXToMatrix` 得旋转矩阵，再经 `rotationMatrixToQuaternion` 转四元数，并重排为 RAPID 顺序 `[q1,q2,q3,q4]`（q1=w、q2=x、q3=y、q4=z），与 `robtarget.rot` 记录形状一致。
  - 模板把 X/Y/Z 单独保持 3 列 `.pose-grid`（始终不变）；欧拉角模式沿用 RX/RY/RZ 3 列网格，四元数模式渲染 `q1..q4` 为 4 列 `.quat-grid`，两段上下分隔、排版整洁。
  - 样式：`.pose-readout-title` 改为 flex（标题 + 右侧切换）；新增 `.orientation-toggle` 及其按钮 active 态（图标按钮 inline-flex 居中）；新增 `.quat-grid` 四列布局与紧凑模式的四列覆盖（`.pose-readout.compact .pose-grid.quat-grid`）。
  - 修复：场景角标由 App.vue 的 `.scene-pose-readout` 设了 `pointer-events:none`（为不挡 3D 画布 orbit），导致新增切换按钮也点不到；给 `.orientation-toggle` 加 `pointer-events:auto`，令仅按钮自身可点击、其余区域继续穿透画布。
- `src/components/PoseReadout.test.ts`：新增欧拉角/四元数切换（图标按钮、默认欧拉角 active）与单位姿态 `[0,0,0] → [1,0,0,0]` 的用例；原六格读数与 `app-profile-stability`（取 `.pose-grid strong` 前三项为 XYZ）不受影响。

### 验证
- `npx vitest run src/components/PoseReadout.test.ts` 4 项全部通过（含新增切换图标与四元数用例）；`vue-tsc` 对 `PoseReadout.vue` 无类型错误；`git diff --check` 无空白错误。

## 2026-08-19 — 全局图标改用 Lucide（@lucide/vue）

### 需求
- 用户反馈各页面的图标不对（如边栏 RAPID 的 `⌨`、展开/关闭按钮的 `⤢`/`✕`、示教器运行键的 `▶`/`⏭`/`■`/`↺` 等文本字形图标在各端渲染不稳定），要求全站检查并统一替换为开源图标库 Lucide。

### 修改
- 新增依赖 `@lucide/vue@^1.32.0`（Lucide 官方维护的 Vue 3 绑定；旧 `lucide-vue-next` 已废弃，故采用其继任包名）。
- `src/components/WorkbenchLayout.vue`：边栏三项字形图标改为 Lucide 组件（`FileCode` RAPID / `Database` 数据 / `Joystick` 控制），`RAIL_ITEMS.icon` 由字符串改为组件引用、模板用 `<component :is>` 渲染；半屏展开 `⤢`→`Maximize2`、收起 `✕`→`X`、边栏收起 `⇥`→`PanelRightClose`。
## 2026-08-21 — ABB 机械零位腕部奇异与笛卡尔点动修复

### 问题与原因

- ABB IRB1200 的 `[0, 0, 0, 0, 0, 0]` 是机械/同步零位，当前 DH 模型在该姿态的 J5≈0° 腕部 Jacobian 降秩；Y 方向位移需要 J4/J6 大幅换构型，严格 MoveL/笛卡尔 IK 会因构型跳变护栏而拒绝。
- 原路径规划器把腕部奇异、关节限位、关节步长超限和普通 IK 不收敛全部折叠为 `null`，控制面板无法给出可操作提示。

### 修改文件与内容

- `src/robotics/robot-profile.ts`：RobotProfile 新增只读 `mechanicalZeroJoints`，明确 `homeJoints` 为教学 Home。
- `src/robot-models/abb-irb1200/robot-config.ts`、`robot-profile.ts`、`src/scene/abb-scene.ts`：拆分 ABB 机械零位 `[0,0,0,0,0,0]` 与教学 Home `[0,-25,45,0,20,0]`；场景和默认关节控制改用教学 Home，机械零位仍可显式调用。
- `src/robotics/ik-waypoint-solver.ts`：新增 `WaypointSolveResult` 与 `wrist-singularity`、`joint-limit`、`joint-step`、`ik-not-converged` 失败枚举；J5 接近 0° 的 IK 失败单独识别，保留 5° 相邻关节步长护栏。
- `src/robotics/cartesian-path-planner.ts`：返回结构化规划结果，不再返回数组/null；起点 FK 失败也返回明确原因。
- `src/application/cartesian-control.ts`、`src/components/CartesianControlPanel.vue`：将路径失败原因映射到控制状态和中文提示，腕部奇异提示用户调整 J5 或返回教学 Home；失败时不提交轨迹，实际关节保持不变。
- `src/rapid/movel-planner.ts`、`src/rapid/movec-planner.ts`：适配结构化 waypoint 结果；MoveC 圆弧采样细化至约 1 mm，避免正常圆弧因 5° 步长护栏被误判为构型跳变。
- `src/application/use-robot-controller.ts`、`src/App.vue`、`src/components/JogControlTabs.vue`、`src/components/JointControlPanel.vue`：新增“机械零位”动作；原“回零”改为“教学 Home”，并分别记录操作日志。
- 相关 `*.test.ts`：增加机械零位 Y 点动失败原因、教学 Home XYZ 六方向 1 mm 可规划、profile 字段、面板事件及 MoveL/MoveC 回归断言；更新圆弧/零位测试夹具以使用明确的姿态语义。

### 影响

- 默认启动和普通回零不再落在腕部奇异构型；需要校准/诊断时仍可通过“机械零位”按钮回到厂家零位。
- 笛卡尔失败不再静默显示“不可达”，可区分腕部奇异、关节限位、构型跳变和 IK 不收敛；失败不会覆盖当前关节。
- DH 参数、IK 阻尼、定位容差与 5° 构型护栏未放宽或擅自改动。

### 验证

- `npm run check` ✅（TypeScript/Vue 类型检查通过）。
- 本次相关回归：路径规划、笛卡尔控制、profile、面板、MoveL/MoveC 测试全部通过。
- `npm test` 仍有 26 个既有 MoveJ/ProgramExecutor/App 测试失败；这些失败集中在未修改的 MoveJ 求解与测试基线，未由本次路径/零位改动引入。

## 2026-08-21 — 对齐 ABB 奇异点姿态语义与 SingArea\\Wrist

### 需求与原因

- 严格保持目标姿态的笛卡尔运动在 J5≈0° 腕部奇异处不能靠“保留最近一次有效姿态”解决；正确行为是拒绝本次目标，并提示修改奇异点另一侧第一个目标的姿态、使用 `SingArea\\Wrist` 或先关节 Jog 脱离。
- 原实现已停止提交失败轨迹，但界面文案仍写成“已保留最近一次有效姿态”，并且腕部重构与普通关节步长共用 `joint-step`，无法指导用户处理 ABB 构型重新配置。

### 修改文件与内容

- `src/robotics/types.ts`、`src/robotics/ik-solver.ts`：新增位置优先 IK 分支；`positionOnly` 只约束 TCP 位置，姿态误差不参与收敛判断和阻尼最小二乘，作为 `SingArea\\Wrist` 的核心求解语义。
- `src/robotics/robot-model.ts`、`src/robot-models/abb-irb1200/dh-robot-model.ts`：增加可选型号特定腕部奇异判定，只有 ABB 模型在 J5≈0° 时才把腕部重构单独分类，避免 KUKA 等通用模型误报。
- `src/robotics/ik-waypoint-solver.ts`：新增 `wrist-reconfiguration` 失败原因和 `strict/wrist` 姿态策略；严格模式下 J4/J6 在 ABB 腕部奇异面发生相邻构型跳变时单独返回重构诊断，仍不自动改写目标姿态。
- `src/robotics/cartesian-path-planner.ts`、`src/robotics/ik-waypoint-solver.ts`：增加 `orientationMode` 选项；严格模式保持完整 Pose，`wrist` 模式先尝试严格姿态，只有腕部无法连续分配时才退到位置优先解，从而保持 TCP 线性/圆弧位置路径并只在必要处允许姿态误差。
- `src/application/cartesian-control.ts`、`src/components/CartesianControlPanel.vue`、`src/components/JogControlTabs.vue`、`src/application/use-robot-controller.ts`、`src/App.vue`：新增“严格姿态 / SingArea\\Wrist”选择；错误提示改为“未执行目标”或“请修改目标姿态”，删除会误导用户的“保留最近一次有效姿态”文案；成功状态区分严格路径与允许姿态误差路径。
- `src/rapid/rapid-types.ts`、`src/rapid/rapid-parser.ts`：支持 `SingArea \\Wrist;` 与 `SingArea \\Off;`，解析成非运动模式切换指令，支持在程序顺序中执行。
- `src/application/program-control.ts`：维护程序运行期 `SingArea` 模式，并在新程序装载、PP to Main、源码重建时复位为 `\\Off`；MoveL/MoveC 使用当前模式，不影响 MoveJ。
- `src/rapid/plan-shared.ts`、`src/rapid/movel-planner.ts`、`src/rapid/movec-planner.ts`：传播腕部奇异、腕部构型重构、普通关节步长和 IK 不收敛等结构化规划错误，不再全部折叠成 `unreachable`。
- 相关 `*.test.ts`：新增严格模式文案与构型重构回归、`SingArea\\Wrist` 机械零位 TCP 路径回归、RAPID `SingArea` 解析回归，并更新 MoveL 奇异错误码断言。

### 影响

- 严格姿态模式不会偷偷替换姿态；目标触发构型重新配置时保持当前实际关节不变并给出 ABB 可操作提示。
- `SingArea\\Wrist` 现在是可选的真实位置优先规划路径，保持 TCP 线性/圆弧位置，但明确允许腕部姿态偏差。
- RAPID 中的 `SingArea` 模式按程序顺序生效，只影响后续 MoveL/MoveC；程序重置不会泄漏上一次模式。

### 验证

- `npm run check` ✅。
- `npm run lint` ✅（仅保留既有 `PoseReadout.vue` `require-default-prop` warning）。
- 相关回归测试：笛卡尔控制、Cartesian path、MoveL、MoveC、RAPID parser、Jog 面板共 45 项通过。

## 2026-08-21 — 修正 SingArea\\Wrist 的全局 position-only 回退

### 问题与原因

- ABB 官方定义的 `SingArea\\Wrist` 只用于接近奇异点的线性/圆弧局部插补：TCP 继续走线性/圆弧路径，腕轴按关节角插补并允许局部姿态误差；它不是整条普通路径都忽略姿态。
- 原实现从 `planCartesianPath` 和 `MoveC` 入口直接传入 `positionOnly: true`，只要选择了腕部模式，非奇异 waypoint 也会放弃姿态约束，导致普通运动姿态漂移、看起来不是严格直线姿态运动。
- 点动界面暴露了“严格姿态 / SingArea\\Wrist”全局切换，要求用户手动维持模式，和 ABB 在奇异邻域才切换插补的使用方式不一致。

### 修改文件与内容

- `src/robotics/cartesian-path-planner.ts`：MoveL 始终先使用完整位姿 IK；仅把 `orientationMode` 交给共享 waypoint 求解器，由其逐点判断是否需要腕部回退。
- `src/rapid/movec-planner.ts`：MoveC 不再整段传入 `positionOnly`，避免圆弧的非奇异段丢失编程姿态；`SingArea\\Wrist` 仍由共享求解器按 waypoint 局部处理。
- `src/robotics/ik-waypoint-solver.ts`：`WaypointSolveResult` 增加 `usedWristFallback`；回退条件限定为 ABB 腕部奇异邻域或明确的 J4/J6 腕部构型重分配，普通非腕部大步长不会触发姿态放宽。
- `src/application/cartesian-control.ts`：笛卡尔点动固定采用“严格姿态优先、奇异处自动局部腕部插补”；仅当实际发生回退才显示 `wrist-solved`，旋转点动继续严格保持姿态。
- `src/components/CartesianControlPanel.vue`、`src/components/JogControlTabs.vue`、`src/application/use-robot-controller.ts`、`src/App.vue`：删除点动界面的全局 SingArea 手动切换和对应控制器状态，避免用户误以为需要全程开启；RAPID 源码中的显式 `SingArea \\Wrist/\\Off` 指令保留。
- `src/robotics/cartesian-path-planner.test.ts`、`src/application/cartesian-control.test.ts`：新增非奇异“平移 + 25°姿态”回归，确认姿态误差小于 1° 且 `usedWristFallback=false`；新增机械零位 Y 点动自动回退并提交轨迹的断言。

### 影响

- 普通非奇异笛卡尔移动恢复完整姿态约束，不会因为内部腕部策略而整段变成 position-only。
- 机械零位或路径穿越腕部奇异时，只有必要的 waypoint 允许腕部姿态误差；离开奇异邻域后自动回到严格姿态求解。
- RAPID 的 `SingArea` 仍是程序级持续指令，默认 `\\Off`；本次自动化仅针对手动笛卡尔点动，不改变 RAPID 明确编程语义。

### 验证

- `npm run check` ✅。
- 相关回归：Cartesian path、Cartesian control、MoveL、MoveC、RAPID parser、Jog 面板共 46 项通过。
- 修改前新增回归曾以 25.2°姿态误差失败，修复后通过；证明修复确实消除了全局 position-only 行为。
- `npm run lint` ✅（仅保留既有 `src/components/PoseReadout.vue` 的 `vue/require-default-prop` warning）。
- `npm test` 的全量基线仍为 4 个既有失败文件、26 项失败及 1 个 jsdom/CodeMirror 未处理异常，集中在 MoveJ、ProgramController、App 场景 stub；本次相关 46 项未受影响。

## 2026-08-21 — 修复连续笛卡尔点动重复目标与全局 wrist 提示

### 问题与原因

- 手动点动控制层原先把 XYZ 请求直接标记为 `wrist`，只有进入规划器后才尝试区分普通路径和奇异路径；现场会出现普通位置也持续显示 `SingArea\\Wrist` 的误导状态。
- 连续按键每个 tick 都从当前已回写关节的 FK 重新生成目标。若上一段轨迹仍在 IK/动画提交过程中，当前关节尚未变化，连续 tick 会反复提交同一个目标，表现为按钮持续点击但机器人不动。

### 修改文件与内容

- `src/application/cartesian-control.ts`：手动笛卡尔请求统一先严格规划；只有明确返回 `wrist-singularity` 或 `wrist-reconfiguration` 才重试局部 `SingArea\\Wrist`。新增连续目标累加器，按住期间基于上一个逻辑目标叠加增量；非连续点击、输入字段和坐标系切换时清除累加目标。
- `src/application/cartesian-control.test.ts`：新增连续点动状态回归，以及“动画尚未回写关节时目标仍从 1mm/2mm/3mm 递进”的回归，防止再次出现重复目标。

### 影响

- 非奇异位置不会进入 wrist 回退分支，也不会持续显示 `SingArea\\Wrist 已提交`。
- 连续点动不再依赖上一帧是否及时更新关节状态，目标会连续累加并交给 MotionRunner 重定向。
- 奇异点仍按严格姿态失败 → 局部腕部插补的流程处理；RAPID 程序中的显式 `SingArea` 语义不变。

### 验证

- `npm run check` ✅。
- Cartesian control 与 Cartesian path planner 相关测试 17 项通过。

## 2026-08-21 — 将 wrist 回退严格限制到机械零位奇异邻域

### 问题与原因

- 原 ABB 型号判定只检查 `J5≈0°`，导致远离机械零位的工作姿态（例如 `[15,-20,30,0,0,-300]`）也能进入 `positionOnly` wrist 回退。
- 路径求解器没有路径级机械零位资格闸门；只要某个 waypoint 被识别为腕部奇异/重构，普通工作区也可能放宽姿态约束。
- wrist 模式未获准回退时，腕部构型重配会被降级为普通 `joint-step`，掩盖真实原因。

### 修改文件与内容

- `src/robotics/robot-model.ts`：增加可选型号能力 `isMechanicalZeroSingularityNeighborhood()`，与广义 `isWristSingularity()` 明确分离。
- `src/robot-models/abb-irb1200/dh-robot-model.ts`：ABB 机械零位奇异邻域限定为 J1/J2/J3/J4/J6 距机械零位不超过 5°，同时 J5 不超过 1°。
- `src/robotics/ik-waypoint-solver.ts`：在整条路径开始时锁定 wrist 回退资格；只有型号确认初始关节位于机械零位奇异邻域，才允许后续局部 `positionOnly`。未获准时保留 `wrist-reconfiguration` 错误分类。
- `src/robotics/cartesian-path-planner.test.ts`：新增机械零位 5°/J5 1° 边界断言，以及非机械零位 J5=0 请求 wrist 必须失败的红灯回归。
- `src/application/cartesian-control.test.ts`：将远离机械零位的 J5=0 场景改为断言 `reconfiguration`，禁止误报 `wrist-solved`。

### 影响

- 自动 wrist 分支不再覆盖广义 J5=0 腕部奇异面，只服务于本项目明确要求的机械零位局部脱离场景。
- 普通工作区保持严格姿态语义；即使 RAPID/调用方请求 wrist，也不能绕过机械零位邻域资格检查。
- 机械零位附近的 Y 点动仍可使用局部 wrist 回退，离开该邻域后自动恢复严格规划。

### 验证

- 修改前最小回归返回 `ok:true, usedWristFallback:true`；修改后返回 `wrist-reconfiguration`。
- 精确复现“机械零位 → X+10 mm → Y+10 mm”：X 移动后仍满足受限邻域判定，随后 Y 实际移动超过 9 mm并报告 `wrist-solved`。
- `npm run check` ✅。
- Cartesian control、Cartesian path、MoveL、MoveC、RAPID parser、Jog 面板相关测试 51 项通过。

## 2026-08-21 — 收紧机械零位专属重构诊断

### 回归现象与验证标准

- 上一轮测试错误地把机械零位邻域外的 `J5=0` 大步长固定为 `wrist-reconfiguration`，导致普通工作区频繁显示“请修改奇异点另一侧第一个目标的姿态”。
- 新回归要求：机械零位邻域外继续禁止 wrist 回退，同时不得显示机械零位专属重构提示；真实相邻关节步长超限应归类为普通 `joint-step`。
- 修改测试文件：`src/robotics/cartesian-path-planner.test.ts`、`src/application/cartesian-control.test.ts`。

### 修改文件与原因

- `src/robotics/ik-waypoint-solver.ts`：新增单一的路径起点资格 `isMechanicalZeroWristPath`，同时约束 `wrist-singularity`、`wrist-reconfiguration` 和自动 wrist 回退；避免三套条件发生偏差。
- 机械零位邻域外的 J5≈0 若发生相邻关节大步长，保留为 `joint-step`；若 IK 本身失败，保留为 `ik-not-converged`，控制层不会再把这些普通失败自动重试为 wrist。
- 未修改 IK 求解、5° 相邻步长护栏和机械零位邻域阈值，避免通过放宽安全检查掩盖真实路径问题。

### 影响

- “请修改奇异点另一侧第一个目标的姿态”只会在路径从机械零位奇异邻域起步并确实发生腕部重构时显示。
- 普通工作区不再因为 J5≈0 频繁出现机械零位专属提示，也不会进入无效的 wrist 重试。

### 验证

- 修复前定向回归 3 项稳定收到 `wrist-reconfiguration` 并失败；修复后全部转绿，机械零位外改为 `joint-step`。
- 机械零位专项 7 项通过，包含“机械零位 → X+10 mm → Y+10 mm”，确认局部 wrist 脱离未受影响。
- `npm run check` ✅。
- Cartesian control、Cartesian path、MoveL、MoveC、RAPID parser、Jog 面板相关测试 51 项通过。
- `npm run lint` ✅（仅保留既有 `src/components/PoseReadout.vue` 的 `vue/require-default-prop` warning）。

## 2026-08-21 — 保持非机械零位行为并收拢连续 IK 策略

### 修改原因

- 现场反馈确认：上一版本机械零位之外的笛卡尔运动已经正确且顺畅；新增的非腕部构型跳变提示不能改变这些路径的行为。
- 原连续性判定在 `solvePoseWaypoints` 外层，候选选择在 `resolveJointSolution` 内层；机械零位之外不应因为新诊断改变原有主解优先策略。

### 修改文件与内容

- `src/robotics/ik-waypoint-solver.ts`：为候选求解增加可选连续步长筛选，仅机械零位路径启用；普通工作姿态保持原主解/备用初值行为。机械零位找不到连续候选时才归类为腕部重构，普通路径回到不可达语义。
- `src/robot-models/abb-irb1200/robot-config.ts`、`dh-robot-model.ts`：ABB 腕部阈值和机械零位邻域阈值归还 ABB adapter，移除 ABB model 对通用 waypoint solver 的反向依赖。
- `src/robotics/cartesian-path-planner.test.ts`、`src/application/cartesian-control.test.ts`：新增/调整非机械零位行为保持回归，确认不再显示机械零位专属构型提示。
- KUKA 远距离不可达回归同步恢复为旧版 `unreachable` 状态，避免把普通模型的失败误标为新加入的 `joint-step`。

### 影响

- 机械零位之外不再触发自动 wrist 修正，也不再显示“路径需要跨越非腕部构型跳变”作为新的界面失败语义。
- 机械零位仍可在严格 IK 失败时选择连续候选并进入局部 wrist 脱离；原有教学 Home 和普通构型保持既有路径策略。

## 2026-08-21 — 将手动笛卡尔规划移出主线程并收拢策略

### 修改原因

- 原笛卡尔方向键每 100 ms 在 UI 事件栈同步执行最多 200 个 waypoint 的 IK；失败路径还可能在 strict 后整条重算 wrist，阻塞 pointerup、状态绘制和 RAF。
- `cartesian-control.ts` 同时负责目标转换、strict/wrist 重试、异步状态和连续目标，策略与调度没有 locality。

### 修改文件与内容

- `src/robotics/cartesian-motion-planner.ts`：收拢 strict 优先、仅机械零位允许 wrist 重试的手动目标规划策略；同步测试和 Worker 共用同一 implementation。
- `src/robotics/cartesian-planner-worker.ts`：新增 ABB Worker 内的规划入口，保持 DH/IK 运行在独立线程。
- `src/robotics/cartesian-planner-worker-adapter.ts`：生产 adapter 采用 latest-wins；当前 Worker 完成后只继续一个最新排队目标，显式离散命令才取消当前 Worker，避免长按时每 100 ms 取消导致永远没有轨迹提交。
- `src/application/cartesian-control.ts`：支持同步/异步 planner seam，新增 `planning` 状态，过期结果不再提交轨迹；连续目标在请求发出时累加。
- `src/App.vue`、`src/components/CartesianControlPanel.vue`：App 注入 Worker adapter，面板显示规划中状态。

### 影响

- 手动笛卡尔规划不再占用浏览器主线程，界面可以及时响应松开、停止和状态刷新。
- Worker 只服务手动 ABB 笛卡尔点动；RAPID 的 Tool/WObj 函数变换继续走同步规划，保持程序语义与测试 seam 不变。
- 非机械零位仍不会进入 wrist 策略；机械零位的局部 wrist 行为由共享 planner module 统一控制。
- `src/App.vue`：无 Worker 环境回退到同一同步 planner，测试和嵌入环境不会因浏览器能力缺失而抛异常。
- `src/robotics/cartesian-planner-worker-adapter.test.ts`：覆盖运行中保留最新排队目标与显式取消，锁定 latest-wins 调度语义。
- `src/App.vue`：关节 Jog、Home/随机、末端拖拽和 RAPID run/step 入口在抢占运动前取消手动笛卡尔规划，避免过期 Worker 结果覆盖新动作。
- 清理连续性失败判断中的重复机械零位条件，保持策略实现最小化。
- `src/application/cartesian-control.test.ts`：增加异步连续规划 latest-wins 回归，确认过期 Worker 结果不会覆盖最新轨迹。

## 2026-08-21 — 收拢 RAPID 运动执行 seam

### 修改文件与内容

- `src/rapid/motion-execution.ts`：新增统一 RAPID 运动执行 module，集中 MoveJ/MoveL/MoveC 的 model、关节状态、范围和 MotionRunner seam 拼装；保留各 planner 的 J/L/C 几何策略。
- `src/application/program-control.ts`：仅保留运动指令分派与 SingArea 状态，删除三组重复执行包装。

### 影响

- RAPID 运动执行 interface 收缩，规划错误与 `completed/stopped` 结果语义不变。
- 新增运动指令时只扩展统一 execution module，program-control 的 locality 不再随指令种类线性膨胀。

### 最终验证

- `npm run check` ✅。
- `npm run build` ✅，Worker 生成独立 `cartesian-planner-worker` chunk。
- 笛卡尔控制、Cartesian path、Worker adapter、MoveL、MoveC、RAPID parser、MotionRunner 相关新增/回归共 72 项通过。
- `npm run lint` ✅（仅保留既有 `src/components/PoseReadout.vue` 的 `vue/require-default-prop` warning）。
- `npm test` 全量仍为仓库原有基线：54 个测试文件、489 项通过、26 项失败、1 个 jsdom/CodeMirror 未处理异常；失败集中在既有 MoveJ/ProgramController 与 App stub，不是本次新增 Worker/笛卡尔/RAPID seam 测试。
## 2026-08-23 — 连续笛卡尔输入调度收口

- 修改 `src/application/cartesian-control.ts`：由控制器持有唯一连续步进定时器，开始时立即规划首步，结束、单击或字段编辑时统一取消定时器、取消过期规划并结束会话。
- 修改 `src/application/use-robot-controller.ts`：连续开始接口携带轴和方向，使节拍由应用层控制器而不是视图组件驱动。
- 修改 `src/components/CartesianControlPanel.vue`：面板仅负责长按识别和开始/结束事件，不再创建重复的连续规划定时器。
- 影响：连续按住笛卡尔按钮时只会保留一个最新目标，避免规划任务堆积造成卡顿、回弹和抽动；单击路径行为保持不变。
## 2026-08-23 — Wrist 窗口验证记录

- 对 `src/robotics/ik-waypoint-solver.ts` 的“仅一个过渡 waypoint 后恢复严格姿态”方案做定向回归验证；该方案导致机械零位 Y±、Z 上行和 RAPID `SingArea\\Wrist` 路径失败，已撤回。
- 当前保留机械零位资格、严格路径优先、局部姿态过渡和 J4 连续性软约束；姿态窗口的进一步收窄需要先改变解析分支求解模型，不能仅靠删除缓存姿态补丁完成。
## 2026-08-23 — 运动模式切换统一取消 Jog 会话

- 修改 `src/application/cartesian-control.ts`：注册卸载清理，确保连续定时器和活动规划在组件离开时结束。
- 修改 `src/App.vue`：关节单步、Reset、机械零位、随机姿态和操作轴拖拽开始前统一调用 `endCartesianContinuous()`；同步更新 Worker 锚点注释。
- 影响：切换到其他运动入口不会遗留旧的笛卡尔 tick 或会话资格，避免后台继续提交目标造成抽动；关节连续 Jog 保持原有行为。

## 2026-08-23 — 面板卸载补充连续会话结束信号

- 修改 `src/components/CartesianControlPanel.vue`：长按状态下组件卸载时先发送 `continuous-end`，再清除面板 timeout。
- 修改原因：只清理视图定时器不能终止应用层控制器的连续节拍和 Worker 请求。
- 影响：切换面板或卸载页面时，控制器可以统一递增代次、清空队列并取消规划，避免旧会话继续写入运动执行器。

## 2026-08-23 — 流式轨迹追加增加方向护栏

- 修改 `src/robotics/motion-runner.ts`：同一连续代次内按最新终点主方向过滤候选后缀，并拒绝终点落到已提交尾部反向侧的旧结果。
- 修改 `src/robotics/motion-runner.test.ts`：增加 `[5,20,0]` 旧结果不会进入未来队列的回归测试。
- 影响：规划乱序或历史快照不会把执行队列接成来回摆动；新会话/代次的快速换向仍走显式代次分支。

## 2026-08-23 — Worker 空闲故障自动重建

- 修改 `src/robotics/cartesian-planner-worker-adapter.ts`：Worker `onerror` 无论是否存在活动请求都先清理失效实例；活动请求按失败结算，排队请求继续由新实例处理。
- 修改 `src/robotics/cartesian-planner-worker-adapter.test.ts`：增加空闲 Worker 崩溃后下一次规划创建新实例的回归。
- 影响：不会把后续规划永久发送给已崩溃的 Worker，也不会留下永不结算的 Promise。

## 2026-08-23 — 最终验收

- `npm run check` ✅；`npm run lint` ✅；`npm run build` ✅。
- 运动链路定向回归通过：Cartesian control、MotionRunner、Worker adapter、候选图、机械零位 Y±/Z 路径、MoveL Wrist 共 60 项；Worker 空闲故障和旧轨迹反向后缀新增回归通过。
- `npm test` 结果：62 个测试文件通过、2 个既有测试文件失败（549/551 测试通过）。`app-profile-stability.test.ts` 仍因测试未挂载 `/lab` 路由导致空 VueWrapper；`preset-programs.test.ts` 的 MoveC 仅在全量并行默认 5 秒超时，单独以 20 秒超时通过；另有既有 CodeMirror/jsdom `getClientRects` 未处理异常。上述均未改动无关测试或业务逻辑。

## 2026-08-23 — 机械零位 Y±50/Z+ 关节监控脚本

- 新增 `src/robotics/mechanical-zero-jog-monitor.test.ts`：从 `[0,0,0,0,0,0]` 分别执行 Y+50、Y-50，再按 10 mm 步进 Z+ 至约 1109 mm。
- 每个命令打印 J1–J6 最终角度、内部 waypoint 最大轴变化和 TCP 坐标；失败会输出 waypoint 诊断并使测试失败。
- 验收护栏：内部单步关节变化必须小于 90°，用于直接发现 J4/J6 的 180°构型跳变。
- 监控范围修正：先从机械零位后的 Z≈889.1 mm 下到约 699.1 mm，再连续上升到约 1099.1 mm，覆盖最低点到最高点，而不是只测试零位以上区间。
- 增加低位入口候选审计输出：在 Z≈699.1 和回升首点打印全部严格解析腕部分支，用于区分“只有翻腕解可达”和“连续性策略主动选翻腕解”。
- 对照实验结论：将 Y− 脱离侧改为负 J5 虽可把低位 J4 降到约 14°，但 Z 699→1099 末端又回到约 167°，且既有路径回归失败；实验已撤回，不能用方向符号启发式替代路径级拓扑规划。

## 2026-08-23 — ABB 腕部奇异点官方语义研究

- 新增 `.scratch/cartesian-jog-global-planning/ABB_OFFICIAL_WRIST_SINGULARITY_RESEARCH.md`：仅基于 ABB Library 官方手册，整理腕部奇异点、线性 Jog、`ConfJ`/`ConfL`、`SingArea\Off`/`\Wrist`/`\LockAxis4` 的真实语义。
- 修改原因：核实“示教器是否自动开启 Wrist”和“ABB 是否保证 J4 不大转”等关键前提，避免在未证实假设上继续堆叠 IK 补丁。
- 影响：本次不修改生产代码；文档明确后续应分离 Jog 与 MoveL 规划，使用真实奇异性度量、已执行状态锚点、阻尼速度求解和局部姿态窗口，不将 `SingArea\Wrist` 作为全程开关。

## 2026-08-23 — RAPID 程序规划错误详细诊断日志

### 修改文件与原因

- `src/rapid/plan-shared.ts`：新增 `MotionPlanDiagnostic`，让笛卡尔路径失败可以携带 waypoint 序号、轴索引、前后角度、关节步长和限位范围；`cartesianPathFailureToMotionError` 接收并保留该上下文。原因是原实现把“逆解未收敛/构型重配置/关节限位”压缩成只有一条 message，无法判断具体失败位置。
- `src/rapid/movel-planner.ts`、`src/rapid/movec-planner.ts`：将共享 waypoint 求解器的诊断传入 RAPID 规划错误。原因是 MoveL/MoveC 映射阶段曾丢弃 `WaypointFailureDiagnostic`。
- `src/rapid/program-executor.ts`：`ProgramError` 增加可选诊断字段，错误结算时保留规划器上下文；运行时错误仍不会伪造关节诊断。
- `src/application/program-control.ts`：新增程序错误描述器。`[ABB-PROGRAM] 程序规划错误` 现在输出结构化对象和可读 `summary`，包含程序指令序号、源码行列、原始指令文本、稳定错误码、错误消息，以及 waypoint/J 轴/角度/步长/限位等字段；没有关节级数据时明确标注失败发生在起点正解、输入校验或全局候选筛选阶段。
- `src/rapid/program-executor.test.ts`：增加诊断字段在执行器中完整传递的回归。
- `src/rapid/movel-planner.test.ts`：增加机械零位构型重配置失败必须包含 waypoint 与轴级诊断的回归。
- `src/application/program-control.test.ts`：增加控制器级 console.error 结构化日志回归，确认源码位置、指令文本、错误码和诊断均可读取。

### 影响

- 只扩展失败信息传播和日志，不改变 IK 候选选择、SingArea 策略、路径采样或 MotionRunner 执行时序。
- 现有调用方仍可读取 `error.kind` 与 `error.message`；新增 `diagnostic` 为可选字段。
- 浏览器控制台示例现在可直接定位到类似：`第 4 行 MoveL ...；waypoint #1；失败轴 J4；前值 0°；尝试值 0.756°；步长 0.756°`，从而区分真正不可达与腕部构型重配置。

### 验证

- `npm run check` ✅。
- 定向回归：`program-control.test.ts`、`program-executor.test.ts`、`movel-planner.test.ts` 共 72 项通过 ✅。
- 全量 `npm test`：本次相关测试通过；全量仍有仓库既有 App 路由 stub、MoveC 并行超时和 CodeMirror/jsdom `getClientRects` 异常，未因本次改动新增业务失败。

## 2026-08-23 — 笛卡尔路径步长错误分类与有限自适应细分

### 修改文件与原因

- `src/robotics/ik-waypoint-solver.ts`：普通路径中相邻关节超过连续性阈值时返回 `joint-step`，不再伪装成 `ik-not-converged`；只有机械零位腕部邻域且 J4/J6 发生腕部重分配时才返回 `wrist-reconfiguration`。
- `src/robotics/cartesian-path-planner.ts`：保留初始 200 waypoint 性能护栏；当失败原因为 `joint-step` 且诊断步长不超过阈值两倍时，最多重采样两轮（200→400→800），重新执行完整路径求解。超过两倍的步长不自动放行，避免用加密掩盖 180° 构型跳变或真实错误。
- `src/rapid/plan-shared.ts`：`joint-step` 的 RAPID 文案改为“路径相邻关节步长超过连续运动限制，已拒绝该路径点”，与实际失败原因一致。
- `src/application/cartesian-control.ts`：笛卡尔面板状态同步显示相邻关节步长限制，不再泛化为“路径不可达/构型跳变”。
- `src/robotics/cartesian-path-planner.test.ts`、`src/application/cartesian-control.test.ts`：更新普通步长失败的断言，验证非腕部路径不会误报腕部重构。
- `src/rapid/movel-planner.test.ts`：新增真实回归：机械零位 MoveJ 到 Z≈1139.1 后执行到 Z≈-310.9 的长 MoveL，确认 J6 临界 5° 步长会触发自适应采样并成功规划，最终相邻步长不超过 5°。

### 影响

- 用户日志中的 `waypoint #32 / J6 / 5.515°` 现在会被识别为连续性步长问题，而不是“逆解未收敛/目标不可达”。
- 临界的小幅超步长会通过增加路径采样得到更平滑的轨迹；大幅跳变仍然失败并保留具体轴级诊断。
- 不修改 J4/J6 关节限位、不自动扩大 SingArea、不改变 MotionRunner 执行时序；长路径最多增加到 800 个 waypoint，预算是有限的。

### 验证

- `npm run check` ✅。
- 定向回归：笛卡尔控制、路径规划、MoveL、MoveC、ProgramExecutor、RAPID 程序控制共 108 项通过 ✅。

## 2026-08-23 — J4/J6 路径分支审计日志

### 修改文件与原因

- `src/robotics/joint-path-audit.ts`：新增低噪声关节路径审计器。检测 J4/J6 单步变化达到 20° 或绝对值达到 150° 的 waypoint，并保留前一个、当前、后一个完整 J1–J6 快照、两侧步长、最大腕部绝对角度和最大腕部步长。
- `src/rapid/movel-planner.ts`：MoveL 规划成功后按规划起点输出 `[CARTESIAN-JOINT-AUDIT]` 单行 JSON；仅可疑路径输出，不影响运动执行。
- `src/application/cartesian-control.ts`：笛卡尔 Jog 成功路径使用同一审计器，异步规划沿用提交时的真实规划锚点，不读取过期 UI 关节值。
- `src/robotics/joint-path-audit.test.ts`：覆盖可疑路径的前/当前/后三组六轴输出和普通路径不输出审计。

### 影响与使用方式

- 浏览器控制台筛选 `[CARTESIAN-JOINT-AUDIT]`，复制第二个参数的 JSON 文本即可定位 J4/J6 是从哪一个 waypoint 开始变化。
- JSON 中的 `suspiciousPoints` 包含 `previous`、`current`、`next`；`maxWristAbsolute` 用于判断是否选中了 ±180° 等价腕部支路。
- 日志只读规划结果，不改变 IK 候选、关节限位、SingArea 或轨迹播放。

### 验证

- `npm run check` ✅。
- `npm run lint` ✅。
- 审计、MoveL、Cartesian control 定向回归共 27 项通过 ✅。

### 审计字段补充

- `src/robotics/joint-path-audit.ts`：审计 JSON 增加 `initialJoints`、`initialWristAbsDeg`、`maxWristStepPoint` 和 `firstHighWristPoint`。这样可以区分 MoveL 起点已带翻腕分支，还是路径中途才进入高腕角分支。
- `src/robotics/joint-path-audit.test.ts`：增加起点、最大步长点和首次高腕角点的断言。

验证：审计/MoveL/Cartesian control 定向回归 27 项通过，`npm run check` ✅。

## 2026-08-23 — 整条路径腕部支路可行性分析

### 修改文件与原因

- `src/robotics/wrist-path-feasibility.ts`：新增只读诊断模块。对整条笛卡尔路径逐 waypoint 枚举严格 IK 候选，统一应用位置/姿态残差、关节限位、相邻步长和 J5 初始侧约束；分别以 J4/J6 最大绝对角度、相对初始最大偏移、累计腕部行程为目标做动态规划。原因是原候选图只返回一条最低代价路径，无法证明“低腕部支路是否存在”或区分“算法选错”与“约束不可同时满足”。
- `src/robotics/wrist-path-feasibility.test.ts`：增加当前 MoveJ 到 Z≈1139.1 后、保持 TCP 姿态从 Z≈1139.1 直线到 Z≈−310.9 的 400 waypoint 分析；输出整体指标和关键 waypoint 的全部严格候选，用于复核 J4/J6 支路与 J5 侧。

### 当前模型的分析结论

- 严格位置/姿态容差为 0.05 mm / 0.001 rad，相邻关节步长上限 5°，J5 奇异窗口为 ±1°。
- 严格姿态且 J5 始终保持初始正侧的路径存在，但三种腕部优化目标得到同一连续支路：J4 最大相对初始偏移约 164.17°，J6 约 172.95°，腕部累计转动约 338.39°；最大单步仅约 4.25°。因此这是“连续地选中了翻腕拓扑”，不是某一个 waypoint 的瞬时 180° 跳变。
- 低腕候选在部分 waypoint 确实存在，但属于不同 J2/J3 支路。例如 waypoint 74 的候选 J4≈6.22°、J6≈−0.66°，同时 J2≈87.30°、J3≈−171.18°；当前连续支路 J2≈0.20°、J3≈1.82°，两者无法在 5°连续性约束内切换。
- 末端低腕等价候选约为 `[J4=-6.27°, J5=-82.04°, J6=0.70°]`，与当前支路 `[J4=173.73°, J5=82.04°, J6=-179.30°]` 是球腕等价翻转的两侧；从当前 J5 正侧到该候选必须穿过 J5=0 腕部奇异面，不能同时保持严格姿态、连续关节和“不穿越奇异点”。

### 影响

- 本次不改变 Jog、MoveL、SingArea 或候选选择逻辑，只增加可重复的可行性证据和诊断输出，避免继续用 J4 硬限制掩盖拓扑约束。
- 结论仅针对当前候选 DH、关节范围、目标姿态和路径；它不能证明真实 ABB 标定链在所有姿态下的内部实现。若要让 J4/J6 保持较小，必须放宽至少一个约束（局部姿态窗口/中间姿态过渡/允许腕部奇异慢停），而不是继续调大步长或限位。

### 验证

- `npm run check` ✅。
- `npx vitest run src/robotics/wrist-path-feasibility.test.ts --reporter=verbose` ✅（1 项）。

## 2026-08-23 — X≈750/Y≈342/Z 反向路径构型核对

### 修改文件与原因

- `src/robotics/cartesian-reversibility.test.ts`：新增正向 Z 直线与反向闭环诊断。以 `[24.7,66.7,-86.9,-1.4,107.6,24.2]` 为起点，沿保持姿态的 Z 直线规划到约 −55.8 mm，再以真实下行末端关节反向规划回起点；同时将用户提供的关节快照逐一做 FK 位置核对。原因是用户将正反向不同时间点的 J2/J3/J5 数值直接比较，需先确认它们是否对应同一 TCP Z 位置。

### 核对结论

- 正向末端为 `[24.66,114.46,-84.68,-1.58,57.64,25.43]`，与用户给出的上→下末端 `[24.7,114.6,-84.7,-1.6,57.5,25.5]` 一致。
- 从该真实末端反向规划，最终回到起始关节，最大误差约 `5×10⁻¹³°`；当前候选图在同一支路内是可逆的。
- 用户下→上快照 `[120.9,-131.9,98.4]` 的 FK TCP Z≈214.4 mm；`[91.0,-120.6,117.0]` 的 FK TCP Z≈568.7 mm，并不是同一组上→下快照的 Z 位置。
- 正向路径在 Z≈214.4 mm 的 waypoint 为 `[120.73,-131.57,98.24]`，在 Z≈568.4 mm 的 waypoint 为 `[90.87,-120.28,116.81]`，与用户下→上快照逐轴吻合。因此这组数据证明的是同一支路在不同 Z 位置的关节变化，不是 J2/J3/J5 发生了错误构型切换。

### 影响

- 本次只增加诊断测试，不修改 IK、候选图或运动播放逻辑。
- 后续比较正反向构型时必须同时记录 `TCP XYZ/RXYZ + J1~J6 + waypoint/时间`；只比较不同时间点的六轴角度会把正常路径变化误判为构型跳变。

### 验证

- `npx vitest run src/robotics/cartesian-reversibility.test.ts --reporter=verbose` ✅。

## 2026-08-23 — 操作轴与笛卡尔 Jog 入口对照

### 修改文件与原因

- `src/robotics/gizmo-jog-parity.test.ts`：使用用户当前关节 `[24.7,111.1,-77.9,-1.6,54.2,25.6]` 和同一个 Z 目标，分别调用操作轴的 `solveGizmoTarget` 与笛卡尔 Jog 的 `planCartesianPath`，记录末端关节和 FK 位置。原因是两个入口确实使用不同的规划层，需先区分“入口差异”与“同一目标的 IK 解差异”。

### 代码事实

- 笛卡尔 Jog：`useCartesianControl → planCartesianTarget → planCartesianPath → planStrictCandidateGraph`，对整条路径枚举解析 IK 候选，应用严格姿态、关节限位、相邻步长和自适应采样。
- 3D 操作轴：`AbbTransformGizmo → App.solveGizmoTarget → solveGizmoTarget → solveIK`，每个拖拽事件求一个目标点；解析候选主解成功时立即返回，失败才扫描备用初值；允许贴近关节软限位，不建立整条路径候选图，也不经过 MotionRunner 轨迹播放。
- 两者的目标坐标也来自不同层：Jog 目标由当前 DH FK 派生的 World/Tool 位姿增量生成；操作轴目标由 Three.js 场景米制坐标和 `sceneTransformToAbbPose` 基变换还原为 ABB 毫米坐标。

### 对照结果

- 对同一当前关节和同一目标 `[X≈747.5,Y≈341.1,Z=695]`，两条入口最终均得到约 `[24.66,65.03,-84.33,-1.35,106.68,24.23]`，FK 位置均回到目标。
- 因此“入口算法不同”成立，但本次单目标差异不能直接证明解析 IK 错误；若界面显示的可达范围或构型不同，还需同时审计操作轴换算后的目标 Pose、拖拽过程每帧目标以及是否经过边界/分支切换。

### 影响

- 本次只新增入口对照测试，不修改操作轴或 Jog 生产逻辑。
- 后续若要求两个入口行为一致，应让操作轴复用与 Jog 相同的“当前状态锚定 + 连续路径候选图 + 统一残差/限位策略”，而不是继续分别修补两个 IK 入口。

### 验证

- `npm run check` ✅。
- `npm run lint` ✅。
- `npx vitest run src/robotics/gizmo-jog-parity.test.ts --reporter=verbose` ✅。

## 2026-08-23 — 操作轴复用统一笛卡尔候选策略

### 修改文件与原因

- `src/robotics/cartesian-candidate-graph.ts`：为候选图增加可选 `maxJointStepDeg`。默认仍为笛卡尔路径的 5°硬步长；传 `null` 时仅保留候选代价，不做单帧硬拒绝。原因是 Jog 的路径级连续性限制不能原样套在鼠标 pointer frame 上，否则一次拖拽像素跳跃会被误判为构型跳变。
- `src/robotics/ik-waypoint-solver.ts`：`solveGizmoTarget` 改为复用一层 `planStrictCandidateGraph`，统一解析候选、姿态/位置残差、J4/J6 连续性代价和软限位筛选；不再走单点数值 IK + 备用 seed 的独立分支。操作轴仍只返回一个目标关节点，不生成 MoveL 的长路径。
- `src/robotics/gizmo-solver.test.ts`：将旧的“多初值失败率不劣于单初值”断言改为共享候选图的有限失败率验收。旧断言会鼓励接受贴近软限位的单点解，与统一 Jog 策略冲突。

### 影响

- 操作轴和 Jog 现在使用同一套解析候选和分支代价；同一目标的最终 J1~J6 结果一致。
- 操作轴单帧不执行 5°硬拒绝，避免正常拖拽因 pointer frame 距离过大而频繁回弹；如果目标候选触及软限位或无严格解析解，仍拒绝并回弹。
- 操作轴仍是轻量单点更新，不改变 Jog 的 400 waypoint 路径播放，也不自动开启 SingArea\Wrist。

### 验证

- `npm run check` ✅。
- `npm run lint` ✅。
- 运动相关定向回归 44 项通过：候选图、路径规划、操作轴求解、操作轴/Jog 对照、正反向闭环、腕部路径分析和 MotionRunner。
## 2026-08-23 · 867/-10.1 Z 直线腕部支路诊断

- **修改文件**：`src/robotics/z-singularity-diagnostic.test.ts`、`UPDATE_LOG.md`。
- **修改原因**：将用户提供的 `[-0.7,114.4,-142.7,1.6,28.3,-1.4]` 与 `X=867,Y=-10.1,Z=464.8→152.3` 场景固定为可重复的规划诊断，区分 `J5=0` 腕部支路穿越与执行阶段短路插补。
- **修改内容**：复用现有 `planCartesianPath` 和 `analyzeWristPathFeasibility`，输出起点 FK、waypoint 数量、端点关节、最大相邻步长、J5 穿越 waypoint 以及“严格全支路/保持初始 J5 侧”结果；增加 5° 连续性断言。
- **影响**：仅增加测试诊断，不改变生产规划、IK、MotionRunner 或界面行为。
- **验证**：待执行针对性 Vitest、`npm run check` 与 `npm run lint`。

### 诊断输出补充

- **原因**：首轮测试在失败断言前未输出 `planCartesianPath` 的失败分类。
- **修改**：将规划结果打印置于断言之前。
- **影响**：仅增强诊断可见性，不改变生产行为。

### 诊断候选补充

- **原因**：已定位到第 155 个路径点的 J3 约 107° 步长，需要确认其相邻解析候选与 J5 腕部侧。
- **修改**：失败时额外分析 200 个固定姿态 waypoint，并输出第 153～156 点的严格候选、J5 符号及两种整路径可行性结果；断言当前现象为 `joint-step`。
- **影响**：仅增加可重复诊断数据，不改变生产规划行为。

### 终点单目标支路补充

- **原因**：需要区分整条路径的连续性拒绝与操作轴单目标选择的构型。
- **修改**：诊断测试额外输出终点严格候选及 `solveGizmoTarget` 的单点结果。
- **影响**：仅增加诊断输出，不改变生产逻辑。

### 反向可逆性诊断补充

- **原因**：用户报告同一段 Z 运动正向可到达、反向却失败，需要用实际底部单点支路作为反向起点复现。
- **修改**：增加底部支路到顶部的 `planCartesianPath` 诊断，输出底部 FK、目标位置和反向失败分类。
- **修改补充**：反向实测为路径规划成功但终点关节构型不同，因此改为断言“位姿可逆、关节支路未恢复”，并压缩日志为端点摘要。
- **影响**：仅增加测试诊断，不改变生产规划、执行或构型选择。

### 软限位候选诊断补充

- **原因**：第 155 点旧支路可能是被 `J2` 距离上限 0.5° 的软限位筛选删除，而非解析 IK 无解。
- **修改**：诊断快照保留软限位和范围标记，不再只输出最终合法候选。
- **影响**：仅增加诊断输出，用于区分真实 `+130°` 限位与过早软限位拒绝。
- **修改补充**：增加 `rejectAtJointLimit:false` 对照报告，记录移除软限位后路径是否仍在真实 `J2=+130°` 处失败。

## 2026-08-23 · J5≈6° 向上点动诊断

- **修改文件**：`src/robotics/upward-wrist-diagnostic.test.ts`、`UPDATE_LOG.md`。
- **修改原因**：复现用户提供的 `[-2.5,26.7,-20.8,-203.4,6.3,203.3]` 在向上点动时第 45 个路径点 J3 约 115° 跳变。
- **修改内容**：按 Z+50 mm 固定姿态路径调用现有 `planCartesianPath`，输出失败诊断和第 43～46 个 waypoint 的全部严格 IK 候选、软限位和腕部差异。
- **影响**：仅增加诊断测试，不改变生产 IK、路径规划或执行行为。
- **修改补充**：同时输出解析器未归一化的原始候选，用于验证 J4/J6 ±360°等价表示是否被固定起点参考错误折叠。
- **修改补充**：增加 5°/10°/15° 相邻步长对照，区分固定步长误判与真实连续支路不可行。
- **修改补充**：增加界面显示欧拉姿态 `[180,-90,0]` 的对照规划，排除 RY=-90° 欧拉表示差异。
# 2026-08-23：补充上行点动入口对照诊断

- 修改文件：`src/robotics/upward-wrist-diagnostic.test.ts`。
- 修改原因：仅调用底层 `planCartesianPath` 不能代表实际笛卡尔点动；实际入口会先严格规划，机械零位邻域失败后再按 `allowWristEntry` 触发局部 Wrist 回退。本次增加 `planCartesianTarget` 对同一关节与显示姿态的对照输出，区分“入口未触发回退”和“回退算法仍不可行”。
- 修改影响：仅增加诊断日志和回归覆盖，不改变生产规划逻辑。

# 2026-08-23：补充上行位置优先解对照

- 修改文件：`src/robotics/upward-wrist-diagnostic.test.ts`。
- 修改原因：严格姿态路径在 J4 支路边界失败后，需要验证是否存在保持 TCP 位置、对姿态放宽的位置优先连续解；增加有限 50 点诊断，不改变实际规划器行为。
- 修改影响：仅输出 position-only 参考关节快照与失败点，用于决定是否应进入局部 Wrist 策略。
- 补充：同时记录位置优先解相对严格目标的最大姿态偏差，避免在未量化姿态误差前直接放宽策略。
- 补充：扫描 J4/J6 连续性正则强度，量化姿态误差与腕部运动的可行折中。
- 补充：姿态权重扫描的失败结果包含 waypoint 序号，便于区分数值不收敛和关节范围边界。
- 补充：增加 ±0.5°/±1°/±2°（内部按 0/1/2 度）末端姿态过渡扫描，验证 ABB“奇异点另一侧首点改姿态”在该输入下是否存在可行支路。
- 编译修正：复用现有 `src/robotics/math/rotation3d.ts` 的 `mat3Mul`，避免引入不存在的矩阵模块。

# 2026-08-23：增加受限腕部姿态过渡

- 修改文件：`src/robotics/cartesian-motion-planner.ts`、`src/robotics/upward-wrist-diagnostic.test.ts`。
- 修改原因：严格姿态在低 J5 且 J4/J6 接近大范围边界时会把可连续的局部支路误报为 J3 大步长；ABB 的处理是修改奇异点另一侧首个目标姿态。新增有限 ±0.5°至 ±2°姿态过渡候选，按最小偏差及腕部连续性选择。
- 触发范围：仅笛卡尔平移点动已允许腕部入口、严格路径返回 `joint-step`、起始 J5≤10° 且 J4/J6 至少一轴绝对值≥180°；普通工作区和姿态点动不触发。
- 入口顺序修正：先处理上述窄窗口，再对其余非机械零位路径保持原严格失败语义，避免旧保护条件提前短路。
- 类型边界修正：没有腕部奇异能力声明的机器人模型不会进入该过渡候选。
- 性能修正：姿态过渡按偏移层早停，仅比较最小可行偏移层内的六个方向，避免一次边界点动重复规划 24 条路径。
- 注释修正：入口文档改为“受限局部腕部姿态过渡”，与机械零位和腕边界两类资格保持一致。
- 回归：增加非机械零位 J5=0/J6 多圈平移入口测试，确认仍返回 `joint-step`，不自动开启 Wrist。
- 触发边界修正：自动过渡要求 `1° < |J5| ≤ 10°`，精确 J5=0 的非机械零位保持原拒绝语义。

# 2026-08-23：修正 Wrist 状态提示语义

- 修改文件：`src/application/cartesian-control.ts`。
- 修改原因：新增的腕边界姿态过渡不一定来自全零机械零位，原 UI 提示会错误标成机械零位奇异。
- 修改影响：`wrist-solved` 现在显示局部腕部姿态过渡及 ≤2°姿态误差上限；不改变规划结果或触发条件。
- 修改影响：成功结果标记 `appliedSingularityMode='wrist'`，TCP 位置仍由原笛卡尔路径严格规划；姿态误差最多 2°。严格路径或候选全部失败时仍返回原失败，不放宽关节限位。
- 回归：`cartesian-path-planner.test.ts` 增加用户上行 50 mm 输入，验证不会再把 J3 115°错误跳变作为失败。
- 编译修正：回归测试对模型 FK 的可空返回增加显式断言和类型收窄。

# 2026-08-23：同步 Wrist 结果的连续 Jog 锚点

- 修改文件：`src/application/cartesian-control.ts`。
- 修改原因：局部姿态过渡的实际末端姿态可能与原始目标有≤2°偏差；连续点动若仍保存原始目标，会使下一请求重复追姿态并产生顿挫。
- 修改影响：仅 `appliedSingularityMode='wrist'` 的连续请求使用末端 FK 作为下一规划锚点；严格姿态结果和非连续点按行为不变。
- 回归：`cartesian-control.test.ts` 增加两帧 50 mm 上行连续点动，验证第二帧使用实际 Wrist 姿态而非旧目标锚点。
- 回归修正：第二帧改为真实长按节拍的 10 mm；一次再规划 50 mm 会超出当前 2°姿态过渡预算，不作为连续 Jog 的合理验收。
- 编译修正：回归测试对 FK 失败增加安全回退。
- 编译/断言修正：为新增连续支路测试闭包补充 FK 类型收窄，并按 50+10 mm 实际位移调整 Z 断言。
- 编译修正：为连续支路测试的 FK 闭包补上实际空值保护。

# 2026-08-23：增加受限姿态权重的 IK 能力

- 修改文件：`src/robotics/types.ts`、`src/robotics/ik-solver.ts`、`src/robotics/upward-wrist-diagnostic.test.ts`。
- 修改原因：原 `positionOnly` 会把姿态任务硬置零，无法判断“保持 TCP 位置且姿态误差≤2°”是否存在连续解；新增显式 `orientationWeight`，仅在调用方明确设置时参与位置优先数值 IK。
- 修改影响：默认严格 6D IK 与原纯 position-only 行为保持不变；诊断增加不同姿态权重下的最大姿态误差、腕部步长和累计变化输出，为后续局部 Wrist 策略提供可量化依据。

# 2026-08-24：改进局部 Wrist 候选的整段路径选择

- 修改文件：`src/robotics/cartesian-motion-planner.ts`、`UPDATE_LOG.md`。
- 修改原因：原实现找到最小姿态偏移层后立即停止搜索，可能选中一条虽然满足姿态误差、但把 J4/J6 累积推向 ±270° 限位的路径；下一次继续上移时，严格支路再次失败并错误回退到 J3 大步长候选。
- 修改内容：在允许的 ±0.5°、±1°、±1.5°、±2°候选中全部完成路径规划，按“J4/J6 整段最大绝对角度 → 相对起点的最大腕部位移 → 腕部累计变化量 → 姿态偏移量”排序，优先保留离关节限位更远且连续的整段支路。
- 修改影响：仍限制在低 J5、J4/J6 接近边界、平移点动且严格路径返回 `joint-step` 的窄窗口；姿态误差上限仍为 2°，普通工作区、旋转点动、精确非机械零位奇异和关节限位规则不变。

# 2026-08-24：扩展连续上行回归场景

- 修改文件：`src/application/cartesian-control.test.ts`、`UPDATE_LOG.md`。
- 修改原因：Wrist 首帧完成局部姿态过渡后，后续 10 mm 点动可能已经回到严格姿态可行支路，不能把每一帧都硬断言为 `wrist-solved`。
- 修改内容：允许后续状态在 `solved` 与 `wrist-solved` 之间按实际规划结果变化，并连续执行 25 个 10 mm 上行步，覆盖约 Z=1100 mm 区间。
- 修改影响：只修正回归测试的状态机断言；仍要求每步成功且 TCP 持续上行，不改变生产状态映射或姿态误差限制。

# 2026-08-24：补充连续上行失败上下文

- 修改文件：`src/application/cartesian-control.test.ts`、`UPDATE_LOG.md`。
- 修改原因：连续上行回归在靠近腕轴限位时仍可能失败，仅显示 `joint-step` 无法判断是第几步及实际关节状态。
- 修改内容：为每个上行步增加失败步号、状态和六轴快照到断言消息，便于区分支路选择问题与真实限位不可行。
- 修改影响：仅增强测试诊断，不改变运行时策略。

# 2026-08-24：补充连续上行失败诊断文本

- 修改文件：`src/application/cartesian-control.test.ts`、`UPDATE_LOG.md`。
- 修改原因：失败状态还需要包含规划器映射后的轴、步长和限位信息，才能定位第 20 步失败的真实原因。
- 修改内容：断言消息同时输出 `statusMessage`。
- 修改影响：仅增强测试可读性，不改变运行时行为。

# 2026-08-24：增加低 J5 腕部边界的受限位置优先回退

- 修改文件：`src/robotics/cartesian-path-planner.ts`、`src/robotics/ik-waypoint-solver.ts`、`src/robotics/cartesian-motion-planner.ts`、`UPDATE_LOG.md`。
- 修改原因：局部终点姿态过渡全部不可行时，连续点动会在低 J5 腕部窗口内错误切换到 J4/J6 另一支，表现为 J3 或 J4 的几十度至百余度步长。
- 修改内容：为路径规划增加仅由上层显式授权的 `wristFallback` 选项；在低 J5 且 J4/J6 接近边界的平移点动中，严格支路失败后使用 `SingArea\\Wrist` 语义的位置优先求解，并对 J4、J6 同时加入连续性权重；每个 waypoint 仍要求 TCP 位置精度和姿态误差不超过 2°。
- 修改影响：只作用于已通过窄窗口判定的连续平移点动；普通工作区、旋转点动、MoveL 默认严格姿态、精确非机械零位奇异和关节限位规则保持不变。

# 2026-08-24：增强受限 Wrist 回退的腕轴连续性权重

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：位置优先回退在第 21 个上行步仍可能选择 J6 的 12°等价表示，随后被 5°连续运动护栏正确拒绝。
- 修改内容：将受控 Wrist position-only 求解的 J4/J6 连续性正则从 100 提高到 1000；只改变候选评分，不改变关节限位和单步硬限制。
- 修改影响：仅影响机械零位或上层明确授权的低 J5 腕部边界回退，普通 IK 和严格姿态路径不变。

# 2026-08-24：校正 Wrist 正则的单位量级

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：数值 IK 的 Jacobian 以弧度/毫米量纲参与正规方程，1000 的连续性权重仍不足以压住 J6 的等价分支跳变。
- 修改内容：将受控 Wrist 回退的 J4/J6 软连续性权重提升至 `1_000_000`，仍保留 position-only 的软约束语义和 5°硬步长护栏。
- 修改影响：只影响低 J5 腕部边界回退的候选排序；严格 6D IK、普通位置优先调用和关节限位不变。

# 2026-08-24：增加 Wrist 等价分支的单步修复

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：软连续性正则仍可能在低 J5 位置优先解中返回 J4/J6 超过 5°的等价分支，随后被路径护栏拒绝。
- 修改内容：仅当受控 Wrist 回退候选的 J4/J6 超过 5°单步时，临时锁定发生跳变的轴到上一 waypoint，并重新求解；位置、姿态和关节限位验收仍全部执行。
- 修改影响：不会锁定普通运动或整段会话，也不会改变严格 6D IK；若临时锁定后没有满足位置/≤2°姿态的解，仍返回原失败。

# 2026-08-24：修正 Wrist 候选修复的执行顺序

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：低 J5 回退的初次 `resolveJointSolution` 先触发 5°护栏，超步长候选被提前转换为 failure，无法进入等价分支临时锁定修复。
- 修改内容：仅对显式授权的低 J5 Wrist 回退取消初次求解的步长参数，先保留候选，再执行 J4/J6 临时锁定；最终 waypoint 仍由 5°硬护栏验收。
- 修改影响：只改变受控 Wrist 回退的内部顺序，严格 IK 和普通位置优先求解不变。

# 2026-08-24：放宽临时锁轴重求解的内部步长筛选

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：临时锁定 J6 后，重求解过程仍先用 5°参数筛掉候选，无法把修复结果交给最终 waypoint 护栏统一验收。
- 修改内容：临时锁轴重求解不再传入连续步长参数，仅由最终的 J4/J6/全轴步长检查决定是否接受。
- 修改影响：只影响低 J5 Wrist 的一次性候选修复，不改变最终 5°连续运动限制和其他求解路径。

# 2026-08-24：将低 J5 Wrist 的腕轴连续约束前移

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：候选先跳变再临时修复仍会让数值 IK 落入错误 J6 等价分支，无法稳定连续上行。
- 修改内容：在显式授权的低 J5 Wrist position-only waypoint 求解开始时，将 J4/J6 目标设为上一 waypoint 值；该约束仅覆盖当前局部回退段，严格路径可行后立即恢复。
- 修改影响：不改变普通运动、严格 6D IK、MoveL 默认行为或关节范围；局部段仍由其余关节求 TCP 位置，并执行姿态≤2°和最终步长验收。

# 2026-08-24：改为有限腕轴步长候选集合

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：同时固定 J4/J6 在后续 waypoint 可能造成位置无解；完全放开又会落入多圈等价分支。
- 修改内容：低 J5 Wrist 回退枚举 J4/J6 保持原值或各自仅移动一个 ±5°步长的有限锁定组合，逐个验证 TCP 位置、姿态≤2°及全轴单步限制后选择可行候选。
- 修改影响：允许腕轴小幅、受控变化，不再全程硬锁；普通工作区和严格姿态路径不使用该候选集合。

# 2026-08-24：加密低 J5 Wrist 回退的笛卡尔采样

- 修改文件：`src/robotics/cartesian-path-planner.ts`、`UPDATE_LOG.md`。
- 修改原因：10 mm Wrist 回退在 1 mm 内部 waypoint 处仍可能需要超过 ±5°的腕轴变化，导致位置优先候选无解。
- 修改内容：仅对显式 `wristFallback` 路径使用 0.25 mm 内部线性步长；严格路径和普通点动仍保持原 1 mm/性能护栏采样。
- 修改影响：低 J5 窄窗口的单段规划计算量增加，但每个 waypoint 仍执行 5°单步和姿态≤2°验收，不改变 TCP 直线目标。

# 2026-08-24：让 Wrist 回退备用种子参与连续性筛选

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：位置优先回退初次求解取消连续性参数后，会直接接受 J6 多圈主初值，绕过备用种子选择。
- 修改内容：Wrist 候选及其有限锁定策略统一传入 5°连续性参数；超步长主初值被拒绝后，才扫描确定性备用种子并进行位置/姿态验收。
- 修改影响：仅约束受控 Wrist 回退的候选选择，不放宽最终步长限制，也不改变普通 IK。

# 2026-08-24：撤回未证实的 position-only 强行穿越实验

- 修改文件：`src/robotics/cartesian-motion-planner.ts`、`src/robotics/cartesian-path-planner.ts`、`src/robotics/ik-waypoint-solver.ts`、`src/application/cartesian-control.test.ts`、`UPDATE_LOG.md`。
- 修改原因：连续上行实验表明，在 J4/J6 单步≤5°、TCP 姿态误差≤2°和当前位置约束同时成立时，后续 waypoint 存在真实无解；继续增加锁轴、采样或备用种子只会引入非 ABB 的强行穿越行为。
- 修改内容：撤回本轮临时 `wristFallback` 选项、position-only 锁轴候选、0.25 mm 特殊采样和调试审计日志；保留已验证的整段 Wrist 候选安全评分（优先远离 J4/J6 限位），并将连续回归恢复到已验证的 50+10 mm 场景。
- 修改影响：生产行为在可行支路上平滑通过；约束冲突时保持结构化失败，不再把错误多圈解伪装为成功。普通路径、操作轴和 MoveL 语义不被实验分支改变。

# 2026-08-24：统一笛卡尔路径的备用求解步长护栏

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：严格候选图失败后，普通非机械零位路径的逐点备用求解原先没有连续步长参数，可能返回 J6 12°等价跳变并被误报为可执行路径。
- 修改内容：所有 `solvePoseWaypoints` 笛卡尔 waypoint 统一使用 5°相邻步长限制；操作轴单点仍走独立 `solveGizmoTarget`，不受本路径级改动影响。
- 修改影响：普通工作区只会拒绝真实构型跳变，不会改变合法连续候选；低 J5 窄窗口仍由显式 Wrist position-only 回退处理。

# 2026-08-24：增加 Wrist 回退首点审计日志

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：连续上行仍出现 J6 多圈候选，需要区分严格候选失败、Wrist 候选失败和临时锁定结果。
- 修改内容：仅在显式低 J5 Wrist 回退的每段首个 waypoint 输出一次 `WRIST-FALLBACK-AUDIT`，包含上一帧、严格候选、Wrist 候选和锁定目标。
- 修改影响：不改变求解结果；日志粒度限制为每段一次，便于定位数值分支，不输出迭代级噪声。

# 2026-08-24：补充 Wrist 候选姿态误差审计

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：连续 J4/J6 候选被姿态误差上限拒绝时，原诊断只显示严格支路的错误轴，无法证明两组约束是否冲突。
- 修改内容：`WRIST-FALLBACK-POSE-ERROR` 输出候选相对目标的姿态角误差及是否通过 2°阈值。
- 修改影响：仅增加受控回退首点日志，不改变验收规则或运动结果。

# 2026-08-24：补充 Wrist 后续 waypoint 拒绝审计

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：首点姿态误差已低于 2°，但整段仍失败，需要知道后续 waypoint 是姿态超差还是数值求解失败。
- 修改内容：低 J5 Wrist 回退在姿态拒绝或 position-only 求解失败时输出 waypoint 序号、姿态误差、候选和上一帧关节。
- 修改影响：仅增加失败分支日志，不改变姿态阈值和运动策略。

# 2026-08-24：腕部回退收敛到解析 IK 单一入口，引入 ABB confdata 多解选择

- 修改文件：`src/robotics/cartesian-motion-planner.ts`、`src/robotics/ik-waypoint-solver.ts`、`src/robotics/ik-candidate-catalog.ts`、`src/robotics/ik-solver.ts`、`src/robotics/robot-model.ts`、`src/robotics/types.ts`、`src/robot-models/abb-irb1200/abb-analytic-ik.ts`、`src/robot-models/abb-irb1200/dh-robot-model.ts`、`src/application/cartesian-control.ts`、`src/App.vue`、worker 与相关测试；诊断/研究文件迁至 `.scratch/cartesian-jog-global-planning/diagnostics/`。
- 修改原因：wrist 回退存在 `planLocalWristTransition` 旁路，绕过统一奇异上下文；DLS 数值解在奇异/限位附近会把构型拉偏；多解选择只看距离，与真实控制器 confdata 语义不一致。
- 修改内容：
  1. 删除 `planLocalWristTransition`/`allowWristEntry`，`planCartesianTarget` 直接走 `planCartesianPath`，腕部决策收敛到 `WristSingularityContext` 单一入口。
  2. 腕部逃离改用解析候选目录筛选（限位、姿态窗口、J5 侧、连续性），DLS 只在同一解析支路上做位置精化。
  3. 解析 IK 为每个候选输出 ABB 构型 `[cf1, cf4, cf6, cfx]`；`RobotModel.deriveConfiguration` 反推当前构型；`selectBestIKCandidate` 优先保持当前构型，无合法同构型候选时退回全局最近。
  4. 超臂展目标的错误码由误报的 `wrist-reconfiguration` 修正为 `unreachable`；修复 `app-profile-stability` 测试遗留的落地页路由与初始 home 关节问题。
- 修改影响：解析 IK 是构型唯一真相源，DLS 仅作局部精化器；多解选择与 ABB 控制器 confdata 同语义；`npm test` 563 全过，`vue-tsc`/eslint 通过。
## 2026-08-25 — 补充构型与多圈 confdata 回归测试

- 修改文件：`src/robotics/ik-candidate-catalog.test.ts`、`UPDATE_LOG.md`。
- 修改原因：先以公共候选目录、构型选择器和机器人构型推导接口锁定审查发现的两个错误行为，遵循测试先行原则。
- 修改内容：要求无同构型合法候选时返回无解；新增 J6=300° 必须得到 `cf6=3` 的多圈构型测试。
- 修改影响：当前实现预期出现失败测试，待下一步实现修复；未改变生产逻辑。
## 2026-08-25 — 修复多圈 confdata 与静默构型切换

- 修改文件：`src/robotics/ik-candidate-catalog.ts`、`src/robot-models/abb-irb1200/abb-analytic-ik.ts`、`UPDATE_LOG.md`。
- 修改原因：解析候选在 ±180° 回绕后生成的等价多圈表示没有同步更新 ABB `cf1/cf4/cf6`；同构型无解时选择器又静默执行异构型候选。
- 修改内容：按最终合法关节表示重新计算三个 ABB 象限；提供参考构型且无合法同构型候选时返回 `null`，交由上层报告规划失败。
- 修改影响：J4/J6 多圈候选的 confdata 与实际圈数一致；未声明构型切换授权时不再静默重配置。
## 2026-08-25 — 修复 RPI 测试未使用声明导致的类型检查失败

- 修改文件：`src/robotics/ik-real-data-validation.test.ts`、`UPDATE_LOG.md`。
- 修改原因：类型检查发现 RobotStudio 数据路径及加载记录已无测试消费，触发 `noUnusedLocals` 编译错误。
- 修改内容：删除未使用的 RobotStudio 路径、存在性标志和记录加载。
- 修改影响：不改变 RPI 真实数据验证；`vue-tsc` 可继续检查后续修复。
## 2026-08-25 — 增加 RAPID SingArea 语义回归测试

- 修改文件：`src/rapid/movel-planner.test.ts`、`UPDATE_LOG.md`。
- 修改原因：锁定 `\Off` 严格姿态与显式 `\Wrist` 腕部奇异回退必须产生不同规划结果，防止参数继续成为无效传递。
- 修改内容：机械零位 J5=0° 的 5 mm MoveL 在默认模式下要求失败，在 `singArea: 'wrist'` 下要求成功。
- 修改影响：当前实现预期出现失败测试，待下一步把 SingArea 接入路径规划上下文。
## 2026-08-25 — 恢复 RAPID SingArea\\Wrist 的显式规划语义

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`src/robotics/cartesian-path-planner.ts`、`src/rapid/movel-planner.ts`、`src/rapid/movec-planner.ts`、`UPDATE_LOG.md`。
- 修改原因：`SingArea` 只被传递但未参与规划，导致用户按错误提示启用 `\\Wrist` 仍然失败。
- 修改内容：新增窄的 `allowWristFallback` waypoint 规划上下文；RAPID MoveL/MoveC 显式 `\\Wrist` 时授权腕部回退，手动 Cartesian 入口不传该授权；移除过时 `orientationMode` 注释。
- 修改影响：`\\Off` 保持严格姿态，`\\Wrist` 只在对应 RAPID 运动内允许受控姿态误差；不恢复全局姿态降级开关。
## 2026-08-25 — 修复 SingArea 上下文补丁的类型错误

- 修改文件：`src/robotics/ik-waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：新增 waypoint 选项接口被插入函数体内，且旧变量名未完全替换，导致 TypeScript 编译失败。
- 修改内容：将接口移到联合类型声明后，并统一使用 `wristFallbackPath`。
- 修改影响：恢复类型安全，不改变 SingArea 规划语义。
## 2026-08-25 — 清理生产审计日志并收紧路径断言

- 修改文件：`src/robotics/gizmo-solver.test.ts`、`src/robotics/mechanical-zero-jog-monitor.test.ts`、`src/application/cartesian-control.ts`、`src/rapid/movel-planner.ts`；删除 `src/robotics/joint-path-audit.ts`、`src/robotics/joint-path-audit.test.ts`；修改 `UPDATE_LOG.md`。
- 修改原因：Gizmo 测试允许固定 5% 失败，机械零位测试使用远宽于 5°护栏的断言；生产路径仍输出一次性腕部审计日志。
- 修改内容：恢复 Gizmo 与独立 `solveIK` 基准比较并验收 FK 残差；机械零位测试直接断言全轴和 J4/J6 相邻步长不超过 5°；移除生产审计导入、日志和残留审计模块。
- 修改影响：回归测试对求解退化更敏感；生产路径不再输出研究性审计日志；普通规划行为不变。
## 2026-08-25 — 删除审计参数残留

- 修改文件：`src/application/cartesian-control.ts`、`UPDATE_LOG.md`。
- 修改原因：移除审计日志后，规划结果提交函数仍保留未使用的初始关节参数，触发严格 TypeScript 检查。
- 修改内容：删除参数及两个调用点的冗余实参。
- 修改影响：不改变规划、提交或会话行为，恢复无未使用局部变量的编译状态。

## 2026-08-25 — 完成 FK/IK 与笛卡尔规划 module 重构（本地日志，不提交 Git）

- 修改文件：
  - 通用 model：`src/robotics/model/{joint-pose,robot-model,robot-profile,types}.ts`；
  - 通用 kinematics：`src/robotics/kinematics/{dh-types,legacy-dh-forward-kinematics,numerical-jacobian,transform-matrix}.ts`；
  - inverse kinematics：`src/robotics/inverse-kinematics/{types,waypoint-types,numerical-ik,candidate-catalog,joint-solution,waypoint-solver}.ts`；
  - Cartesian：`src/robotics/cartesian/{index,path-planner,candidate-path-planner,gizmo-target-solver}.ts` 及 `worker/{adapter,worker}.ts`；
  - motion：`src/robotics/motion/{types,runner,smoothing}.ts`；
  - ABB：`src/robot-models/abb-irb1200/{profile,parameters}.ts`、`kinematics/{forward-kinematics,analytic-inverse-kinematics,abb-robot-model-adapter}.ts`；
  - KUKA：`src/robot-models/kuka-like/parameters.ts`、`kinematics/kuka-robot-model-adapter.ts`；
  - 测试随 ownership 迁移至 `robotics/{cartesian,inverse-kinematics,kinematics,motion}` 和 ABB `kinematics/validation`；
  - `src/application/cartesian-types.ts`、`src/rapid/plan-shared.ts`、相关调用方 import。
- 修改原因：`src/robotics` 原先将模型契约、FK/IK、Cartesian 路径、Worker 和运动执行平铺；`ik-waypoint-solver.ts` 同时承担单点 IK、waypoint、Gizmo、诊断和腕部策略；ABB/KUKA 文件命名无法表达厂家 adapter 与 DH convention。
- 修改内容：按 module 能力建立目录并重命名；将 waypoint 编排、单点 joint solution、Gizmo solver 分离；把类型定义归属到 joint-pose、DH、IK、motion 和 application module；KUKA adapter 复用共享 numerical Jacobian；保留 KUKA 历史 DH 与 ABB 标准 DH 两套不同公式，不做错误合并；ABB profile 命名统一为 `profile.ts`。
- 修改影响：不改变 FK/IK 算法、ABB 法兰修正、confdata 选择、SingArea 语义或运动约束；仅改变 module ownership、import seam 和测试 locality，并删除重复 Jacobian implementation。`plan-shared.ts` 增加未知路径失败的保守 unreachable fallback 以满足严格返回类型。
- 验证：`npm run check` 通过；核心 FK/IK、候选目录、Cartesian path、ABB analytic IK 单测通过。
- Git 约束：本条仅写入被 `.gitignore` 忽略的本地 `UPDATE_LOG.md`，该文件不得加入 staged diff 或 commit。
# 2026-08-25

- 文件：`src/robot-models/abb-irb1200/kinematics/configuration.ts`
- 原因：修正接近 0° 象限计算产生 `-0` 的浮点边界结果。
- 影响：ABB `cf1/cf4/cf6` 在零象限统一返回正常的 `+0`，不改变构型判定；`UPDATE_LOG.md` 仅作本地记录，按要求不提交到 Git。

- 文件：`src/robotics/rpi-debug.test.ts`（临时文件，已删除）
- 原因：读取被忽略的 RPI 轨迹，确认第 399 点确实跨越了 `cf1=-1` 到 `cf1=0` 的构型边界。
- 影响：严格构型保持逻辑不放宽；后续测试将把真实构型切换作为明确的失败/边界条件处理；临时文件不提交到 Git。

- 文件：`src/robotics/inverse-kinematics/types.ts`、`src/robotics/inverse-kinematics/numerical-ik.ts`、`src/robot-models/abb-irb1200/validation/real-data-validation.test.ts`
- 原因：RPI 外部执行轨迹在第 399 点真实穿越 `cf1=0`，而生产 IK 默认必须保持参考构型。
- 影响：新增显式 `preserveConfiguration: false` 仅用于外部轨迹重放；默认值仍严格保持构型，无同构型候选时报告失败，不恢复静默构型退回。RPI 轨迹测试明确记录这一测试语义。

- 文件：`src/robot-models/abb-irb1200/validation/real-data-validation.test.ts`
- 原因：修正显式轨迹重放选项的应用范围。
- 影响：单点真实姿态验证继续覆盖默认严格构型保持；只有包含已知 `cf1` 切换的执行轨迹重放和连续性验证显式允许构型切换。

- 文件：`src/robotics/fixture-debug.test.ts`（临时文件）
- 原因：读取现有测试夹具的起点/候选 ABB 构型，定位严格构型保持下的级联失败。
- 影响：仅输出只读诊断，完成后删除；不提交到 Git。

- 文件：`src/robotics/fixture-debug.test.ts`（临时文件）
- 原因：补充打印内置程序声明的来源关节 FK，核对固定四元数是否仍与当前 DH 链一致。
- 影响：仅增加本地诊断输出，完成后随临时文件删除；不提交到 Git。

- 文件：`src/robotics/fixture-debug.test.ts`（临时文件）
- 原因：比较当前 DH 链一致的法兰四元数下，预设点是否仍存在同构型候选。
- 影响：仅增加本地诊断输出，完成后随临时文件删除；不提交到 Git。

- 文件：`src/robotics/fixture-debug.test.ts`（临时文件）
- 原因：验证教学 Home 的 J6 圈数是否与历史示例目标的固定姿态构型一致。
- 影响：仅增加本地诊断输出，完成后随临时文件删除；不提交到 Git。

- 文件：`src/robotics/fixture-debug.test.ts`（临时文件）
- 原因：生成内置 pRest 来源关节对应的 RAPID 四元数，避免手工调整姿态顺序。
- 影响：仅增加本地诊断输出，完成后随临时文件删除；不提交到 Git。

- 文件：`src/application/builtin-program.ts`、`src/rapid/movej-planner.ts`、`src/application/preset-programs.test.ts`、`src/rapid/custom-tool-wobj-motion.test.ts`、`src/rapid/speed-zone-runtime.test.ts`、`src/rapid/program-executor.test.ts`、`src/application/program-control.test.ts`
- 原因：严格构型保持暴露了旧 RAPID 示例四元数顺序和测试起点构型不一致；几何示例另需显式授权构型切换。
- 影响：内置点位姿态改为其来源关节的正确 RAPID 四元数；`planMoveJ` 支持调用方显式传递 IK 配置，预设/工具旋转测试仅显式关闭构型保持，生产默认仍严格；真实执行与程序控制测试起点改为明确的 J6=180° 姿态。

- 文件：`src/robotics/inverse-kinematics/joint-solution.ts`、`src/application/program-control.test.ts`、`src/rapid/program-executor.test.ts`
- 原因：显式 `preserveConfiguration:false` 需要贯穿高层单点求解；真实/fake 程序测试的目标姿态也必须和起点使用同一构型。
- 影响：高层解析 IK 正确接受显式构型放宽；程序控制夹具统一使用 J5=30°、J6=180° 的非奇异起点；真实执行器目标由当前 FK 姿态生成，不再依赖旧的单位四元数。

- 文件：`src/application/program-control.test.ts`、`src/rapid/program-executor.test.ts`
- 原因：内置程序点位和通用 MoveJ 夹具使用的是两套不同的姿态构型，不能共用一个测试起点。
- 影响：分别使用内置程序来源姿态与通用 MoveJ 的 J5=30°、J6=180° 姿态；修正 `internalQuatToRapid` 的测试导入位置；不改变生产运行策略。

- 文件：`src/rapid/program-executor.test.ts`、`src/robotics/fixture-debug.test.ts`（临时文件）
- 原因：修正测试内局部起点变量作用域，并验证通用 MoveJ 夹具是否具有同构型候选。
- 影响：真实执行测试使用局部明确起点；临时诊断仅输出规划结果，完成后删除；不改变生产运行策略。

- 文件：`src/application/program-control.test.ts`
- 原因：通用程序控制夹具使用旧单位姿态，导致严格 IK 必然选择 J4/J6 异构型候选。
- 影响：MoveJ/分支夹具改用当前 DH 链生成的非奇异姿态近似值，并以 J5=30°、J6=0° 同构型起步；边界失败测试保持原始输入与断言。

- 文件：`src/application/program-control.test.ts`
- 原因：即使修正姿态，旧夹具的多个笛卡尔点仍要求不同 J4 构型；这些测试只验证 PP/控制流，不应引入构型切换噪声。
- 影响：通用 MoveJ 与分支源统一使用同一已验证目标点；Modify Position 断言改为对应的新字面量，控制流覆盖保持不变。

- 文件：`src/robotics/fixture-debug.test.ts`（临时文件）
- 原因：核对修正姿态的通用 MoveJ 目标在 J6=0 起点下是否仍受 J4/J6 象限限制。
- 影响：仅增加本地诊断输出，完成后删除；不提交到 Git。

- 文件：`src/robotics/fixture-debug.test.ts`（临时文件）
- 原因：补充打印通用 MoveJ 目标的完整候选构型，确认失败是否来自目标超出同构型而非调用链。
- 影响：仅增加本地诊断输出，完成后删除；不提交到 Git。
## 2026-08-25 — 补齐笛卡尔路径关节限位诊断并删除临时调试测试

- 修改文件：`src/robotics/cartesian/candidate-path-planner.ts`、`src/application/program-control.test.ts`、`src/robotics/fixture-debug.test.ts`、`UPDATE_LOG.md`。
- 修改原因：全局候选图在没有可用候选时只返回 `joint-limit`，缺少 waypoint 和关节上下文；临时 fixture 调试测试不属于产品代码。
- 修改内容：从失败候选构造结构化关节限位诊断；测试断言准确的 `joint-limit` 错误码及非空 waypoint 诊断；删除临时调试文件。
- 修改影响：臂展/限位失败能向上层提供可定位信息；不改变合法路径的候选选择；临时调试代码不再进入工作区。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。

## 2026-08-26 — 清理 Wayfinder 旧规划并收敛唯一运动主线

- 修改文件：`.scratch/wayfinder/map-unified-robot-motion.md`、`.scratch/wayfinder/assets/mechanical-zero-y50-diagnosis.md`、`.scratch/wayfinder/tickets/02-wrist-singularity-in-analytic.md`、`.scratch/wayfinder/tickets/03-lock-ik-routing-contract.md`、`.scratch/wayfinder/tickets/04-define-motion-intent-policy-matrix.md`、`.scratch/wayfinder/tickets/05-define-rapid-configuration-contract.md`、`.scratch/wayfinder/tickets/09-define-cross-entry-conformance-tests.md`、`.scratch/wayfinder/tickets/10-decide-breaking-migration-sequence.md`、`.scratch/wayfinder/tickets/11-capture-robotstudio-zero-y50-reference.md`、`UPDATE_LOG.md`。
- 删除文件：`.scratch/wayfinder/map-ik-refactor.md`、`.scratch/wayfinder/tickets/01-analytic-primary-solver.md`、`.scratch/wayfinder/tickets/07-integrate-wrist-singularity-policy.md`。
- 修改原因：早期 IK 地图和 ticket 01 的 DLS 自动路由结论已被 ticket 03 的严格任务契约取代；ticket 07 与当前腕部实现前沿 ticket 02 重复。保留这些旧方案会造成两条规划主线和相互冲突的腕部语义。
- 修改内容：将 ticket 07 唯一仍有效的统一规划接入要求合并到 ticket 02；修复所有删除文件的引用；把 RobotStudio 连续轨迹状态更新为已采集，并记录半程约 2.04°过程姿态偏离、fine 终点恢复及 J4/J5/J6 路径插补事实；统一 RobotWare 版本标记为 6.16.0.3。
- 修改影响：Wayfinder 只保留统一运动架构、当前腕部实施、RAPID 构型、协调器、验收、迁移和手动 Jog 待采证据，不再保留已被推翻或重复的旧规划；未修改任何生产控制算法。
- Git 约束：`UPDATE_LOG.md` 继续由根目录 `.gitignore` 忽略且未被 Git 跟踪，本记录绝不提交到 Git。

## 2026-08-25 — 锁定统一运动意图与 IK 策略矩阵

- 修改文件：`.scratch/wayfinder/tickets/04-define-motion-intent-policy-matrix.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：当前手动 JOG、Gizmo 与 RAPID 在入口、Worker 和 waypoint 求解器中分别通过可缺省布尔值决定构型与腕部策略，造成生产/测试行为分叉，并让完整位姿路径隐式进入 position-only DLS。
- 修改内容：逐项锁定关节 Jog、笛卡尔 Jog、Gizmo、MoveJ、MoveL、MoveC 与显式退化任务的运动意图、位姿约束、构型、奇异和连续性契约；记录 Worker 丢失 `preserveConfiguration:false`、机械零位自动授权及 wrist DLS 姿态放松等现状证据；关闭 Wayfinder 票据 04。
- 修改影响：后续统一规划接口和 RAPID 配置契约有了不可缺省的领域边界；本次不修改生产控制算法。手动 RobotStudio Jog 的 J4/J6 具体分配仍保留为待采 oracle，不基于 RAPID 结果猜测。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 依据 ABB 官方手册修正 SingArea Wrist 契约

- 修改文件：`.scratch/wayfinder/tickets/03-lock-ik-routing-contract.md`、`.scratch/wayfinder/tickets/04-define-motion-intent-policy-matrix.md`、`.scratch/wayfinder/tickets/11-capture-robotstudio-zero-y50-reference.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：原判断把分段 MoveL 到点后的精确四元数误当成整段连续插补均保持精确；ABB RobotWare 6 官方 RAPID 手册明确说明 `SingArea\Wrist` 使用姿态关节插补，TCP 路径正确但工具姿态在运动过程中会偏离。
- 修改内容：把 `SingArea\Wrist` 从“严格完整 6D IK”修正为“解析构型事实约束下的显式路径级腕部插补”；继续禁止解析失败后隐式 position-only DLS；为 RobotStudio oracle 增加单条 MoveL 内部高频姿态采样要求。
- 修改影响：统一架构开始区分严格位姿 IK 与 ABB 奇异插补，不再用错误的端点证据约束全过程；当前生产算法尚未修改。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 锁定 RAPID 构型监控与 confdata 契约

- 修改文件：`.scratch/wayfinder/tickets/05-define-rapid-configuration-contract.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：当前 RAPID 仅实现 SingArea，拒绝非零 robconf，MoveJ/L/C 又按当前构型布尔筛选，无法表达 ABB 的 ConfJ/ConfL 和目标编程构型语义。
- 修改内容：依据 ABB RobotWare 6 官方手册定义 ConfJ On/Off、ConfL On/Off、SingArea Off/Wrist 对 MoveJ/L/C 的独立作用；明确 confdata 的型号所有权、示教生成、Offs/RelTool 继承和 RobotStudio 多分支验收要求；关闭 Wayfinder 票据 05。
- 修改影响：后续统一规划接口必须携带完整 RAPID 构型策略；当前生产 RAPID 仍未实现 ConfJ/ConfL 和非零 robconf，本次不改变运行行为。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 定义统一运动规划深接口

- 修改文件：`.scratch/wayfinder/tickets/06-design-unified-motion-planner-interface.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：App、Worker、Gizmo 和 RAPID planner 当前直接调用不同层级的 IK/路径函数，并通过缺省 options 产生行为分叉。
- 修改内容：确定 `MotionIntent + RobotStateSnapshot → MotionPlanResult` 的唯一规划入口、意图/计划/失败判别联合、Worker 私有边界、DLS 结果隔离及旧公共 seam 删除清单；关闭 Wayfinder 票据 06。
- 修改影响：后续可围绕一个深模块迁移所有入口，不再保留同步与 Worker 两套策略；本次不修改生产代码。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 锁定运动执行协调权与一致性测试面

- 修改文件：`.scratch/wayfinder/tickets/02-wrist-singularity-in-analytic.md`、`08-define-motion-coordinator-ownership.md`、`09-define-cross-entry-conformance-tests.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：当前 App、CartesianControl、Worker、Gizmo、ProgramController 和 MotionRunner 分别持有停止、代次、追加或提交权；旧腕部 ticket 又错误地把路径插补全部归入解析 IK。
- 修改内容：定义 MotionCoordinator 的唯一控制权、抢占和连续会话规则；建立跨入口/Worker/DLS/RAPID/RobotStudio 验收矩阵；把腕部 ticket 修正为“解析候选 + 独立 ABB 路径插补”并加入连续轨迹前置条件。
- 修改影响：后续迁移可以通过两个深模块 interface 验收并删除浅层旧测试；本次未修改生产算法。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 起草无兼容层运动主线迁移顺序

- 修改文件：`.scratch/wayfinder/tickets/10-decide-breaking-migration-sequence.md`、`UPDATE_LOG.md`。
- 修改原因：统一 Planner/Coordinator 已确定，需要避免用兼容包装形成长期双轨，并保证入口切换期间持续可编译、可验证。
- 修改内容：定义基准冻结、领域核心、Coordinator、一次性入口切换、旧公开面删除、RAPID 构型闭环、腕部插补替换和最终验收八个切片；明确第 4/5 步的删除纪律及 wrist oracle 前禁止补丁。
- 修改影响：实施阶段有了破坏性迁移草案；票据 10 在腕部和最终测试票据关闭前继续保持 open。本次未修改生产代码。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 修正 RobotStudio oracle 技能的 Wrist 证据解释

- 修改文件：`.agents/skills/robotstudio-oracle/references/motion-comparison.md`、`UPDATE_LOG.md`。
- 修改原因：技能参考把 5 mm 分段到点记录误写成 `SingArea\Wrist` 全过程保持四元数，与 ABB RobotWare 6 官方姿态关节插补说明冲突。
- 修改内容：明确端点记录与连续时间轨迹的区别，记录 `SingArea\Wrist` 允许过程姿态偏离，并要求用单条 MoveL 运行期间的 CJointT/CRobT 高频采样验证具体算法。
- 修改影响：后续 RobotStudio 自动对照不会再用端点数据错误否定过程姿态偏离；不改变控制器或生产算法。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 增加 RobotStudio 单条运动外部高频采样能力

- 修改文件：`.agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1`、`.agents/skills/robotstudio-oracle/SKILL.md`、`.scratch/abb-robotstudio-motion-program/log_wrist_trace.mod`、`UPDATE_LOG.md`。
- 修改原因：现有 RAPID 模块只能在 MoveL 返回后记录端点，无法测量 ABB `SingArea\Wrist` 在单条运动内部的工具姿态偏离。
- 修改内容：helper 新增可选 PC SDK 机械单元轮询，按 routine 输出带独立关节/位姿读取时刻的原始 CSV；新增两个从真零出发、各执行一条 Y±50 MoveL 的独立 RAPID routine；技能说明补充采样参数。
- 修改影响：获得授权后可一次自动加载、执行并采集连续轨迹，无需用户手工切换例程；本轮未加载模块、未移动程序指针、未运行控制器。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 保留 RobotStudio 模块加载失败的 CheckProgram 诊断

- 修改文件：`.agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1`、`UPDATE_LOG.md`。
- 修改原因：PC SDK 在带 RAPID 错误的模块已进入任务时仍可能让 `LoadModuleFromFile` 返回 false；helper 过早抛错导致丢失具体语法行号。
- 修改内容：加载后始终先执行 `Task.CheckProgram` 并报告全部错误，再处理无诊断的加载拒绝。
- 修改影响：后续失败能优先定位编译错误，不再被笼统“Controller rejected module”掩盖；不改变成功执行流程。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 修复 WristTrace 与已加载模块的 RAPID 符号冲突

- 修改文件：`.scratch/abb-robotstudio-motion-program/log_wrist_trace.mod`、`.agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1`、`UPDATE_LOG.md`。
- 修改原因：Controller1 同时加载 LogSimPoints 和 WristTrace，两个模块的任务级 `true_zero` 等声明冲突；原 helper 又未输出 ProgramError 行列。
- 修改内容：WristTrace 常量改为 LOCAL 且使用唯一前缀；helper 的 CheckProgram 诊断输出任务、模块、行和列。
- 修改影响：保留原 LogSimPoints 证据模块的同时允许独立 WristTrace 加载；运动尚未启动。
- Git 约束：`UPDATE_LOG.md` 继续由 `.gitignore` 排除，仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 采集 RobotStudio Wrist 单条 MoveL 连续轨迹

- 修改文件：`.scratch/robotstudio-oracle/wrist-trace-20260825/**`、`.agents/skills/robotstudio-oracle/references/motion-comparison.md`、`.scratch/wayfinder/tickets/11-capture-robotstudio-zero-y50-reference.md`、`UPDATE_LOG.md`。
- 修改原因：分段端点数据无法量化 `SingArea\Wrist` 在单条 MoveL 内部的姿态关节插补。
- 修改内容：在 RobotWare 6.16.0.3、IRB1200-5/0.9、tool0/wobj0、真零、v50/fine 下分别执行 Y±50 单条 MoveL，并通过 PC SDK 外部采集关节、TCP、四元数和 confdata。
- 修改影响：确认过程姿态偏差在半程达到约 2.045°并在终点恢复；J4/J6 走向约 -90°/+90°，TCP X/Z 观测漂移低于 0.024 mm。该证据否定冻结 escapePose 的 ABB 等价性假设。
- Git 约束：原始证据位于 `.scratch`；`UPDATE_LOG.md` 继续被忽略，绝不提交到 Git。

## 2026-08-25 — 对比项目 wrist fallback 与 RobotStudio 连续轨迹

- 修改文件：临时 `src/robotics/cartesian/wrist-trace-diagnostic.test.ts` 已创建、运行并删除；`.scratch/wayfinder/tickets/02-wrist-singularity-in-analytic.md`、`07-integrate-wrist-singularity-policy.md`、`UPDATE_LOG.md`。
- 修改原因：需要判断当前 `escapePose + positionOnly DLS` 是否能复现 ABB 的过程姿态曲线，而不是只比较最终可达性。
- 修改内容：从真零分别规划 Y±50，逐 waypoint 计算姿态、TCP 漂移和腕部关节范围，并与同条件 RobotStudio 原始 CSV 对照。
- 修改影响：确认当前实现会在第 1～2 mm 进入约 1.647°偏差并冻结到终点，终点 J4/J6 只有约 ±72.6°，Y-50 还选错腕部侧；RobotStudio 则在半程约 2.045°并在终点恢复。RAPID wrist 实现 ticket 已解除连续轨迹阻塞。
- Git 约束：临时诊断文件已删除；`UPDATE_LOG.md` 继续被忽略，绝不提交到 Git。

## 2026-08-26 — 将 ABB Wrist 原型结论固化为回归测试

- 修改文件：临时 `src/robotics/cartesian/wrist-interpolation-prototype.test.ts` 已删除；新增 `src/robotics/cartesian/abb-wrist-interpolation.test.ts`；`UPDATE_LOG.md`。
- 修改原因：锁定 J4/J5/J6 按路径进度插值的原型与 RobotStudio 连续轨迹高度一致，需要用不依赖 `.scratch` 的确定性测试约束生产实现。
- 修改内容：新增真零 Y±50 回归，断言 TCP 直线、约 2.05°半程姿态峰值、终点姿态恢复、J4/J6 约 -90°/+90°及 J5 方向。
- 修改影响：当前旧 `escapePose` 实现预期先失败；后续实现不得通过放宽容差绕过轨迹形状断言。
- Git 约束：`UPDATE_LOG.md` 继续被忽略，绝不提交到 Git。

## 2026-08-25 — 创建项目本地 RobotStudio Oracle Skill

- 修改文件：`.agents/skills/robotstudio-oracle/SKILL.md`、`.agents/skills/robotstudio-oracle/agents/openai.yaml`、`.agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1`、`.agents/skills/robotstudio-oracle/references/controller-operations.md`、`.agents/skills/robotstudio-oracle/references/motion-comparison.md`、`UPDATE_LOG.md`。
- 修改原因：把本轮已验证的 RobotStudio 虚拟控制器发现、RWS 文件上传、PC SDK 模块加载、RAPID 独立例行程序执行、控制器级错误恢复、事件采集和项目行为对比固化为后续可自动调用的项目能力。
- 修改内容：新增模型可调用的 `robotstudio-oracle` Skill；主流程按只读检查、自动实验、行为对比分支组织；具体 API 陷阱和运动比较规则按需披露；PowerShell helper 支持 Inspect、RunRoutines、Download，并以唯一虚拟控制器、显式 mutation 开关和最终状态检查约束外部操作。
- 修改影响：以后用户提出 RobotStudio 验证、ABB 控制器黑盒采集或仿真行为对比时，代理可直接复用确定性流程，无需用户手动寻找例行程序或设置程序指针；普通仓库测试不会误触发该 Skill。
- 验证：`Inspect` 已在 Controller1 上只读前向测试通过，自动发现 RWS 38688、RobotWare 6.16.0.3、T_ROB1 与当前模块集。
- Git 约束：`UPDATE_LOG.md` 继续保持 Git 忽略；项目本地 Skill 作为明确交付文件保留在工作区，不执行 Git 提交。

## 2026-08-25 — 锁定解析 IK 与 DLS 路由契约

- 修改文件：`.scratch/wayfinder/tickets/03-lock-ik-routing-contract.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`.scratch/wayfinder/assets/mechanical-zero-y50-diagnosis.md`、`.scratch/wayfinder/tickets/11-capture-robotstudio-zero-y50-reference.md`、`UPDATE_LOG.md`。
- 修改原因：RobotWare 6.16.3007 的全零 Y±50 黑盒矩阵已完整覆盖 RAPID WRIST、FREE 与 STRICT 策略，足以判定完整位姿和腕部奇异场景的算法边界。
- 修改内容：关闭路由契约决策票；规定 ABB 完整位姿和显式 `SingArea\Wrist` 均使用解析候选，奇异区采用保持完整姿态的 J4/J6 耦合等价表示；DLS 仅用于显式退化任务，禁止解析失败自动 fallback 和伪造 robconf。
- 修改影响：后续统一 Jog/RAPID 架构不得用姿态放松 DLS 模拟 ABB 腕部奇异行为，当前普通 5° 单轴步长护栏必须改为识别奇异等价表示的连续性策略。
- Git 约束：Wayfinder 资产和 `UPDATE_LOG.md` 均保持 Git 忽略，绝不提交。

### 独立例行程序启动检查修正

- 修改文件：`.scratch/abb-robotstudio-motion-program/run_zero_y50_capture.ps1`、`UPDATE_LOG.md`。
- 修改原因：控制器级启动返回 `IllegalEntryPoint`，因为 `StartCheck.CallChain` 仅允许从 main 调用链入口启动，与“程序指针移至独立例行程序”的实验方式冲突。
- 修改内容：将启动检查改为 ABB PC SDK 的 `StartCheck.None`，与 RobotStudio 手工从指定例行程序启动的语义一致。
- 修改影响：允许自动执行 `FreeYMinus`、`StrictYPlus`、`StrictYMinus` 这些无参数独立入口，不改变其运动策略。
- Git 约束：相关文件保持 Git 忽略，绝不提交。

### 自动采集器改用控制器级 RAPID 启动

- 修改文件：`.scratch/abb-robotstudio-motion-program/run_zero_y50_capture.ps1`、`UPDATE_LOG.md`。
- 修改原因：在有效 mastership 内调用 `Task.Start` 仍被唯一主运动任务以 10021 拒绝；该系统应由控制器级 RAPID 执行服务启动。
- 修改内容：保留 T_ROB1 的程序指针设置，将启动调用切换为 `Controller.Rapid.Start`。
- 修改影响：启动语义与 RobotStudio“启动全部已启用 RAPID 任务”的按钮一致，仍只执行 T_ROB1 当前指向的独立测试入口。
- Git 约束：相关文件保持 Git 忽略，绝不提交。

### 自动采集器 RAPID mastership 修正

- 修改文件：`.scratch/abb-robotstudio-motion-program/run_zero_y50_capture.ps1`、`UPDATE_LOG.md`。
- 修改原因：首轮自动化已成功加载模块和设置三个程序指针，但 `Start` 在 mastership 释放后调用，控制器以事件 10021 拒绝远程启动。
- 修改内容：将每次 `Task.Start` 纳入 RAPID mastership；仅在返回 `StartResult.Ok` 后等待执行停止，其他结果立即记录为 `StartRejected`。
- 修改影响：远程启动与 ABB PC SDK 的资源所有权契约一致，并消除启动拒绝时每项无意义等待 30 秒的问题。
- Git 约束：相关文件保持 Git 忽略，绝不提交。

### 自动采集器改用官方 RWS 文件上传

- 修改文件：`.scratch/abb-robotstudio-motion-program/run_zero_y50_capture.ps1`、`UPDATE_LOG.md`。
- 修改原因：当前 RobotWare 6.16 PC SDK 的 `FileSystem.PutFile` 返回无细节泛化异常；官方 RWS 文件服务已确认可访问。
- 修改内容：按 ABB 官方文档改用 Digest 认证的 `PUT /fileservice/$home/log_sim_points.mod` 上传模块，再由 PC SDK 从 `HOME:/log_sim_points.mod` 加载。
- 修改影响：绕过 PC SDK 文件上传兼容问题，同时保留 PC SDK 的 mastership、程序检查、程序指针和执行控制能力。
- Git 约束：相关文件保持 Git 忽略，绝不提交。

### 自动采集器控制器路径修正

- 修改文件：`.scratch/abb-robotstudio-motion-program/run_zero_y50_capture.ps1`、`UPDATE_LOG.md`。
- 修改原因：ABB PC SDK 的 `Task.LoadModuleFromFile` 只读取控制器文件系统路径，直接传 Windows 本地路径导致 C004A00C。
- 修改内容：删除模块前先通过 `Controller.FileSystem.PutFile` 将最新版上传到 `HOME:/log_sim_points.mod`，随后从该控制器路径加载。
- 修改影响：确保替换动作拥有控制器侧源文件，当前停止状态下缺失的 `LogSimPoints` 可自动恢复后继续采集。
- Git 约束：相关文件保持 Git 忽略，绝不提交。

### 自动采集器加载方式修正

- 修改文件：`.scratch/abb-robotstudio-motion-program/run_zero_y50_capture.ps1`、`UPDATE_LOG.md`。
- 修改原因：ABB PC SDK 对当前同名模块使用 `RapidLoadMode.Replace` 返回 C0049003“模块名歧义”。
- 修改内容：在 RAPID mastership 下验证 `LogSimPoints` 唯一性，明确删除旧模块后以 `Add` 模式加载最新版，并再次验证加载后模块唯一且程序检查无错误。
- 修改影响：避免 SDK 同名替换歧义，作用域仍严格限制在 T_ROB1 的唯一 `LogSimPoints` 模块。
- Git 约束：相关文件保持 Git 忽略，绝不提交。

## 2026-08-25 — 增加 RobotStudio 零手工自动采集器

- 修改文件：`.scratch/abb-robotstudio-motion-program/run_zero_y50_capture.ps1`、`.scratch/abb-robotstudio-motion-program/README.md`、`UPDATE_LOG.md`。
- 修改原因：用户只会启动程序，控制器级 50026 又无法由同一 RAPID 任务的普通错误处理器恢复，需要在任务外自动完成模块加载、程序指针复位和逐例行程序执行。
- 修改内容：基于本机 ABB PC SDK 增加自动采集脚本；严格限定唯一的虚拟 `Controller1` 和 T_ROB1，自动替换并检查 `LogSimPoints`，默认依次运行 `FreeYMinus`、`StrictYPlus`、`StrictYMinus`，每次停止后自行复位，并输出执行清单 JSON。
- 修改影响：剩余控制器拒绝实验无需用户在 RobotStudio 中查找或设置例行程序；脚本不连接真机、不启动项目开发服务。
- Git 约束：自动采集器、执行清单和 `UPDATE_LOG.md` 均位于 Git 忽略范围，绝不提交。

## 2026-08-25 — 适配 RobotStudio 奇异错误的独立采集入口

- 修改文件：`.scratch/abb-robotstudio-motion-program/log_sim_points.mod`、`.scratch/abb-robotstudio-motion-program/README.md`、`.scratch/wayfinder/assets/mechanical-zero-y50-diagnosis.md`、`.scratch/wayfinder/tickets/11-capture-robotstudio-zero-y50-reference.md`、`UPDATE_LOG.md`。
- 修改原因：全零实测中 WRIST Y±50 完整成功，但 FREE Y+50 触发控制器级 50026 并直接进入执行错误状态，普通 RAPID `ERROR/TRYNEXT` 无法跨越该停止，导致单次 main 无法继续后续策略。
- 修改内容：默认 `main` 仅采集可连续完成的 WRIST 两方向；新增 `WristYPlus/WristYMinus/FreeYPlus/FreeYMinus/StrictYPlus/StrictYMinus` 六个无参数独立入口；记录 WRIST 的 J4/J6 ±90° 奇异耦合分配和 FREE Y+50 的控制器拒绝证据。
- 修改影响：失败策略可在程序指针复位后逐方向采集，互不覆盖；诊断结论从“可能需要姿态放松”修正为“RobotStudio 能保持目标姿态，项目缺口是腕部奇异自由度的分支规范化与连续性度量”。
- Git 约束：所有本次资产均位于 Git 忽略范围，绝不提交。

## 2026-08-25 — 完善 RobotStudio 全零 Y±50 黑盒采集模块

- 修改文件：`.scratch/abb-robotstudio-motion-program/log_sim_points.mod`、`.scratch/abb-robotstudio-motion-program/README.md`、`UPDATE_LOG.md`。
- 修改原因：原密集日志虽可完整运行，但笛卡尔扫描从 J5=30° 开始，未覆盖用户关注的真正全零腕部奇异场景；同时缺少策略、目标、构型和错误信息，且状态读取存在控制周期滞后。
- 修改内容：将采集模块收敛为真正全零 Y±50 专用 oracle；分别采集 `ConfL\On + SingArea\Wrist`、`ConfL\Off + SingArea\Off`、`ConfL\On + SingArea\Off` 三种策略及两个方向；每个方向先做单条 MoveL 端点探测，成功后再做 5 mm 分段采样；增加实验相对时间、0.20 秒稳定等待、指令目标、J1～J6、TCP、六位四元数、confdata、结果和 ERRNO，并为六项实验使用独立文件。
- 修改影响：新日志可直接区分解析构型保持、关闭构型检查和 ABB 腕部奇异策略，为项目中解析 IK 与局部数值策略的路由契约提供可重复的 RobotWare 6.16.3007 黑盒证据；旧的混合 `sim_log_dense.csv` 不再是该模块的输出契约。
- Git 约束：`UPDATE_LOG.md` 和 `.scratch` 采集资产均保持 Git 忽略，绝不提交。

## 2026-08-25 — 修复 RobotStudio 密集采集模块的 RAPID 语法错误

- 修改文件：`.scratch/abb-robotstudio-motion-program/log_sim_points.mod`、`UPDATE_LOG.md`。
- 修改原因：RobotWare 6.16.3007 将 `step` 解析为 RAPID 保留字，导致局部变量声明及 Y/Z 扫描循环出现 5 处语法错误 137，程序指针无法设置。
- 修改内容：将局部位移循环变量 `step` 统一更名为语义明确的 `offset_mm`，同步更新两处 `FOR` 循环和目标坐标计算引用；未改变扫描范围、步长、速度或运动指令。
- 修改影响：采集模块可重新通过 RAPID 语法检查并继续生成原设计的关节空间及笛卡尔扫描数据；真正全零 Y±50 的实验语义仍将在下一阶段单独调整。
- Git 约束：`UPDATE_LOG.md` 与 `.scratch` 采集材料均为本地诊断资产，绝不提交到 Git。

### 阶段记录：审查 RAPID 与手动 Jog 控制主线

- 修改文件：无生产代码修改；仅更新 `UPDATE_LOG.md`。
- 诊断原因：核查 RAPID、关节 Jog、笛卡尔 Jog 与末端 Gizmo 是否经过统一的运动规划和执行主线，以及当前可达性策略为何容易发生入口间漂移。
- 诊断结论：所有入口最终共享同一个 `MotionRunner` 和同一份关节状态，但规划层没有统一的运动命令与规划结果 seam。关节 Jog、笛卡尔 Jog、Gizmo、RAPID MoveJ、MoveL、MoveC 分别选择 `startSpeedLimited/startEased`、`planCartesianTarget`、`planStrictCandidateGraph`、`resolveJointSolution`、`planCartesianPath`、`solvePoseWaypoints`；构型保持、腕部回退、步长限制、时长和取消策略由不同调用者分别决定。
- 诊断影响：当前结构属于“底层执行统一、上层规划与策略分裂”，不是两套完全独立的运动内核；但决定用户可达性和行为一致性的主线确实缺失。App 还承担程序抢占、Worker 取消与运动模式切换，导致控制权规则散落在入口调用处。
- Git 约束：本文件仅作本地审查记录，绝不提交到 Git。

### 阶段记录：复核 IK 调研报告与当前解析/DLS 路由

- 修改文件：无生产代码修改；仅更新 `UPDATE_LOG.md`。
- 诊断原因：核对三份 ABB IRB1200 IK 调研报告是否主张弃用纯 DLS 主解，以及当前实现是否真正采用解析方案为主。
- 诊断结论：报告一致主张 ABB IRB1200 完整 6D 位姿 IK 以球形腕解析解为主，纯 DLS 不适合作为主解；8 月 25 日补充报告进一步限定 DLS 只用于无解析模型、position-only、锁定关节等退化任务。当前 `solveIK` 在 `solveAllIK` 可用且为完整 6D 任务时直接返回解析结论，解析失败不回退 DLS；腕部逃逸则由解析候选确定分支，仅用 position-only DLS 做局部位置精化。
- 验证结果：解析 IK、数值兜底、腕部奇异和真实数据验证共 4 个测试文件、35 项测试全部通过；RPI 真实执行轨迹 466 点 IK 成功率 100%，最大关节误差 0.0000°。
- 诊断影响：确认算法主路由符合后期调研结论；当前自由移动退化不能归因于“仍以 DLS 为主”，应继续归因于上层构型保持、候选筛选与入口策略分裂。
- Git 约束：本文件仅作本地审查记录，绝不提交到 Git。

### 阶段记录：启动统一运动主线 Wayfinder

- 修改文件：无生产代码修改；仅更新 `UPDATE_LOG.md`。
- 规划原因：用户要求综合 IK 调研报告、当前代码与旧版自由移动行为，决定 ABB 逆解方法、架构和 Jog/RAPID 统一主线。
- 当前进展：已读取 Wayfinder、Grilling、Domain Modeling 指令并加载现有“ABB IRB 1200 逆运动学流程重构”地图。现有地图只覆盖解析 IK 与腕部奇异，尚未覆盖运动意图、构型语义、统一规划结果和执行控制权。
- 暂停原因：Wayfinder 要求由用户决定产品语义，不能由代理代答；当前 frontier 是 RAPID 真实语义与手动自由移动的优先关系、手动笛卡尔跨构型规则、以及本地图的最终交付范围。
- Git 约束：本文件仅作本地规划记录，绝不提交到 Git。

### 阶段记录：建立统一 ABB 逆解与运动控制主线地图

- 修改文件：`CONTEXT.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`.scratch/wayfinder/tickets/03-lock-ik-routing-contract.md` 至 `10-decide-breaking-migration-sequence.md`、`UPDATE_LOG.md`。
- 修改原因：用户确认手动自由移动与 RAPID 严格语义应通过显式策略共用同一规划主线，并特别要求解析法与 DLS 的使用范围不可混乱。
- 修改内容：补充“运动意图、完整位姿逆解、退化逆解、构型策略、运动计划”领域词汇；创建上层 Wayfinder 地图；创建解析/DLS 路由、策略矩阵、RAPID 构型、统一规划接口、腕部奇异、执行协调、一致性测试和破坏性迁移顺序八张决策 ticket；建立阻塞关系。
- 修改影响：规划 frontier 仅包含“锁定解析 IK 与 DLS 的唯一任务路由契约”和“定义运动意图与构型策略矩阵”；尚未实施任何 IK、路径规划或执行行为变更。
- 验证结果：地图与八张 ticket 的 Markdown 链接全部有效，阻塞图 frontier 与预期一致。
- Git 约束：`.scratch` 地图与 `UPDATE_LOG.md` 仅作本地规划记录，绝不提交到 Git；`CONTEXT.md` 是领域词汇变更，应随后续正式架构变更统一审查是否提交。

### 阶段记录：认领解析 IK 与 DLS 路由契约决策

- 修改文件：`.scratch/wayfinder/tickets/03-lock-ik-routing-contract.md`、`UPDATE_LOG.md`。
- 修改原因：继续推进统一运动主线地图的首张 frontier ticket，优先消除解析法与 DLS 被可选布尔值和调用方默认值混用的风险。
- 修改内容：将“锁定解析 IK 与 DLS 的唯一任务路由契约”认领给 Codex；核对当前 `positionOnly`、`lockedJointTargetsDeg`、`preserveConfiguration`、`allowWristFallback` 与腕部 position-only 精化的全部入口，准备 HITL 决策轮。
- 修改影响：尚未形成或实施算法变更；ticket 保持 open，等待用户确认完整位姿、退化任务和腕部局部精化的最终契约。
- Git 约束：Wayfinder ticket 与本文件仅作本地规划记录，绝不提交到 Git。

### 阶段记录：定位全零点 Y±50 与 RobotStudio 兼容性缺口

- 修改文件：无生产代码修改；临时诊断 `.scratch/mechanical-zero-y50-compatibility.test.ts` 已创建、运行并删除；新增 `.scratch/wayfinder/assets/mechanical-zero-y50-diagnosis.md`、`.scratch/wayfinder/tickets/11-capture-robotstudio-zero-y50-reference.md`；更新当前路由契约 ticket 与 `UPDATE_LOG.md`。
- 诊断原因：用户明确最终目标是 Jog/RAPID 与真实 ABB/RobotStudio 的姿态和运动行为一致，并给出全零点 Y±50 在 RobotStudio/旧版可动、当前版无解的黑盒样例。
- 诊断结论：当前代码把 ABB 机械/同步零位从 `[0,0,0,0,0,0]` 改成 `[0,0,0,0,30,0]`，导致真实全零点失去腕部奇异策略资格；现有“机械零位”测试也从 J5=30° 开始，未覆盖用户场景。当前入口 Y±50 均因首 waypoint J4 约 ±90° 跳变返回 `joint-step`；显式授权腕部策略后可连续运动，但最终姿态偏差约 1.65°，尚不能证明与 RobotStudio 一致。
- 历史定位：行为变化来自 `c8c653c`，该目录重构提交同时修改了机械零位领域事实。
- 规划影响：新增“采集 RobotStudio 全零点 Y±50 控制器基准”任务，并将“锁定解析 IK 与 DLS 的唯一任务路由契约”挂在该基准之后；在获得控制器 J1～J6/TCP 轨迹前，不拍板奇异点处应使用纯解析耦合还是显式姿态放松精化。
- Git 约束：诊断 asset、任务 ticket 与本文件仅作本地记录，绝不提交到 Git。

## 2026-08-25 — 拆出 RAPID parser 的标量与控制流实现

- 修改文件：`src/rapid/language/parser/rapid-parser.ts`、`src/rapid/language/parser/scalar-expression.ts`、`src/rapid/language/parser/control-flow.ts`、`src/rapid/language/parser/pending-types.ts`、`UPDATE_LOG.md`。
- 修改原因：主解析器同时承载标量表达式、待解析状态类型和控制流展平，内部职责过于集中，影响后续维护和定位问题。
- 修改内容：将标量表达式解析、待解析状态类型和控制流语句展平分别提取到 parser 内部模块；通过共享解析上下文和 `resolveLeaf` 接缝复用原有符号表、诊断、程序输出与行号状态，不复制解析器状态。
- 修改影响：解析行为和 AST 输出保持不变；parser 主文件职责收窄，控制流、表达式和状态类型可以独立审查；`UPDATE_LOG.md` 仅保留在本地，绝不提交到 Git。
- 验证结果：`npm run check`、`npm run test`（66 个测试文件、583 个测试）、`npm run lint`、`npm run build` 全部通过。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。

### 阶段记录：完成第一阶段目录移动与导入修正

- 修改文件：`src/rapid/data/**`、`src/rapid/language/**`、`src/rapid/planning/**`、`src/rapid/execution/**`、`src/rapid/editing/**`、`src/rapid/editor/**`、`src/rapid/integration/**` 及受影响的 `src` 导入文件。
- 修改原因：让 RAPID 数据、语言解析、运动规划、执行、编辑和编辑器高亮拥有明确目录接缝。
- 修改内容：移动生产文件和对应测试，重命名 `arc-planner.ts` 为 `arc-geometry.ts`，修正绝对与相对导入路径。
- 修改影响：`npm run check` 已通过；本阶段只改变文件组织和导入位置，不改变运行逻辑。

### 阶段记录：拆出 RAPID Pose 转换与规划输入模块

- 修改文件：`src/rapid/data/pose-transform.ts`、`src/rapid/data/coordinate-transform.ts`、`src/rapid/data/target-expression.ts`、`src/rapid/planning/motion-input.ts`、相关规划/执行/编辑测试及导入文件。
- 修改原因：原 `plan-shared.ts` 同时承载 RAPID 四元数转换、robtarget 转 Pose、输入校验、错误映射和时长估算，接口过宽且数据转换反向依赖规划模块。
- 修改内容：新增 `data/pose-transform.ts` 承载 RAPID 与内部 Pose 的转换，将 `plan-shared.ts` 重命名为 `planning/motion-input.ts`，并修正所有调用方。
- 修改影响：规划模块只依赖运动输入校验与错误模型；数据模块不再依赖规划实现；`npm run check` 已通过，运动行为保持不变。

### 阶段记录：整理 Cartesian waypoint 解算并消除 robotics 反向依赖

- 修改文件：`src/robotics/cartesian/solution/**`、`src/robotics/cartesian/step-policy.ts`、Cartesian/IK 索引与规划文件、MoveJ 导入及相关测试。
- 修改原因：waypoint 连续性、腕部奇异处理和关节候选选择属于 Cartesian 路径实现，却放在 inverse-kinematics 目录，并反向引用 Cartesian 候选图的步长常量。
- 修改内容：将 `joint-solution.ts`、`waypoint-solver.ts`、`waypoint-types.ts` 移到 `cartesian/solution`；抽出共享步长策略；让单点 IK 索引只公开数值/候选解算，Cartesian 索引公开路径连续解算。
- 修改影响：FK、解析 IK、数值 IK 算法不变；Cartesian 与单点 IK 的依赖方向更清晰；`npm run check` 已通过。

### 阶段记录：拆分 RAPID 数据类型并建立模块公开接缝

- 修改文件：`src/rapid/data/records.ts`、`instruction-types.ts`、`system-data.ts`、`index.ts`、相关调用方；`src/rapid/language/index.ts`、`planning/index.ts`、`execution/index.ts`、`editing/index.ts`；`src/rapid/data/pose-transform.test.ts`。
- 修改原因：原 `rapid-types.ts` 同时暴露厂家记录、系统默认数据和执行指令，属于浅而宽的万能模块；外部代码也直接穿透 parser、planner、executor 的实现文件。
- 修改内容：拆出记录、指令、系统数据实现，新增数据/语言/规划/执行/编辑公开接缝，并将应用层导入改为从接缝使用。
- 修改影响：减少调用方对内部文件名和实现布局的依赖；`npm run check` 已通过，运行逻辑保持不变。

### 阶段记录：统一机器人核心与型号模块公开入口

- 修改文件：`src/robotics/model/index.ts`、删除 `src/robotics/model/types.ts`、`src/robot-models/abb-irb1200/index.ts`、`src/robot-models/kuka-like/index.ts` 及相关导入文件。
- 修改原因：`model/types.ts` 只是两行浅转发；应用层和测试层直接穿透机器人型号内部参数、适配器和 FK 文件，导致实现布局成为调用方接口的一部分。
- 修改内容：以 `model/index.ts` 统一导出核心模型类型；为 ABB IRB1200 和 KUKA-like 增加型号级公开接缝；调用方改从型号入口导入。
- 修改影响：删除无独立行为的 `model/types.ts`，不删除或改写 KUKA 实现；`npm run check` 已通过。

### 阶段记录：拆分 RAPID parser 与受控编辑的内部实现

- 修改文件：`src/rapid/language/parser/**`、`src/rapid/language/parser/rapid-parser.ts`、`scalar-expression.ts`、`pending-types.ts`、`src/rapid/editing/types.ts`、`formatting.ts`、`controlled-rapid-edit.ts` 及相关测试。
- 修改原因：主 parser 原本把标量表达式解析、类型检查和所有 pending 语句类型混在编排实现中；受控编辑也把命令类型、文本格式化和源码替换集中在同一文件。
- 修改内容：建立 parser 内部目录，抽出标量表达式模块和 pending 语句模型；抽出编辑命令类型与 robtarget 格式化模块；外部仍从 `language/index.ts` 和 `editing/index.ts` 使用同一次解析/编辑结果。
- 修改影响：没有建立平行 parser，也没有改变解析结果和编辑范围语义；主实现的职责更集中；`npm run check` 已通过。

## 2026-08-25 — 修正臂展失败回归的错误码断言

- 修改文件：`src/application/program-control.test.ts`、`UPDATE_LOG.md`。
- 修改原因：实现已确认该目标先触发关节软限位，而不是相邻关节步长限制。
- 修改内容：将回归测试错误码改为 `joint-limit`，保留诊断非空和 waypoint 索引断言。
- 修改影响：测试与规划器实际错误语义一致，避免用错误码掩盖真实失败原因。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 收窄模型类型出口并消除跨域类型转发

- 修改文件：`src/robotics/model/types.ts`、`src/application/motion-control.ts`、`src/robotics/inverse-kinematics/candidate-catalog.ts`、`UPDATE_LOG.md`。
- 修改原因：模型类型总出口曾同时转发运动学、逆解和运动控制类型，形成跨域 barrel，复审指出其会模糊模块所有权。
- 修改内容：模型出口仅保留关节/位姿值对象；`MotionConfig` 改从运动控制模块直接导入；逆解候选目录注释改为型号无关表述。
- 修改影响：类型依赖边界与文件目录一致，运行时行为不变。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 让 Cartesian 候选图默认保持型号构型

- 修改文件：`src/robotics/cartesian/candidate-path-planner.ts`、`src/robotics/cartesian/gizmo-target-solver.ts`、`src/robotics/inverse-kinematics/waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：复审发现 MoveL/MoveC 与 Gizmo 的全局候选图此前会在同构型候选不存在时直接选异构型候选，绕过 ABB 未启用 SingArea 时的构型保持语义。
- 修改内容：候选图默认按起始关节推导的型号构型过滤；仅在 `preserveConfiguration=false` 时允许外部轨迹重放跨构型；Gizmo 和 waypoint 求解器统一传递该策略。
- 修改影响：普通笛卡尔规划不再静默切换构型；明确关闭构型保持时仍可重放跨构型轨迹；无构型能力的通用模型行为不变。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。

## 2026-08-25 — 修正构型保持选项的空值类型

- 修改文件：`src/robotics/cartesian/candidate-path-planner.ts`、`UPDATE_LOG.md`。
- 修改原因：型号适配器的构型推导允许返回 `null`，严格 TypeScript 检查要求将其归一为“未提供构型”。
- 修改内容：将 `null` 统一转换为 `undefined` 后参与候选过滤。
- 修改影响：消除编译错误；无构型信息的模型仍保持原有通用候选行为。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 回退会误伤 Cartesian 边界点动的过度构型过滤

- 修改文件：`src/robotics/cartesian/candidate-path-planner.ts`、`src/robotics/cartesian/gizmo-target-solver.ts`、`src/robotics/inverse-kinematics/waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：实际回归证明全局 Cartesian 候选图锁定起始构型会把 J1=0° 两侧的合法毫米级点动误报为不可达，破坏既有严格姿态路径行为。
- 修改内容：撤销候选图的全局构型过滤；构型保持继续由 `selectBestIKCandidate`/单目标 IK 入口严格执行，无同构型候选直接失败，不再静默退回全局候选。
- 修改影响：恢复 Cartesian/Gizmo 的整层连续性规划；保留 MoveJ 与单目标 IK 的真实构型语义。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 格式化本次重构涉及的新增与修改代码

- 修改文件：本次重构中 Prettier 报告格式问题的 15 个 TypeScript/Vue 文件、`UPDATE_LOG.md`。
- 修改原因：局部格式检查发现这些变更文件存在格式化差异；全仓仍有与本次无关的既有格式告警。
- 修改内容：仅对本次变更涉及且被局部检查标记的文件执行 Prettier，不格式化未修改文件。
- 修改影响：统一本次提交代码风格，不改变运行逻辑。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 修复 Vue 多语句事件属性的格式化副作用

- 修改文件：`src/App.vue`、`UPDATE_LOG.md`。
- 修改原因：Prettier 将 Vue 模板中的多语句事件属性拆成换行表达式，Vue 编译器不接受该属性语法。
- 修改内容：恢复 `@run`/`@step` 的分号分隔单行表达式；保留本次 Cartesian facade 导入调整。
- 修改影响：恢复 SFC 编译与生产构建，不改变事件执行顺序或业务行为。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 修正 Cartesian 候选图构型保持与 ABB 象限边界

- 修改文件：`src/robot-models/abb-irb1200/kinematics/configuration.ts`、`src/robotics/cartesian/candidate-path-planner.ts`、`src/robotics/cartesian/path-planner.ts`、`src/robotics/cartesian/index.ts`、`src/robotics/cartesian/gizmo-target-solver.ts`、`src/robotics/inverse-kinematics/waypoint-solver.ts`、`UPDATE_LOG.md`。
- 修改原因：独立 Spec 复审发现 Cartesian 候选图未按起始型号构型过滤，且 confdata 象限计算把接近 ±90° 的真实角度错误吸附到边界。
- 修改内容：MoveL/MoveC/Gizmo/手动 Cartesian 默认保持起始构型；仅显式 `preserveConfiguration=false` 的外部轨迹重放允许跨构型；ABB 象限只对 0° 浮点噪声做吸附，不再吸附 90°/180°边界。
- 修改影响：未声明构型切换时不再静默执行异构型路径；多圈关节接近 90°边界时 confdata 标签按实际角度计算。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 区分手动 Jog 与 RAPID 路径的构型策略

- 修改文件：`src/robotics/cartesian/candidate-path-planner.ts`、`src/application/cartesian-control.ts`、`UPDATE_LOG.md`。
- 修改原因：严格构型过滤后，候选图在“几何可达但只有异构型候选”时不能误报关节限位；手动 Jog 是操作者明确发起的再定位，不应被 RAPID 未声明 SingArea 的规则误伤。
- 修改内容：构型不匹配时返回不可达而非 joint-limit；手动 Cartesian Jog 显式传 `preserveConfiguration=false`，MoveL/MoveC/Gizmo 默认保持构型。
- 修改影响：错误诊断准确；手动 Jog 可跨 confdata 象限，程序化 RAPID 路径仍禁止静默构型切换。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 增加路径构型保持与象限边界回归测试

- 修改文件：`src/robot-models/abb-irb1200/kinematics/analytic-inverse-kinematics.test.ts`、`src/robotics/cartesian/path-planner.test.ts`、相关 Cartesian/MoveC/MoveL/Gizmo 测试、`UPDATE_LOG.md`。
- 修改原因：构型策略改为显式区分严格程序路径与手动/几何轨迹测试后，需要覆盖 90°附近真实边界和“异构型不静默执行”的契约。
- 修改内容：补充正负 90°边界 epsilon 测试；为几何连续性测试显式关闭构型保持；新增严格 Cartesian 构型不匹配失败回归；MoveC/MoveL 测试改用稳定构型起点。
- 修改影响：测试不再把几何轨迹重放误当作 RAPID 构型语义；关键安全契约由测试直接锁定。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 将 MoveC 回归起点移出 confdata 象限边界

- 修改文件：`src/rapid/movec-planner.test.ts`、`UPDATE_LOG.md`。
- 修改原因：严格构型保持后，MoveC 圆弧从 J1/J4/J6 恰在 0° 的测试起点出发，会在第一段跨越 confdata 象限边界，无法证明圆弧规划本身的连续性。
- 修改内容：测试起点改为远离 0°/90°边界的合法关节姿态，目标位姿仍由同一模型 FK 推导。
- 修改影响：回归测试验证真实同构型 MoveC 圆弧，不再把构型边界失败误当作圆弧算法失败。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 临时输出 MoveC 严格构型失败上下文

- 修改文件：`src/rapid/movec-planner.test.ts`、`UPDATE_LOG.md`。
- 修改原因：更换稳定起点后 MoveC 仍失败，需要读取规划器返回的结构化错误以定位是圆弧几何还是构型筛选。
- 修改内容：在单个回归测试中临时打印 `planMoveC` 结果；定位完成后立即删除。
- 修改影响：仅影响一次测试输出，不改变产品逻辑。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 临时检查 MoveC 首个 waypoint 的构型候选

- 修改文件：`src/rapid/movec-planner.test.ts`、`UPDATE_LOG.md`。
- 修改原因：单次 MoveC 失败仍只有上层 unreachable，需要确认首个圆弧 waypoint 是否存在同构型解析候选。
- 修改内容：临时枚举首个 waypoint 的候选构型和残差；定位完成后立即删除。
- 修改影响：仅影响一次测试输出，不改变产品逻辑。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 缩小 MoveC 构型保持回归弧段

- 修改文件：`src/rapid/movec-planner.test.ts`、`UPDATE_LOG.md`。
- 修改原因：原圆弧幅度在解析腕部候选之间产生额外构型分支，无法稳定验证构型保持而掩盖了规划器行为。
- 修改内容：将测试圆弧收敛到同一构型的 5 mm 级小弧段，仍保留起点/圆点/终点和连续 waypoint 验证。
- 修改影响：回归稳定覆盖同构型 MoveC 连续性，不放宽生产构型策略。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 删除 MoveC 临时构型诊断输出

- 修改文件：`src/rapid/movec-planner.test.ts`、`UPDATE_LOG.md`。
- 修改原因：MoveC 稳定回归弧段已确认可在同一构型内完成，临时 console 输出和候选枚举不应留在测试代码。
- 修改内容：删除临时调试导入、日志和候选枚举代码；保留稳定起点与小弧段回归。
- 修改影响：测试输出恢复干净，不改变 MoveC 规划行为。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 让几何回归显式关闭构型保持并修正稳定起点

- 修改文件：`src/rapid/movel-planner.ts`、`src/rapid/movec-planner.ts`、`src/application/preset-programs.test.ts`、`src/robotics/inverse-kinematics/numerical-ik.test.ts`、`src/rapid/program-executor.test.ts`、`src/application/program-control.test.ts`、`UPDATE_LOG.md`。
- 修改原因：严格路径默认构型保持后，旧几何预设和跨象限测试数据不能代表真实 RAPID 构型语义；程序失败回归的 1500 mm 目标实际是同构型不可达，不是关节限位。
- 修改内容：MoveL/MoveC 增加仅供外部几何回放测试使用的 `preserveConfiguration` 选项；预设/纯几何 IK 测试显式关闭；真实执行测试改用远离象限边界的起点；错误码断言改为 unreachable。
- 修改影响：生产 RAPID 默认严格保持构型；旧几何数据仍可通过显式选项验证几何可达性；错误诊断与实际规划原因一致。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 修正 ProgramExecutor 的严格构型运动夹具

- 修改文件：`src/rapid/program-executor.test.ts`、`UPDATE_LOG.md`。
- 修改原因：严格构型保持接入后，ProgramExecutor 测试仍用旧的跨象限笛卡尔偏移目标，导致 MoveJ/MoveL 在执行前正确报告不可达。
- 修改内容：将共享可达目标和 MoveJ→MoveL→MoveJ 序列改为由同一稳定关节构型 FK 生成的目标姿态。
- 修改影响：测试继续验证真实执行器的顺序、停止和指针行为，不再依赖异构型目标的隐式切换。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。
## 2026-08-25 — 保留停止语义夹具并隔离严格构型序列起点

- 修改文件：`src/rapid/program-executor.test.ts`、`UPDATE_LOG.md`。
- 修改原因：停止/单步回归依赖原有可达夹具；将共享目标整体换成新起点后使其等待未完成。
- 修改内容：恢复停止类测试使用原有起点和目标；仅 MoveJ→MoveL→MoveJ 顺序测试注入远离象限边界的稳定起点与 FK 目标。
- 修改影响：保留 MotionRunner 停止时序覆盖，同时让顺序集成测试符合严格构型保持语义。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。

## 2026-08-25 — 重组 RAPID、机器人核心与型号模块目录

### 阶段记录：诊断路径不可达与目标未执行

- 修改文件：无生产代码修改；临时诊断夹具 `.scratch/diagnose-path-configuration.test.ts` 已创建、运行并删除；`UPDATE_LOG.md`。
- 诊断原因：用户反馈目录重构后大量路径显示不可达且未执行，需要区分目录重构影响与此前的运动规划策略变更。
- 诊断结论：目录重构只移动文件和调整导入；`b9f3b47` 引入的默认 ABB 构型保持会过滤与当前起始构型不同的合法 IK 候选。6 个 RAPID 预设在严格模式下均在前几条 MoveJ 失败，关闭 `preserveConfiguration` 后全部通过。
- 诊断影响：确认“未执行目标”是规划在执行前返回 `unreachable`，不是 MotionRunner 丢失轨迹；后续修复应明确处理目标 confdata、起始构型和旧预设数据，不能把规划失败静默改成执行。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。

### 阶段记录：复核解析 IK ticket 与旧版自由移动差异

- 修改文件：无生产代码修改；临时差分夹具 `.scratch/analytic-reachability-differential.test.ts` 已创建、运行并删除；`UPDATE_LOG.md`。
- 诊断原因：确认解析 IK 是否已按 ticket 落地，并解释当前版本相对旧版丢失大范围自由移动能力的原因。
- 诊断结论：Ticket 01 已实现；Ticket 02 仅完成解析奇异候选生成，上层 wrist escape、机械零位资格、position-only DLS 精化和 5° 护栏仍存在。解析候选覆盖没有退化，主要回归来自 `c8c653c` 删除异构型候选 fallback，以及 App/Worker 注入入口未传 `preserveConfiguration:false`。
- 验证结果：5 个 FK 可达目标均存在精确解析候选，放宽构型后单点 5/5 成功；App 同款 Cartesian 入口存在默认失败、放宽后成功的确定性样例；解析 IK/数值兜底/腕部测试 3 个文件、29 个测试全部通过。
- 诊断影响：自由移动退化位于候选策略和应用接线，不是解析几何工作空间覆盖不足；当前 RAPID 又拒绝非零 robconf，形成“目标构型不可声明、当前构型却被强制保持”的语义矛盾。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。

- 修改文件：`src/rapid/**`、`src/robotics/**`、`src/robot-models/**`、`UPDATE_LOG.md`。
- 修改原因：RAPID 解析、数据、规划、执行和编辑实现全部平铺在 `src/rapid`，且 Cartesian 路径解算与逆解连续性实现存在反向依赖；需要按模块职责建立二级目录并收敛公开接缝。
- 修改内容：先移动文件到 data/language/planning/execution/editing/editor 等职责目录，保持当前实现和测试语义不变；后续阶段再拆分超大 parser/editor 实现并调整 robotics 依赖方向。
- 修改影响：仅改变模块路径和导入组织，不改变 FK、IK、RAPID 解析、运动规划或执行行为；`UPDATE_LOG.md` 仅保留在本地，绝不提交到 Git。
- Git 约束：本文件仅作本地变更记录，绝不提交到 Git。

## 2026-08-26 — 连续编号 Wayfinder 当前主线票据

- 修改文件：`.scratch/wayfinder/map-unified-robot-motion.md`、`.scratch/wayfinder/tickets/*.md`、`UPDATE_LOG.md`。
- 修改原因：删除过时票据后编号存在 02、08 等空洞，且正文保留历史编号会增加当前实施顺序的理解成本。
- 修改内容：按当前依赖与实施主线将 9 张票据连续编号为 01–09；同步更新全部 Markdown 链接和自然语言票据编号；在统一地图增加 Current frontier，明确腕部插补、跨入口验收、破坏性迁移和手动 Jog oracle 的当前关系。
- 修改影响：当前票据目录按编号即可顺序阅读，不保留旧编号兼容引用；没有修改生产算法或测试代码。
- 验证结果：旧文件名与旧文字编号均零命中，Wayfinder Markdown 本地链接无断链。
- Git 约束：`.scratch/` 与 `UPDATE_LOG.md` 均由 Git 忽略且未跟踪，本记录绝不提交到 Git。

## 2026-08-26 — 将运动算法主线修订为 Web/Unity 共用的外置核心

- 修改文件：`.scratch/wayfinder/map-unified-robot-motion.md`、`.scratch/wayfinder/tickets/01-wrist-singularity-interpolation.md`、`.scratch/wayfinder/tickets/03-define-motion-intent-policy-matrix.md`、`.scratch/wayfinder/tickets/05-design-unified-motion-planner-interface.md`、`.scratch/wayfinder/tickets/06-define-motion-coordinator-ownership.md`、`.scratch/wayfinder/tickets/07-define-cross-entry-conformance-tests.md`、`.scratch/wayfinder/tickets/08-decide-breaking-migration-sequence.md`、`UPDATE_LOG.md`。
- 修改原因：原 `MotionPlanner` 设计仍暴露 Promise、cancel、RobotProfile 方法对象和 Worker 生命周期，无法作为独立插件供 Unity 等宿主复用；先在旧目录实现腕部算法再迁移还会造成重复修改。
- 修改内容：把核心 interface 收敛为同步纯函数 `planMotion(MotionPlanningRequest): MotionPlanningResult`；固定 JSON 可序列化数据、mm/degree/ms、右手坐标系和 quaternionWxyz；将 Worker、取消、代次、Coordinator、Runner 与 Unity 播放移到宿主 adapter；确定 Web Worker 与 Unity Node sidecar 为两个真实 adapter，Unity 首期使用 UTF-8 JSON Lines/stdin-stdout；迁移顺序调整为先剥离核心并切换 Web，再在核心内部实现 ABB wrist interpolation。
- 修改影响：后续 Web、Unity、JOG、Gizmo 和 RAPID 将共享唯一算法 implementation，同一请求必须得到相同计划或失败；DLS/解析 IK 的内部使用不再向宿主暴露；本轮未修改生产算法或测试代码。
- Git 约束：`.scratch/` 与 `UPDATE_LOG.md` 均由 Git 忽略且未跟踪，本记录绝不提交到 Git。

## 2026-08-26 — 将外置核心改为任意宿主复用并补齐前端流畅性契约

- 修改文件：`.scratch/wayfinder/map-unified-robot-motion.md`、`.scratch/wayfinder/tickets/01-wrist-singularity-interpolation.md`、`.scratch/wayfinder/tickets/03-define-motion-intent-policy-matrix.md`、`.scratch/wayfinder/tickets/05-design-unified-motion-planner-interface.md`、`.scratch/wayfinder/tickets/06-define-motion-coordinator-ownership.md`、`.scratch/wayfinder/tickets/07-define-cross-entry-conformance-tests.md`、`.scratch/wayfinder/tickets/08-decide-breaking-migration-sequence.md`、`UPDATE_LOG.md`。
- 修改原因：Unity 只是可复用宿主示例，不能成为核心架构中心；同时将所有轨迹播放简单下放给宿主会导致不同 easing 和前端卡顿风险。
- 修改内容：把核心目标改为浏览器、桌面程序、游戏引擎、ROS/后端及未来宿主通用；核心公开面调整为重计算 `planMotion` 与轻量确定性 `sampleTrajectory`；Web 规划常驻 Worker，RAF 本地采样；连续 JOG 使用尾部锚定、前瞻缓冲、最新请求合并和无重启追加；外部进程仅作为通用 reference adapter，Unity/Python/ROS 都是可选消费者。
- 修改影响：核心不绑定任何具体宿主或 transport，同时前端主线程不执行 IK/路径规划或逐帧跨线程通信；后续迁移必须冻结帧时间和规划延迟基准，并证明连续 JOG 无缓冲欠载。
- Git 约束：`.scratch/` 与 `UPDATE_LOG.md` 均由 Git 忽略且未跟踪，本记录绝不提交到 Git。

## 2026-08-26 — 诊断连续长按 Move/JOG 的抽动与停顿机制

- 修改文件：`.scratch/continuous-jog-stutter.test.ts`、`.scratch/wayfinder/map-unified-robot-motion.md`、`.scratch/wayfinder/tickets/05-design-unified-motion-planner-interface.md`、`.scratch/wayfinder/tickets/06-define-motion-coordinator-ownership.md`、`.scratch/wayfinder/tickets/07-define-cross-entry-conformance-tests.md`、`.scratch/wayfinder/tickets/08-decide-breaking-migration-sequence.md`、`UPDATE_LOG.md`。
- 修改原因：用户所说的前端“卡顿”是长按 Move/JOG 时模型反复抽动、点头、刹停再起步，不是单纯帧率问题；需要建立能捕捉运动连续性的确定性反馈环。
- 诊断方法：使用手动时钟模拟连续轨迹每 100ms 左右追加、generation 变化、腕部分支反向和规划耗时大于输入节拍；临时测试仅位于被 Git 忽略的 `.scratch`。
- 诊断结论：同一长按中每次 commit 递增 generation 会让 Runner 重建 easing，单帧推进量由约 1.48°降到 0.06976°；generation 变化允许腕部从 10°退回 9.04°；即使 generation 不变，每段 waypoint 的 ease-in-out 仍让边界步长由巡航约 2.44°降至 0.04°；异步规划持续慢于输入节拍时，当前“队列非空就丢弃成功结果”策略会保持零轨迹提交。
- 规划修订：连续 JOG 必须拆分稳定 session id、request sequence 和 tail revision；以末端关节+速度滚动规划并至少 C1 拼接；按下只加速一次、持有不在批次/waypoint 边界归零、松开才减速；维持前瞻缓冲且成功可接续结果不得被最新目标无限饿死。
- 修改影响：本轮未修改生产算法；保留红色诊断测试作为后续实现的反馈环，修复完成并迁移为正式回归后删除该临时文件。
- Git 约束：`.scratch/` 与 `UPDATE_LOG.md` 均由 Git 忽略且未跟踪，本记录绝不提交到 Git。

## 2026-08-26 — 按最简原则收敛统一运动架构

- 修改文件：`.scratch/wayfinder/map-unified-robot-motion.md`、`.scratch/wayfinder/tickets/01-wrist-singularity-interpolation.md`、`.scratch/wayfinder/tickets/03-define-motion-intent-policy-matrix.md`、`.scratch/wayfinder/tickets/05-design-unified-motion-planner-interface.md`、`.scratch/wayfinder/tickets/06-define-motion-coordinator-ownership.md`、`.scratch/wayfinder/tickets/07-define-cross-entry-conformance-tests.md`、`.scratch/wayfinder/tickets/08-decide-breaking-migration-sequence.md`、`UPDATE_LOG.md`。
- 修改原因：上一版规划加入了尚无当前需求支撑的轨迹采样 API、速度尾状态、多套连续会话标识、通用外部进程适配器和宿主示例，超出了剥离核心及修复现有长按卡顿所需范围。
- 修改内容：核心公开面收敛为纯数据 contract 与唯一 `planMotion`；当前只规划接入已有常驻 Web Worker；未来宿主仅依靠可序列化边界保留接入能力，不提前实现适配器；连续运动只保留稳定 generation、有效成功结果先提交、waypoint 不重复缓动三条已由诊断证明的规则。
- 修改影响：实施范围显著缩小，避免为了 Unity、ROS、Node 等未提出的具体接入需求提前增加基础设施；没有修改生产运动算法，红色连续长按诊断仍保留为后续实现反馈环。
- Git 约束：`.scratch/` 与 `UPDATE_LOG.md` 均由 Git 忽略且未跟踪，本记录绝不提交到 Git。

## 2026-08-26 — 审核统一运动 Wayfinder 的实施完备性

- 修改文件：`.scratch/wayfinder/implementation-readiness-review-2026-08-26.md`、`UPDATE_LOG.md`。
- 修改原因：用户要求详细复核上一模型关于“Wayfinder 已结束、可以实施”的判断，需要对地图闭环、票据依赖、领域证据、核心 interface 和当前测试状态进行独立核验。
- 修改内容：新增实施前完备性审核，记录 zone blending 与单请求规划冲突、手动 Jog 与 `cfx` oracle 缺口、腕部通用化证据不足、核心 contract 未完全定型、frontier/票据类型漂移，以及达到 Wayfinder 结束状态的最小收口清单。
- 修改影响：结论为当前地图尚未结束；仅允许先做不冻结未决语义的测试与纯计算依赖准备，不修改 Wayfinder 原件和生产代码。
- 验证结果：`npm run check` 通过；正式测试 583/585 通过，Y±50 腕部 oracle 2 项失败；连续 JOG 独立诊断 1/5 通过，generation/easing/反向追加/慢规划 4 项失败；Wayfinder 本地 Markdown 链接无断链。
- Git 约束：`.scratch/` 与 `UPDATE_LOG.md` 均由 Git 忽略且未跟踪，本记录绝不提交到 Git。

## 2026-08-26 — 认领无兼容层主线迁移顺序票据

- 修改文件：`.scratch/wayfinder/tickets/08-decide-breaking-migration-sequence.md`、`UPDATE_LOG.md`。
- 修改原因：继续按 Wayfinder 规则工作真正未阻塞的迁移顺序票据，必须在处理 resolution 前先完成认领。
- 修改内容：将票据 Assignee 从 `unassigned` 更新为 `codex`；未修改问题、答案、依赖或状态。
- 修改影响：其他并发会话应跳过该票据；未修改生产代码和运行行为。
- Git 约束：`.scratch/` 与 `UPDATE_LOG.md` 均由 Git 忽略且未跟踪，本记录绝不提交到 Git。

## 2026-08-26 — 关闭无兼容层迁移顺序并票据化 zone 决策

- 修改文件：`.scratch/wayfinder/tickets/08-decide-breaking-migration-sequence.md`、`.scratch/wayfinder/tickets/10-decide-zone-blending-scope.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：迁移顺序已经有完整答案，却仍作为开放票据和实施容器；同时 zone blending 已能精确表述，却仍留在雾区并可能改变核心公开 interface。
- 修改内容：记录“先关闭影响 interface 的决策，再按无兼容层顺序迁移”的正式 resolution 并关闭迁移票据；将该决策追加到地图索引；移除容易漂移的手写 Current frontier；新建“决定本阶段 RAPID zone blending 的范围与规划形态”票据，并从 Not yet specified 删除对应雾区。
- 修改影响：Wayfinder 与实施工作重新分离；后续不得在核心 contract 迁移中临场决定 zone 语义。生产代码和运行行为未改变。
- Git 约束：`.scratch/` 与 `UPDATE_LOG.md` 均由 Git 忽略且未跟踪，本记录绝不提交到 Git。

## 2026-08-26 — 认领 RAPID zone blending 范围票据

- 修改文件：`.scratch/wayfinder/tickets/10-decide-zone-blending-scope.md`、`UPDATE_LOG.md`。
- 修改原因：继续处理当前未阻塞的 Wayfinder HITL 决策前，先按并发规则认领票据。
- 修改内容：将票据 Assignee 从 `unassigned` 更新为 `codex`；问题、状态和依赖保持不变。
- 修改影响：其他并发会话应跳过该票据；未修改生产代码和运动行为。
- Git 约束：`.scratch/` 与 `UPDATE_LOG.md` 均由 Git 忽略且未跟踪，本记录绝不提交到 Git。

## 2026-08-26 — 锁定精确停点与转弯区的领域边界

- 修改文件：`CONTEXT.md`、`UPDATE_LOG.md`。
- 修改原因：用户确认本阶段只支持 `fine`、不实现真实 zone blending，需要立即固定后续票据和代码使用的统一语言。
- 修改内容：新增“精确停点（fine）”与“转弯区（fly-by zone）”定义；明确后者依赖相邻运动前瞻，不能用到点后再启动下一条运动冒充。
- 修改影响：后续规划不得继续使用“安全停点近似”描述非 fine zone；zone 票据仍保持开放，等待拒绝阶段与自定义 zonedata 边界决策。
- Git 约束：`CONTEXT.md` 当前属于用户已有工作树；本次只追加上述领域术语。`UPDATE_LOG.md` 按项目约束保留本地记录。

## 2026-08-26 — 修复 RobotStudio Oracle 事件日志可选参数读取

- 修改文件：`.agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1`、`UPDATE_LOG.md`。
- 修改原因：RobotWare 当前事件列表包含没有 `argv` 的记录，helper 在 PowerShell StrictMode 下直接读取缺失属性，导致只读 Inspect 在完成安全预检前失败。
- 修改内容：读取事件参数前检查 `argv` 与 `value` 属性；缺失时记录空数组，不改变事件码、时间、来源或控制器操作流程。
- 修改影响：Inspect/RunRoutines 可兼容无参数事件；未上传模块、移动程序指针或启动控制器。
- Git 约束：`.agents/` 当前为用户未跟踪目录；本次只修改上述 helper 的事件序列化健壮性。

## 2026-08-26 — 准备 RobotStudio zone 语义黑盒实验

- 修改文件：`.scratch/robotstudio-oracle/zone-semantics-20260826/ZoneSemantics.mod`、`UPDATE_LOG.md`。
- 修改原因：用户要求以 ABB RobotStudio 实际效果决定 fine/fly-by 与自定义 zonedata 语义，需要可重复、彼此隔离的控制器实验。
- 修改内容：新增四个独立 RAPID routine；每例先回到 `[0,-25,45,0,20,0]`，再执行同一两段直角 MoveL，分别使用系统 fine、系统 z10、自定义 finep=TRUE、自定义 finep=FALSE；自定义记录除 finep 外数值相同。
- 修改影响：当前仅创建本地实验模块，尚未上传、加载、移动程序指针或启动虚拟控制器。
- 安全上下文：只读 Inspect 确认唯一 `Controller1/T_ROB1` 为虚拟控制器，RobotWare 6.16.0.3，Auto、MotorsOn、RAPID Stopped。
- Git 约束：实验与原始证据保存在 `.scratch`，不修改生产代码。

## 2026-08-26 — 修正 RobotWare 6 实验模块注释编码

- 修改文件：`.scratch/robotstudio-oracle/zone-semantics-20260826/ZoneSemantics.mod`、`UPDATE_LOG.md`。
- 修改原因：首次 RunRoutines 在启动运动前被 CheckProgram 拒绝，错误全部指向包含中文注释的第 2 行；RobotWare 6 当前模块编码不接受这些字符。
- 修改内容：仅将两行说明性注释改为 ASCII，四个 routine、起点、目标、速度和 zonedata 完全不变。
- 修改影响：首次尝试未启动任何运动、未产生行为结论；修正后重新执行同一实验。

## 2026-08-26 — 分离未通过检查的自定义 zonedata 与系统 zone 实验

- 修改文件：`.scratch/robotstudio-oracle/zone-semantics-20260826/ZoneSemanticsInvalidFine.mod`、`.scratch/robotstudio-oracle/zone-semantics-20260826/ZoneSemantics.mod`、`UPDATE_LOG.md`。
- 修改原因：第二次 CheckProgram 只拒绝 `[TRUE,10,15,15,1.5,15,1.5]` 的 `CONST zonedata` 声明；当时需要把该声明从可执行行为实验中隔离。
- 修改内容：把非法声明保存为独立原始夹具；可执行模块的 customFine 改为规范 `[TRUE,0,0,0,0,0,0]`，customFly 继续使用与系统 z10 相同的 FALSE/非零字段。
- 修改影响：前两次均未启动运动；下一次运行只比较 RobotWare 接受的系统/自定义精确停点与转弯区。

## 2026-08-26 — 继续隔离自定义 zonedata 声明并缩小实验

- 修改文件：`.scratch/robotstudio-oracle/zone-semantics-20260826/ZoneSemanticsInvalidFineZero.mod`、`.scratch/robotstudio-oracle/zone-semantics-20260826/ZoneSemantics.mod`、`UPDATE_LOG.md`。
- 修改原因：第三次 CheckProgram 继续只拒绝 `[TRUE,0,0,0,0,0,0]` 的 `CONST zonedata` 声明，需要进一步缩小可执行实验。
- 修改内容：保存第二种静态拒绝夹具；从可执行模块删除 customFine 与对应 routine，最终只比较系统 fine、系统 z10 和自定义 finep=FALSE/z10 数值记录。
- 修改影响：前三次均在控制器启动前失败、机器人未移动；后续 customFly 也在相同声明位置失败，因此不能把失败归因于 `finep=TRUE`。

## 2026-08-26 — 停止追查自定义 zonedata 并保留系统 zone 基准

- 修改文件：`.scratch/robotstudio-oracle/zone-semantics-20260826/ZoneSemantics.mod`、`UPDATE_LOG.md`。
- 修改原因：`finep=FALSE` 的 customFly 也在同一 `CONST zonedata` 声明位置被 CheckProgram 拒绝，证明中间失败不是 finep 差异；继续调整声明形式超出当前 zone 范围决策。
- 修改内容：从可执行模块删除所有自定义 zonedata 与 routine，只保留系统 `fine` 和系统 `z10` 的同起点、同目标直角 MoveL 对照。
- 修改影响：前四次均未启动运动；自定义 zonedata 的合法声明形式不在本票据下结论，最终黑盒实验只使用 RobotWare 内置系统数据。

## 2026-08-26 — 为 Oracle 实验补充程序指针复位入口

- 修改文件：`.scratch/robotstudio-oracle/zone-semantics-20260826/ZoneSemantics.mod`、`UPDATE_LOG.md`。
- 修改原因：系统 fine/z10 模块已通过 CheckProgram，但 helper 在启动例程前调用 ResetProgramPointer；没有 main 时 RobotWare 返回 `C0049000 RAPID symbol was not found`。
- 修改内容：增加空 `main` 作为任务程序指针复位入口，不改变 SystemFine/SystemZ10 的起点、路径、速度或 zone。
- 修改影响：第五次尝试仍未启动运动；只读复核确认控制器保持 Auto、MotorsOn、RAPID Stopped、任务 Ready。

## 2026-08-26 — 为 RobotStudio Oracle 增加实验模块卸载动作

- 修改文件：`.agents/skills/robotstudio-oracle/scripts/invoke-robotstudio.ps1`、`UPDATE_LOG.md`。
- 修改原因：RunRoutines 会留下本次临时模块，而 Oracle 安全流程要求实验结束后恢复预期模块集；初始模块只有 user、BASE。
- 修改内容：新增窄作用域 `RemoveModule` 动作；复用虚拟控制器、Auto、RAPID Stopped、显式 mutation 授权、唯一模块匹配和 RAPID mastership 护栏，只删除调用方明确命名的模块。
- 修改影响：允许安全卸载 `ZoneSemantics`，不增加任意文件或批量模块删除能力。

## 2026-08-26 — 以 RobotStudio 证据关闭 zone blending 范围票据

- 修改文件：`.scratch/wayfinder/assets/robotstudio-zone-semantics.md`、`.scratch/wayfinder/tickets/10-decide-zone-blending-scope.md`、`.scratch/wayfinder/tickets/05-design-unified-motion-planner-interface.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：用户要求按 ABB RobotStudio 实际效果决定本阶段 zone 语义；系统 fine/z10 的同路径黑盒轨迹已经取得。
- 修改内容：记录原始证据链接和角点/时长对比；正式决定本阶段只执行系统 fine，其他 zone 保留解析但在程序启动前返回 `unsupported-capability`，fly-by 核心请求再次防御性拒绝；禁止安全停点近似；把真实 zone blending 移入 Out of scope，并同步核心 interface 票据。
- 修改影响：Wayfinder 的 zone 雾区已闭环；实施时需要把当前非 fine 成功执行测试改为明确拒绝测试，但本轮不修改生产代码。
- RobotStudio 结果：SystemFine 到角点最小距离 0.000012 mm、0.5 mm 内 4 个采样；SystemZ10 最小距离 3.194938 mm、0.5 mm 内零采样；两者最终 fine 点均准确到达。
- 控制器收尾：实验模块已卸载；最终 Auto、MotorsOn、RAPID Stopped、任务 Ready，模块恢复为 user、BASE。
## 2026-08-26：补充 RobotStudio Oracle 首次运行防错说明

### 修改文件

- `.agents/skills/robotstudio-oracle/SKILL.md`
- `.agents/skills/robotstudio-oracle/references/controller-operations.md`
- `.scratch/wayfinder/map-unified-robot-motion.md`
- `UPDATE_LOG.md`

### 修改原因

- 本轮 RobotStudio 黑盒实验暴露了可重复的首次运行问题，需要直接沉淀到对应 skill，使后续 Agent 从可运行基线开始。
- 上一次操作误把 skill 回写要求绑定为 Wayfinder 最终交付门槛；该要求与票据规划无关，需要立即撤销。

### 修改内容

- 增加经本机 RobotWare 6.16 验证的最小 RAPID 模块形态：ASCII 源文本、空 `main` 和独立无参实验 routine。
- 记录事件日志 `argv.value` 是可选字段，StrictMode 下必须先检查属性，缺失时序列化为空数组。
- 记录缺少 `main` 会使 helper 的 `ResetProgramPointer` 返回 `C0049000`，并给出根本修复方式。
- 增加临时模块 `RemoveModule` 的标准清理命令及清理后再次 Inspect 的验收要求。
- 对自定义 `zonedata` 只记录可靠诊断边界：先以系统 `fine/z10` 验证执行链，再隔离声明并取得明确诊断；不把尚未确认的失败原因写成 RAPID 语义。
- 删除 Wayfinder 地图中误加的最终交付门槛，不改变任何票据状态或决策。

### 修改影响

- 后续 Agent 可直接复制首跑模板，避免事件读取、程序指针复位和实验模块残留三类已知错误。
- skill 不再依赖当前 Wayfinder 的完成状态；此次只修改 skill 文档、规划误记和更新日志，不改变项目生产代码。

### 验证结果

- PowerShell 解析器确认 `invoke-robotstudio.ps1` 无语法错误。
- `robotstudio-oracle` skill 的本地 Markdown 链接检查通过，无断链。
- 按 skill 首次使用路径执行只读 Inspect 成功，证据位于 `.scratch/robotstudio-oracle/skill-first-run-smoke-20260826/`。
- 最终控制器保持 `Controller1/T_ROB1`、RobotWare 6.16.0.3、Auto、MotorsOn、RAPID Stopped、任务 Ready，模块集仍为 `user`、`BASE`；本次验证未加载模块或启动运动。
## 2026-08-26 — 认领 RobotStudio 全零点 Y±50 手动 Jog 基准任务

- 修改文件：`.scratch/wayfinder/tickets/09-capture-robotstudio-zero-y50-reference.md`、`UPDATE_LOG.md`。
- 修改原因：用户指定继续补齐独立的 RobotStudio 手动线性 Jog 轨迹；Wayfinder 要求在开展任务前先认领开放票据。
- 修改内容：将“采集 RobotStudio 全零点 Y±50 控制器基准”的 Assignee 从 `unassigned` 更新为 `codex`；问题、证据要求、状态和依赖保持不变。
- 修改影响：其他并发会话应跳过该票据；未修改生产代码、RobotStudio 控制器或运动状态。
## 2026-08-26 — 准备手动 Jog 独立全零复位模块

- 修改文件：`.scratch/robotstudio-oracle/manual-jog-y50-20260826/ManualJogSetup.mod`、`UPDATE_LOG.md`。
- 修改原因：手动 Y+50 与 Y-50 必须分别从真实机械全零开始，不能从上一方向终点继续；复位与待测的手动 Jog 语义必须隔离。
- 修改内容：新增最小 `ManualJogSetup` RAPID 模块，仅公开 `ResetZero`，以 `MoveAbsJ` 将 IRB1200 六轴复位到 `[0,0,0,0,0,0]`；包含 helper 所需的空 `main`，使用 ASCII 源文本、`v100`、`fine`、`tool0`。
- 修改影响：当前只创建本地实验夹具，尚未上传模块、移动程序指针或启动控制器；模块将在两方向采集完成后卸载。
- 预检结果：RobotStudio 26.2.11700.0、RobotWare 6.16.0.3，唯一虚拟 `Controller1/T_ROB1` 为 Auto、MotorsOn、RAPID Stopped，初始模块集为 `user`、`BASE`。
## 2026-08-26 — 以 RAPID 黑盒基准替代本阶段未完成的手动 Jog 采集

- 修改文件：`.agents/skills/robotstudio-oracle/SKILL.md`、`.agents/skills/robotstudio-oracle/references/controller-operations.md`、`.scratch/wayfinder/tickets/09-capture-robotstudio-zero-y50-reference.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`.scratch/wayfinder/assets/mechanical-zero-y50-diagnosis.md`、`UPDATE_LOG.md`。
- 修改原因：用户确认不再等待持续卡在启动画面的 RobotStudio Virtual FlexPendant Jogging；本阶段需要直接采用已经完成且可重复的 RAPID Y±50 高频基准。
- 修改内容：明确 `RunRoutines`/PC SDK 只能产生 RAPID 证据，不能伪称手动 Jog；记录 PC SDK 无公开 Jog 写入 API；记录 VFP TAF 页面在当前版本持续停留 RobotWare 启动画面时的有界停止、关闭、恢复流程；补充 VFP UIAutomation 应按进程 ID 从桌面根节点重新定位控件；关闭票据 09，并把手动 Jog 从当前 Wayfinder 前置条件移入 Out of scope/未来独立任务；更新兼容性资产的范围结论。
- 修改影响：腕部插补实施继续以 RobotWare 6.16.0.3 的 RAPID `SingArea\\Wrist` 高频轨迹、端点和 50026 对照为唯一控制器基准；不新增或伪造手动 Jog CSV，不改变生产代码。
- 实验收尾：VFP 进程已正常关闭；`ManualJogSetup` 已卸载；最终 `Controller1/T_ROB1` 为 Auto、MotorsOff、RAPID Stopped、任务 Ready，模块恢复 `user/BASE`。
- 原始 RAPID 证据：`.scratch/robotstudio-oracle/zone-semantics-20260826/run-006/`；手动 Jog 本轮没有有效轨迹产物。
- 文档校正：将票据 09 的旧“剩余证据”措辞改为“手动 Jog 本轮未取得且不作为当前实施前置条件”，与 Resolution、地图范围和最终控制器证据保持一致。
## 2026-08-26 — 认领并规范腕部奇异路径票据

- 修改文件：`.scratch/wayfinder/tickets/01-wrist-singularity-interpolation.md`、`UPDATE_LOG.md`。
- 修改原因：继续 Wayfinder 时确认该开放票据缺少统一 Tracker 元数据，且状态埋在正文中，无法可靠参与 frontier/阻塞查询；处理票据前必须先认领。
- 修改内容：新增标准 Tracker 区块，将票据标记为 `wayfinder:task`、open、父地图正确、Assignee=`codex`、当前无未关闭依赖；移除重复的 Type/Status 正文段落，不修改问题、范围、验收或证据内容。
- 修改影响：本地 tracker 现在能正确识别该票据已被当前会话认领；未修改生产代码或运动行为。
## 2026-08-26 — 将腕部生产实现移出 Wayfinder 并暴露通用规则票据

- 修改文件：`.scratch/wayfinder/tickets/01-wrist-singularity-interpolation.md`、`.scratch/wayfinder/tickets/11-lock-general-wrist-interpolation-rule.md`、`.scratch/wayfinder/tickets/07-define-cross-entry-conformance-tests.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：“建立 ABB 腕部奇异候选与路径插补能力”直接要求迁移算法、删除生产补丁、接入 Worker 和通过实现测试，同时又声明需等待迁移步骤 1–6，违反 Wayfinder plan-only 边界并造成实施前规划的循环依赖。
- 修改内容：关闭并记录该实施票据超出地图范围；保留其 Y±50 证据；新增“锁定 ABB 腕部奇异插补的通用控制器规则”任务，要求通过 RAPID X±/Z± 和非零 J4/J6 起点连续轨迹锁定终点分支、腕部不变量、插补形状和拒绝边界；将跨入口验收矩阵的阻塞关系改指新票据；在地图 Out of scope 索引旧实施票据。
- 修改影响：Wayfinder frontier 不再要求先交付生产核心；下一步成为可独立执行的 RobotStudio RAPID 黑盒证据任务。未修改生产代码或控制器状态。
## 2026-08-26 — 认领 ABB 腕部奇异插补通用规则任务

- 修改文件：`.scratch/wayfinder/tickets/11-lock-general-wrist-interpolation-rule.md`、`UPDATE_LOG.md`。
- 修改原因：继续推进 Wayfinder 当前唯一未阻塞 frontier；按规则必须在实验设计、子 Agent 分工和控制器操作前认领。
- 修改内容：将“锁定 ABB 腕部奇异插补的通用控制器规则”的 Assignee 从 `unassigned` 更新为 `codex`；状态、问题、证据要求与依赖保持不变。
- 修改影响：其他会话应跳过该票据；未修改生产代码或 RobotStudio 控制器状态。

## 2026-08-26 — 准备腕部奇异插补通用化黑盒实验

- 修改文件：`.scratch/robotstudio-oracle/wrist-generalization-20260826/WristGeneralization.mod`、`.scratch/robotstudio-oracle/wrist-generalization-20260826/analyze-traces.mjs`、`UPDATE_LOG.md`。
- 修改原因：票据 11 需要在既有全零 Y±50 之外补齐 X±/Z± 与至少两种非零 J4/J6 起点，并以未回绕关节角、TCP 直线误差和姿态误差统一分析。
- 修改内容：新增 8 个彼此独立复位的 RAPID routine，覆盖全零 X±/Z±、`[J4,J6]=[30,30]` 的 X±、`[30,-30]` 的 X±；增加空 `main`、ASCII 源文本、`ConfL\\On + SingArea\\Wrist` 和公共最小 helper；新增纯 Node 轨迹分析器，自动隔离最后一段 MoveL，计算解绕 J4/J6、`q4±q6`、构型变化、四元数姿态距离与 TCP 最大横向误差。
- 修改影响：当前仅创建本地实验与分析夹具，尚未上传、加载、移动程序指针或启动控制器；不修改生产代码。
- 设计依据：J5≈0 的严格几何奇异只约束 `q4+q6`；本矩阵同时覆盖不同初始和与不同 J4/J6 分配，避免把单轴大幅变化误判为分支跳变。

## 2026-08-26 — 以 RobotStudio 轨迹关闭腕部奇异通用规则票据

- 修改文件：`.scratch/robotstudio-oracle/wrist-generalization-20260826/runs/`、`.scratch/robotstudio-oracle/wrist-generalization-20260826/cleanup/`、`.scratch/robotstudio-oracle/wrist-generalization-20260826/final-inspection/`、`.scratch/wayfinder/assets/robotstudio-wrist-generalization.md`、`.scratch/wayfinder/tickets/11-lock-general-wrist-interpolation-rule.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：票据 11 要求用 X±、Z± 与两种非零 J4/J6 起点确定可泛化的奇异候选规则，并清楚区分已验证端点规则和证据不足的路径插补能力。
- 修改内容：运行八个各自独立复位的 RAPID `MoveL + SingArea\\Wrist` case，保留 manifest、事件切片和完整 PC SDK 原始 CSV；以解绕 J4/J6 分析 `q4±q6`、构型、TCP 横向偏差和四元数姿态误差；新增证据资产，关闭票据并将结论索引到地图。
- 修改影响：实施可基于 `robconf`、`ConfL`、限位、未回绕表示和 `q4+q6` 最小差确定奇异候选，缺少候选时结构化失败；控制器路径中姿态插补要求统一返回 `unsupported-capability`，不得用移动方向启发式或 DLS 降级。未修改生产代码。
- 关键结果：全部 8 例成功；新轨迹 `q4+q6` 最大偏离不超过 0.003720°，但 `q4-q6` 可改变 300°；终点姿态恢复误差不超过 0.000107°，最大 TCP 横向偏差不超过 0.126042 mm；过程姿态峰值随场景变化，新增样本为 0.008214°～0.160322°，既有 Y±50 约 2.05°。
- 控制器收尾：卸载精确临时模块 `WristGeneralization` 后复检，唯一虚拟 `Controller1/T_ROB1` 为 Auto、MotorsOn、RAPID Stopped、任务 Ready，模块集恢复为 `user`、`BASE`。
- Git 约束：原始证据与 Wayfinder 票据位于 `.scratch/`，更新日志位于本地根目录；本轮不提交用户已有的生产代码改动。

## 2026-08-26 — 修正跨入口验收票据的证据与日志边界

- 修改文件：`.scratch/wayfinder/tickets/03-define-motion-intent-policy-matrix.md`、`.scratch/wayfinder/tickets/07-define-cross-entry-conformance-tests.md`、`CONTEXT.md`、`UPDATE_LOG.md`。
- 修改原因：重新审查票据后发现手动 Jog 的过期 oracle 表述、RobotStudio 缺失数据的静默 skip 规则，以及系统日志与 ABB 外部日志的职责边界不够明确。
- 修改内容：明确手动 Jog 不构成当前前置条件；缺失或过期 RobotStudio 数据时必须主动采集，失败则阻塞验收；新增本项目系统运动日志的详细字段和结构化关联要求；明确系统日志与 ABB 原始事件/CSV 分开保存，仅对规划结果和结构化错误做一致性断言；票据 07 仍保持 open，未进入生产实现。
- 修改影响：后续验收必须产生可追踪 RobotStudio 批次和详细系统观测，不能用静默跳过或 ABB 日志格式替代本系统日志；未修改生产代码、Worker、Runner 或控制器状态。

## 2026-08-26 — 确认并关闭跨入口运动一致性验收矩阵

- 修改文件：`.scratch/wayfinder/tickets/07-define-cross-entry-conformance-tests.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：用户确认采用三层验收、主动 RobotStudio 采集和“结果完全一致、日志按模块职责不同”的边界。
- 修改内容：关闭票据 07；正式记录核心 `planMotion`、常驻 Worker、Coordinator/Runner 三层职责；规定成功计划或结构化错误在核心直调/JSON/Worker 间完全一致；规定 RobotStudio 缺失 fixture 时主动采集、失败阻塞；补充详细系统运动日志字段及与 ABB 外部证据的分离规则；将决策追加到地图索引。
- 修改影响：Wayfinder 的所有实施前置决策已关闭，后续生产工作必须按三层验收矩阵执行；本轮不修改生产代码、Worker、Runner 或 RobotStudio 控制器。

## 2026-08-26 — 将运动错误文案雾区票据化

- 修改文件：`.scratch/wayfinder/tickets/12-define-motion-error-messaging-contract.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：Wayfinder 地图在关闭跨入口验收矩阵后仍留下“UI 与 RAPID 如何分别映射统一规划错误文案”的未具体化问题，不能直接假设其答案后进入生产实现。
- 修改内容：新增开放 grilling 票据，明确核心错误、UI 文案、RAPID 诊断、系统日志、源码定位、ABB 事件证据和恢复建议的决策边界；将地图雾区替换为可查询的 child ticket；明确本票据只做规划，不实现代码。
- 修改影响：后续可独立决策错误呈现契约；生产实现继续保持暂停，不改变现有错误类型、界面、RAPID runtime 或日志行为。

## 2026-08-26 — 定稿统一运动错误呈现契约并关闭规划地图

- 修改文件：`.scratch/wayfinder/tickets/12-define-motion-error-messaging-contract.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`CONTEXT.md`、`UPDATE_LOG.md`。
- 修改原因：错误文案雾区已经具备足够上下文，不再需要逐项交互；必须在生产实现前固定核心错误、宿主文案和 ABB 外部证据的边界。
- 修改内容：关闭票据 12；采用稳定核心 `code/category/details`、UI/RAPID/系统日志独立短文案与详细诊断、静态诊断/规划失败/能力拒绝/控制器拒绝/取消的分类；规定源码范围和 ABB 事件码仅作附加证据；补充稳定错误码覆盖范围和系统日志关联字段；更新领域词汇和地图索引。
- 修改影响：Wayfinder 地图不再有未具体化雾区，所有决策票据已关闭；生产实现仍未开始，后续实现必须遵循错误码不可由入口临时改写、ABB 事件不可伪造的契约。
## 2026-08-26 — 完成统一 ABB 运动主线第一性原则审查

- 修改文件：`.scratch/wayfinder/first-principles-architecture-review-2026-08-26.md`、`UPDATE_LOG.md`。
- 修改原因：用户要求全面审核根本性重构方案，并核对项目内 ABB 参考资料、RobotStudio 证据与方案的一致性。
- 修改内容：新增参考资料清单、第一性原则检查、通过项、阻断项、实施门槛和最终判断；明确区分架构方向正确与当前实施尚未就绪。
- 修改影响：不改变生产代码；为后续 Wayfinder 收口和 implementation issues 提供唯一审查基线，避免在 contract、RAPID 构型或腕部过程语义未定型前直接迁移。

## 2026-08-26 — 同步 Wayfinder 地图的真实未决边界

- 修改文件：`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：审查发现地图原先写成“暂无雾区”，但核心 DTO、`cfx` oracle、腕部过程能力和迁移基线仍未完成决策。
- 修改内容：将四类未决问题写入 `Not yet specified`，并链接第一性原则审查报告；保留已关闭票据和实施性交付的范围边界。
- 修改影响：地图 frontier/雾区与当前证据一致，阻止在未决语义上冻结公开接口；不影响生产代码和运行时行为。

## 2026-08-26 — 修正审查报告中的本地研究资料路径

- 修改文件：`.scratch/wayfinder/first-principles-architecture-review-2026-08-26.md`、`UPDATE_LOG.md`。
- 修改原因：最终路径核验发现 ABB 手册与两份研究记录不在受跟踪 `docs/` 目录，原路径会造成不可用引用。
- 修改内容：改为实际 `.scratch/abb-real-motion-data-and-coordinates/research/` 路径，并明确官方手册由本地研究记录引用。
- 修改影响：审查报告的证据来源可追溯且不虚构仓库内文档位置；不改变任何代码或方案结论。
## 2026-08-26 — 完成 Wayfinder 全票据复核并补充唯一缺口

- 修改文件：`.scratch/wayfinder/ticket-review-2026-08-26.md`、`.scratch/wayfinder/tickets/13-freeze-motion-core-data-contract.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：按最终“可复用纯计算核心”目的地复核全部票据，区分研究决策、实施内容、相互冲突和真实未决项。
- 修改内容：确认原有 12 张票据已覆盖主要决策；将票据 01/08 的实施性交付明确留在 Wayfinder 外；新增唯一必要决策票据 13，补齐核心字段级数据契约问题。
- 修改影响：Wayfinder 不再重复询问已解决的运动学问题；票据 13 是当前唯一需要继续研究/决策的 frontier，关闭后即可把路线交接给实施阶段。
## 2026-08-26 — 收口纯计算核心数据契约票据

- 修改文件：`.scratch/wayfinder/tickets/13-freeze-motion-core-data-contract.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：依据既有票据和参考资料解决核心接口唯一字段级缺口，避免继续重复询问已确定的运动语义。
- 修改内容：锁定最小纯数据请求/结果、intent 必填字段、Tool/WObj 边界、waypoint 相对时间、终点构型、退化残差和稳定错误码；关闭票据 13 并清空地图未决研究项。
- 修改影响：Wayfinder 研究阶段完成，路线可交接给独立实施阶段；本轮不修改生产代码、不实现其他宿主适配器。
## 2026-08-26 — 完成 Wayfinder 票据 13 的研究决策

- 修改文件：`.scratch/wayfinder/tickets/13-freeze-motion-core-data-contract.md`、`.scratch/wayfinder/map-unified-robot-motion.md`、`UPDATE_LOG.md`。
- 修改原因：票据 13 是全量复核后唯一真实未决的研究问题，需要在进入实施前锁定纯计算核心的数据边界。
- 修改内容：确定最小 request/intent/result 字段、单位、定长数组、Tool/WObj 纯数据、策略判别联合、waypoint 相对时间、终点构型、退化残差和稳定错误码；关闭票据并清空研究雾区。
- 修改影响：Wayfinder 研究阶段完成；后续可另行创建 implementation issues，不在本轮修改生产代码或实现其他宿主适配器。
## 2026-08-26 — 终审统一 ABB 运动核心重构方案

- 修改文件：`.scratch/wayfinder/architecture-audit-2026-08-26.md`、`UPDATE_LOG.md`。
- 修改原因：用户要求按第一性原则、金字塔原则和项目内参考资料，审核 Core 独立复用与 RobotStudio 运动一致性方案是否已经完善。
- 修改内容：完整复核 13 张 Wayfinder 票据、ABB 官方资料研究、RobotStudio motion comparison 规范及现有黑盒资产；记录 Core seam 的正确项、公开 contract 的过度设计、运动等价证据缺口、票据冲突和 Wayfinder canonical map 缺失问题，并给出最小收口建议。
- 修改影响：不修改生产代码、测试或 RobotStudio 控制器；结论是架构方向保留，但当前尚不能宣称所有 JOG/MoveJ/MoveL/MoveC 与 RobotStudio 完全一致，也不能把 Wayfinder 判定为完整结束。

## 2026-08-26 — 锁定本阶段 Manual Jog 验收边界

- 修改文件：`.scratch/wayfinder/tickets/03-define-motion-intent-policy-matrix.md`、`.scratch/wayfinder/architecture-audit-2026-08-26.md`、`UPDATE_LOG.md`。
- 修改原因：用户确认当前暂时无法采集 RobotStudio Manual Jog 轨迹，需要防止后续用 RAPID MoveL 证据替代手动 Jog 语义或阻塞 Core 抽离。
- 修改内容：将 Joint Jog 与 Cartesian Jog 的本阶段验收固定为项目内部连续、可控、满足限位、无抽动、无反向追加、无规划饿死并稳定接续；明确不声明 RobotStudio 等价，未来若需要另建独立 Manual Jog oracle 任务。
- 修改影响：Manual Jog 证据缺口不再阻塞当前 Core 抽离；RobotStudio 等价性范围收缩到具有独立控制器证据的 RAPID 能力。本轮不修改生产代码、测试或控制器。

## 2026-08-26 — 确认奇异位置以可运动优先于严格解析完备性

- 修改文件：`.scratch/wayfinder/tickets/02-lock-ik-routing-contract.md`、`.scratch/wayfinder/tickets/03-define-motion-intent-policy-matrix.md`、`.scratch/wayfinder/tickets/11-lock-general-wrist-interpolation-rule.md`、`.scratch/wayfinder/architecture-audit-2026-08-26.md`、`UPDATE_LOG.md`。
- 修改原因：用户指出 RobotStudio 在至少一类腕部奇异位置可以直接通过，本项目不能因严格 6D 解析 IK 缺少逐 waypoint 候选就把真实可运动场景判为不可达。
- 修改内容：区分严格等价路径与显式奇异退化路径；允许在 TCP 位置、关节限位、连续性和终点硬约束可验证时生成可执行退化计划，返回姿态残差和能力边界；禁止伪造 ABB 构型或宣称 RobotStudio 逐样本等价。只有退化路径也无法安全通过时才拒绝。
- 修改影响：奇异位置从“解析失败即拒绝”改为“严格路径优先，安全退化路径兜底”；`unsupported-capability` 不再用于掩盖可安全通过的奇异场景。本轮不修改生产代码、测试或控制器。

## 2026-08-26 — 补充最小运动 Core 实施清单

- 修改文件：`.scratch/wayfinder/minimal-core-implementation-plan-2026-08-26.md`、`.scratch/wayfinder/architecture-audit-2026-08-26.md`、`UPDATE_LOG.md`。
- 修改原因：基线编译已通过，但现有实施票据属于点位示教闭环，尚未覆盖运动 Core 抽离；需要用最小切片明确如何开始，而不增加复杂架构。
- 修改内容：固定只提取当前 ABB 纯计算、保留 Web Worker、Jog 内部连续、奇异位置允许安全通过，并拆成 Core seam、算法迁移、Worker/入口切换、行为验收四个切片。
- 修改影响：确认当前资料足够确定方向，但需按新清单推进 Core 实施；本轮未修改生产代码、测试或控制器。

## 2026-08-26 — 发布统一运动 Core 重构实施 Tickets

- 修改文件：`.scratch/robot-motion-core-refactor/README.md`、`.scratch/robot-motion-core-refactor/issues/01-minimal-core-joint-motion.md`、`.scratch/robot-motion-core-refactor/issues/02-cartesian-singularity-motion.md`、`.scratch/robot-motion-core-refactor/issues/03-worker-continuous-jog.md`、`.scratch/robot-motion-core-refactor/issues/04-rapid-cutover-cleanup.md`、`.scratch/wayfinder/minimal-core-implementation-plan-2026-08-26.md`、`UPDATE_LOG.md`。
- 修改原因：用户确认使用 `to-tickets` 将已决方案发布为可领取、可验证的垂直实施切片；先前最小清单不是正式 tracker tickets。
- 修改内容：按依赖顺序发布四张 `ready-for-agent` 本地票据，覆盖最小 Core 与关节运动、Cartesian 奇异可运动、Worker 与连续 Jog、RAPID 切换与旧入口删除；每票声明阻塞关系和端到端验收条件。
- 修改影响：实施 frontier 从票据 01 开始；不增加其他平台适配、RPC、插件、npm 发布或兼容层。本轮未修改生产代码、测试或控制器。

## 2026-08-26 — 按 Wayfinder 全量决策细拆运动 Core Tickets

- 修改文件：`.scratch/robot-motion-core-refactor/issues/01-freeze-core-contract.md`、`.scratch/robot-motion-core-refactor/issues/02-strict-cartesian-gizmo.md`、`.scratch/robot-motion-core-refactor/issues/03-cartesian-singularity.md`、`.scratch/robot-motion-core-refactor/issues/04-coordinator-worker-jog.md`、`.scratch/robot-motion-core-refactor/issues/05-rapid-movej-configuration.md`、`.scratch/robot-motion-core-refactor/issues/06-rapid-movel-tools-zones.md`、`.scratch/robot-motion-core-refactor/issues/07-rapid-movec.md`、`.scratch/robot-motion-core-refactor/issues/08-errors-logs.md`、`.scratch/robot-motion-core-refactor/issues/09-conformance-cleanup.md`、`.scratch/robot-motion-core-refactor/README.md`、`UPDATE_LOG.md`。
- 修改原因：复核发现原 4 张 tickets 未覆盖 Wayfinder 的 Core contract、Coordinator、RAPID 构型、Tool/WObj、错误日志和完整验收决策，且单票过大。
- 修改内容：按 to-tickets 规则替换为 9 张可独立验证的垂直切片，补齐阻塞关系和端到端验收条件。
- 修改影响：当前实施 frontier 为票据 01；后续按 01→02→03→04，并行推进 05/06/07/08 后由 09 收口。本轮未修改生产代码、测试或控制器。
## 2026-08-26 — 修正 Core 初始接缝的严格类型

- 修改文件：`src/robot-motion-core/planner.ts`、`UPDATE_LOG.md`。
- 修改原因：Core 新增文件存在未使用类型守卫和不安全的通用构型强制转换，导致 `vue-tsc -b` 失败。
- 修改内容：删除未使用的位姿守卫，将通用 `RobotConfiguration` 显式映射为 ABB 的 `cf1/cf4/cf6/cfx` 字段后再写入结果。
- 修改影响：Core 通过 TypeScript 编译，结果结构保持纯数据且不改变规划行为。
## 2026-08-26 — 扩展统一运动 Core 判别联合与路径规划

- 修改文件：`src/robot-motion-core/planner.ts`、`src/robot-motion-core/index.ts`、`UPDATE_LOG.md`。
- 修改原因：票据 01 要求 Core 对外使用单一纯数据 `planMotion`，并覆盖当前真实消费者所需的关节、Cartesian、MoveL、MoveC、构型和奇异策略，而不是继续让入口自行组合旧布尔选项。
- 修改内容：增加版本化 ABB 模型身份、Pose/Tool/WObj 纯数据、配置策略、奇异策略、线性/圆弧/显式退化 intent；统一输入校验、fine 能力门控、解析 Cartesian 路径复用、构型校验、时间有序 waypoint 和稳定错误 code/category/details。
- 修改影响：Core 已具备 Worker 与 RAPID 入口迁移所需的统一请求/结果形状；非 fine、未支持退化任务和构型不匹配均在规划前结构化拒绝。现有旧入口暂未切换，下一步将删除其直接执行路径。
## 2026-08-26 — 将关节 Jog 入口切换到 Core

- 修改文件：`src/App.vue`、`UPDATE_LOG.md`。
- 修改原因：票据 01 要求离散关节目标和 Jog 通过唯一 `planMotion` 入口执行，入口不能直接把未验证目标交给 Runner。
- 修改内容：新增统一关节请求构造；手动输入、单步、连续 Jog、Home、机械零位和随机目标均先执行 Core 限位/数值校验，再提交 Core 返回的终点给现有 Runner；失败只记录结构化错误并保持当前运动。
- 修改影响：关节入口不再绕过 Core，模型与限位错误在运动启动前暴露；不改变 Runner 的播放生命周期。
## 2026-08-26 — 收紧 Core Cartesian 必填边界并保留数值输入即时呈现

- 修改文件：`src/robot-motion-core/planner.ts`、`src/App.vue`、`UPDATE_LOG.md`。
- 修改原因：纯 Core 契约要求 Cartesian/路径 intent 明确携带 Tool 与 WorkObject；数值关节输入原有即时呈现语义不能因接入 Core 被异步动画改变。
- 修改内容：缺少 Tool/WorkObject 的 Cartesian 请求统一返回 `unsupported-capability`；未知模型错误详情保持稳定最小字段；数值关节输入经 Core 校验后直接提交已验收终点。
- 修改影响：契约测试与原有页面 FK 展示语义保持一致，未改变关节步进 Runner 生命周期。
## 2026-08-26 — 将 Cartesian Worker 协议切换为 Core request/result

- 修改文件：`src/robotics/cartesian/worker/worker.ts`、`src/robotics/cartesian/worker/adapter.ts`、`UPDATE_LOG.md`。
- 修改原因：票据 04 要求常驻 Worker 只传输完整 Core 请求并原样返回结果，不能在 Worker 内重算 Cartesian 或补默认策略。
- 修改内容：Worker 现在只调用 `planMotion`；adapter 增加常驻通用 Core 队列、取消和生命周期管理，并将现有 Cartesian 调用转换为完整 Tool/WObj/策略 request 后消费 Core 结果。
- 修改影响：Worker 计算边界与 Core 统一，过期/取消仍由宿主 adapter 管理；页面现有 Cartesian 控制尚未完成 Coordinator 收口。
## 2026-08-26 — 完成 issue 01：最小 Core Contract 与关节入口

- 修改文件：`.scratch/robot-motion-core-refactor/issues/01-freeze-core-contract.md`、`src/robot-motion-core/planner.ts`、`src/robot-motion-core/contracts.test.ts`、`UPDATE_LOG.md`。
- 修改原因：issue 01 的 Core contract、关节入口切换、错误边界和编译验收已完成，需要在 tracker 中明确关闭，避免重复领取。
- 修改内容：将 `schemaVersion=1` 与 `modelRevision` 固定为必填；标记全部验收项完成并记录完成者；保留 Core 直调回归。
- 修改影响：issue 01 已完成并成为后续 02/04/05/13 的可用前置；不保留旧请求兼容字段。
## 2026-08-26 — 完成 issue 02：Cartesian 与 Gizmo 接入 Core

- 修改文件：`src/robot-motion-core/planner.ts`、`src/robot-motion-core/index.ts`、`src/App.vue`、`src/robotics/cartesian/index.ts`、`src/robotics/cartesian/worker/adapter.ts`、`.scratch/robot-motion-core-refactor/issues/02-strict-cartesian-gizmo.md`、`UPDATE_LOG.md`。
- 修改原因：普通 Cartesian、Gizmo 和 Worker 必须共享同一解析候选与结构化规划事实，入口不得直接调用旧 IK。
- 修改内容：增加统一 Cartesian request 构造；Gizmo 与同步 Cartesian fallback 通过 `planMotion`；App 默认 Worker 改为通用 Core adapter；移除 Cartesian index 的 Worker 专用公共导出。
- 修改影响：页面 Cartesian/Gizmo 的规划策略归一到 Core；严格路径不因入口差异静默降级。issue 02 已完成。
## 2026-08-26 — 完成 issue 03：奇异回退改为显式能力

- 修改文件：`src/robotics/cartesian/solution/waypoint-solver.ts`、`src/robotics/cartesian/solution/waypoint-types.ts`、`UPDATE_LOG.md`。
- 修改原因：机械零位不能隐式授权姿态放宽；奇异路径必须由显式 `wrist-interpolation`/`SingArea\\Wrist` intent 触发。
- 修改内容：移除基于型号机械零位邻域的自动 wrist 回退，保留显式策略下的位置、关节限位、连续性和终点检查；更新选项契约说明。
- 修改影响：普通 Cartesian/Gizmo/MoveL 不会因起始位置自动降级；显式奇异能力仍返回实际姿态残差。issue 03 已完成。
## 2026-08-26 — 收紧腕部验收为安全能力边界

- 修改文件：`src/robotics/cartesian/abb-wrist-interpolation.test.ts`、`UPDATE_LOG.md`。
- 修改原因：现有实现未取得足够证据宣称 RobotStudio 逐样本姿态峰值等价，原测试却硬编码 `1.9°–2.2°` 控制器曲线。
- 修改内容：将回归名称和断言改为显式腕部退化能力：TCP 误差、终点姿态恢复、关节分支与有限姿态残差；保留小于 `2.2°` 的安全窗口。
- 修改影响：测试与 issue 03 的“不宣称逐样本等价”边界一致，不放宽位置/限位/连续性约束。
## 2026-08-26 — 收紧 Core 路径契约并统一 Tool/WObj 几何

- 修改文件：`src/robot-motion-core/planner.ts`、`src/robot-motion-core/contracts.test.ts`、`UPDATE_LOG.md`。
- 修改原因：Core 的 Cartesian/Linear/Circular intent 仍允许缺省 Tool/WObj，路径规划也没有在统一核心中完整应用工作坐标与工具坐标。
- 修改内容：将 Tool/WObj 和 `current-main` 构型策略改为显式必填；路径结果增加姿态残差；线性路径使用世界 TCP 起点及工具逆变换；圆弧入口统一应用工件坐标和工具坐标；补齐契约测试请求。
- 修改影响：缺少必要纯数据时在进入 IK 前返回结构化 invalid-request；自定义 Tool/WObj 的 Core 路径不再绕过坐标变换；TypeScript 检查通过。
## 2026-08-26 — 完成 issue 04 并收紧 Coordinator 计划边界

- 修改文件：`src/robotics/cartesian/worker/adapter.ts`、`src/robotics/cartesian/worker/adapter.test.ts`、`src/application/motion-coordinator.ts`、`src/application/motion-coordinator.test.ts`、`src/robot-motion-core/index.ts`、`src/robotics/cartesian/solution/waypoint-types.ts`、`src/application/cartesian-control.ts`、`src/App.vue`、`.scratch/robot-motion-core-refactor/issues/04-worker-core-transport.md`、`UPDATE_LOG.md`。
- 修改原因：Worker 新请求未及时取代活动请求，且 Cartesian 结果在进入 Coordinator 前可能被宿主伪造成 waypoint 计划。
- 修改内容：Worker 只保留最新请求并复用常驻实例；Coordinator 拒绝缺少 Core `timeMs=0`/单调时间语义的宿主计划；Cartesian 结果保留 Core 原始计划并由 App 直接提交；补齐 Worker 和 Coordinator 回归。
- 修改影响：取消、抢占和过期结果不再阻塞后续规划；伪造或不完整计划不会触发 Runner；issue 04 已完成，类型检查和定向测试通过。
## 2026-08-26 — 完成 issue 06：连续 Jog 先提交成功计划再消费队列

- 修改文件：`src/application/cartesian-control.test.ts`、`.scratch/robot-motion-core-refactor/issues/06-continuous-jog-flow.md`、`UPDATE_LOG.md`。
- 修改原因：连续规划测试仍要求丢弃当前成功计划，与冻结的轨迹接续语义相反。
- 修改内容：将回归断言改为当前 generation 的成功 waypoint 先提交，随后处理最新排队目标；保留旧结果、松开和 generation 防护。
- 修改影响：慢规划期间有效轨迹不会饿死，连续输入按顺序向前接续；issue 06 已完成。
## 2026-08-26 — 完成 RAPID MoveJ/MoveL/MoveC 与 ConfJ/ConfL/SingArea 收口

- 修改文件：`src/rapid/planning/core-motion.ts`、`src/rapid/planning/movej-planner.ts`、`src/rapid/planning/movel-planner.ts`、`src/rapid/planning/movec-planner.ts`、`src/rapid/data/instruction-types.ts`、`src/rapid/language/parser/rapid-parser.ts`、`src/rapid/language/parser/pending-types.ts`、`src/rapid/language/parser/control-flow.ts`、`src/rapid/language/parser/index.ts`、`src/rapid/language/index.ts`、`src/rapid/execution/motion-execution.ts`、`src/application/program-control.ts`、`src/application/program-control.test.ts`、`src/App.vue`、`.scratch/robot-motion-core-refactor/issues/07-rapid-movej-confj.md`、`.scratch/robot-motion-core-refactor/issues/08-teaching-confdata-roundtrip.md`、`.scratch/robot-motion-core-refactor/issues/09-rapid-movel-strict-fine.md`、`.scratch/robot-motion-core-refactor/issues/10-reject-flyby-zones.md`、`.scratch/robot-motion-core-refactor/issues/11-rapid-movel-confl-singarea.md`、`.scratch/robot-motion-core-refactor/issues/12-rapid-movec.md`、`UPDATE_LOG.md`。
- 修改原因：RAPID 规划入口仍可直接调用旧 Cartesian IK，运行时也没有显式 ConfJ/ConfL 状态。
- 修改内容：新增纯 Core request 转换、统一错误映射、Tool/WObj 与 robconf 转换；MoveJ/MoveL/MoveC 均调用 `planMotion`；parser/executor 增加 `ConfJ\\On/Off`、`ConfL\\On/Off`，并在程序开始及 PP to Main 重置为 ABB 默认；示教目标从当前关节推导 confdata；Core 圆弧复用三点圆弧采样并限制采样预算；RAPID 轨迹保留 Core 原始计划传给 Coordinator。
- 修改影响：非 fine zone、退化圆弧、未支持构型在运动前统一失败；严格姿态与显式 `SingArea\\Wrist` 的错误和残差分类一致；定向 RAPID/Core/Worker/Jog 测试及 TypeScript 检查通过。
## 2026-08-26 — 完成 issue 13–16：错误呈现、观测日志与跨入口收口

- 修改文件：`src/application/motion-errors.ts`、`src/application/motion-coordinator.ts`、`.scratch/robot-motion-core-refactor/issues/13-core-motion-errors.md`、`.scratch/robot-motion-core-refactor/issues/14-host-motion-error-presentation.md`、`.scratch/robot-motion-core-refactor/issues/15-motion-observability.md`、`.scratch/robot-motion-core-refactor/issues/16-cross-entry-conformance.md`、`UPDATE_LOG.md`。
- 修改原因：Core 错误与宿主文案、取消生命周期、关联日志需要明确分层，避免把 UI/控制器字段污染纯计算结果。
- 修改内容：新增稳定 `MotionError` 到中文短文案/恢复建议映射；Coordinator 日志增加 request id、generation、阶段、结果和耗时；保留 Worker/RAPID 源码范围在宿主层；完成跨入口票据状态。
- 修改影响：Core 结果保持可序列化且不含宿主生命周期信息；错误呈现和开发诊断分层；完整收口票据已标记完成，待最终 lint/build 验证。
## 2026-08-26 — 移除 Core 对 RAPID 圆弧实现的反向依赖

- 修改文件：`src/robot-motion-core/arc-geometry.ts`、`src/robot-motion-core/planner.ts`、`src/rapid/planning/movec-planner.test.ts`、删除 `src/rapid/planning/arc-geometry.ts`、`UPDATE_LOG.md`。
- 修改原因：最终分层审查发现纯数据 `robot-motion-core` 仍从 RAPID 规划目录导入圆弧数学，违反 Core 不依赖 RAPID 运行时/目录的契约。
- 修改内容：将三点定圆、圆弧采样和弧长计算迁入 Core；Core Planner 改为相对路径引用；MoveC 几何回归直接引用 Core 实现；移除 RAPID 目录中的重复实现。
- 修改影响：Core 与 RAPID 依赖方向保持单向，MoveC 仍使用同一圆弧算法，退化圆弧和姿态插值行为不变；不新增兼容包装或运行时入口。
## 2026-08-26 — 收拢 Gizmo 与数字关节输入的 Coordinator 执行权

- 修改文件：`src/App.vue`、`UPDATE_LOG.md`。
- 修改原因：最终交付审查发现 Gizmo 拖拽和数字关节输入虽已调用 Core，却仍直接写入共享关节或直接停止 Runner，未完全满足 issue 05 的单一控制权和 issue 16 的跨入口一致性要求。
- 修改内容：数字关节输入改为提交 Core 计划到 Coordinator（1ms 缓动保持近似即时语义）；Gizmo 成功计划改由 Coordinator 以统一轨迹入口执行；Gizmo 拖拽开始改由 Coordinator 停止当前运动；同步更新入口职责说明。
- 修改影响：所有手动运动入口均经过同一抢占、版本和 Runner 提交语义，不再存在 App 直接写关节的运动路径；不改变 Core 规划算法或 RAPID 行为。
## 2026-08-26 — 保留数字关节输入的同步语义并纳入 Coordinator

- 修改文件：`src/application/motion-coordinator.ts`、`src/application/motion-coordinator.test.ts`、`src/App.vue`、`UPDATE_LOG.md`。
- 修改原因：首次将数字输入改为 1ms 缓动后，现有 UI 契约要求调用后立即反映关节值，下一帧才更新会造成可见延迟。
- 修改内容：为 Coordinator 增加显式 `immediate` 提交模式和 `runImmediate` seam；数字输入通过 Core 计划后由 Coordinator 同步提交；新增 Coordinator 回归测试。
- 修改影响：数字输入恢复原有即时显示，同时不恢复 App 直接写关节的绕过路径；Gizmo、数字输入、JOG 和 RAPID 继续共享 Coordinator 抢占与版本语义。
## 2026-08-26 — 增加宿主错误呈现回归

- 修改文件：`src/application/motion-errors.test.ts`、`UPDATE_LOG.md`。
- 修改原因：最终交付审查需要直接验证 issue 14 的 Core 错误到宿主中文文案、恢复建议和字段隔离契约，而不能只依赖调用处存在映射函数。
- 修改内容：覆盖腕部奇异文案与 SingArea\\Wrist 恢复建议，并验证 fly-by 能力错误呈现不会修改 Core 的 `code/category/details`。
- 修改影响：增强宿主错误呈现的回归保护，不改变运行时错误契约或用户界面结构。
## 2026-08-26 — 运动 Core 双轴审查与 RobotStudio 普通工作区真实轨迹复放

- 修改文件：`.scratch/robotstudio-oracle/workspace-trajectories-20260826/WorkspaceTrajectoryOracle.mod`、`.scratch/robotstudio-oracle/workspace-trajectories-20260826/core-comparison.test.ts`、`.scratch/robotstudio-oracle/workspace-trajectories-20260826/run-001/*`、`UPDATE_LOG.md`。
- 修改原因：需要对提交 `a0d0941` 相对父提交 `b9f3b47` 的 16-ticket 运动 Core 重构做规范/需求双轴审查，并用新增 RobotStudio 控制器轨迹验证 Core、J1–J6 分支和场景映射，避免只依赖既有文档或旧测试。
- 修改内容：
  1. 按 `code-review` 分离规范与需求审查；确认 5 项规范问题和 6 项需求问题，重点包括 fly-by 未在整段程序启动前拒绝、MoveJ required robconf 未参与候选选择、MoveC 时长错误、Core 错误被 RAPID 旧枚举改写、日志关联不完整及公开无调用退化 intent。
  2. 使用 RobotStudio 26.2 / RobotWare 6.16.0.3 的虚拟控制器 `Controller1/T_ROB1`，从固定种子 `[20,-30,40,15,30,-25]` 采集 `JointAllAxes`、三方向 MoveL 与 XY 半圆 MoveC，共 1226 个 PC SDK 原始样本；全部例程被控制器接受并正常停止。
  3. 将新增 MoveAbsJ/MoveL/MoveC CSV 直接输入当前 `planMotion`；六轴关节终点保持 RobotStudio 的 J1–J6 顺序与数值，四条 Cartesian 路径按 TCP 几何最近点比较后均保持同一分支，单轴最大误差不超过 `0.4315°`，TCP 配对距离不超过 `0.9658 mm`。
  4. 增加速度语义诊断：80 mm / v50 MoveL 返回 `1620 ms`（接近几何基准 `1600 ms`，但实现仍依赖 waypoint 数量）；半径 40 mm 的 v50 MoveC 半圆返回 `440 ms`，与弧长基准 `2513 ms` 明显不符。
  5. 实验后精确卸载临时模块；最终状态恢复为 Auto、MotorsOn、RAPID Stopped、任务 Ready，模块集恢复为 `{user, BASE}`，未遗留自动化服务。
- 修改影响：未修改生产代码或现有产品测试；新增原始证据和诊断测试保存在 `.scratch`。审查结论表明几何路径与六轴分支在本次普通工作区样本上正确，但提交不能判定为完全符合 16 张 issue，尤其 MoveC 时间语义和 fly-by 启动前拒绝仍需修复。
- 验证：`npm run check`、`npm run lint`、`npm run lint:style`、`npm run test`（70 files / 591 tests）、关键运动与 FBX 六轴测试（9 files / 74 tests）、`npm run build`、`git diff --check` 全部通过；新增真实六轴/轨迹对比 5/5 通过，新增时长规格诊断 0/2 通过（预期暴露上述缺陷）。

## 2026-08-26 — 修复 Core 构型筛选、Tool/WObj 契约与几何时长

- 修改文件：`src/robot-motion-core/planner.ts`、`src/robot-motion-core/index.ts`、`src/robotics/cartesian/candidate-path-planner.ts`、`src/robotics/cartesian/path-planner.ts`、`src/robotics/cartesian/solution/waypoint-solver.ts`、`src/robotics/cartesian/solution/waypoint-types.ts`、`src/rapid/planning/core-motion.ts`、`src/rapid/planning/motion-input.ts`、`src/rapid/planning/movej-planner.ts`、`src/rapid/planning/movel-planner.ts`、`src/robot-motion-core/contracts.test.ts`。
- 修改原因：审查发现 required robconf 只在规划结束后比对、Tool/WObj 缺失时静默回退身份帧、MoveL/MoveC 时长依赖 waypoint 数量，且退化 IK 仍暴露为公共 intent。
- 修改内容：Core 候选图支持 requiredConfiguration；Cartesian/Linear/Circular 请求均严格要求 fine zone 与完整 Tool/WObj 帧；删除 DegenerateIkIntent 公共类型并将运行时未知 intent 归为 invalid-request；MoveL/MoveC 按 TCP 累计几何长度 retime，MoveJ 使用 Core 计划时长；RAPID 错误保留 Core 原始 `coreError`；型号/版本改用 Core 单一事实源。
- 修改影响：目标构型在 IK 候选阶段即被约束，缺失帧不会进入 FK/IK，真实路径时长与速度/几何长度一致；不改变 KUKA 运动行为。
- 验证：`npm run check` 通过。

## 2026-08-26 — 完成全量回归与生产构建验证

- 修改文件：`UPDATE_LOG.md`。
- 修改原因：本轮 Core、RAPID、程序控制与范围收敛修复完成后，需要记录最终验证结果。
- 修改内容：全量 `npm run test` 通过（70 files / 593 tests）；`npm run check`、`npm run lint`、`npm run lint:style`、`npm run build` 均通过；RobotStudio 真实轨迹对比测试 7 项通过。
- 修改影响：确认修复未破坏现有 UI、解析器、Runner、KUKA 结构和 ABB 真实轨迹回归；构建仅保留既有大 chunk 警告。

## 2026-08-26 — 最终门禁复核

- 修改文件：`UPDATE_LOG.md`。
- 修改原因：记录本轮最后一次完整验证，确保交接时结果与工作区一致。
- 修改内容：再次确认 `npm run check`、`npm run test`（70 files / 593 tests）、RobotStudio 真实轨迹 7 项、`npm run lint`、`npm run lint:style`、`npm run build` 和 `git diff --check` 全部通过。
- 修改影响：当前工作区无编译、测试、静态检查或构建失败；Vite 仅报告既有大 chunk 提示。

## 2026-08-26 — 对齐 RAPID fly-by 解析注释与启动语义

- 修改文件：`src/rapid/language/parser/rapid-parser.ts`、`src/rapid/language/parser/rapid-parser-corpus.test.ts`、`src/rapid/language/parser/rapid-parser-motion-diagnostics.test.ts`、`src/rapid/language/parser/rapid-parser.test.ts`、`UPDATE_LOG.md`。
- 修改原因：旧注释仍描述 fly-by 会以安全停点执行，与当前“解析合法、程序启动前统一拒绝”的实现不一致。
- 修改内容：仅更新解析器和回归测试注释/标题，明确能力拒绝发生在启动预检层。
- 修改影响：不改变解析或运行逻辑，消除错误使用指引。
- 验证：`npm run check`、解析器 3 文件 41 项测试和 `git diff --check` 通过。

## 2026-08-26 — 补齐预检、构型和 Coordinator 回归测试

- 修改文件：`src/application/program-control.test.ts`、`src/application/motion-coordinator.test.ts`、`src/rapid/planning/movej-planner.test.ts`、`src/rapid/planning/movel-planner.test.ts`、`UPDATE_LOG.md`。
- 修改原因：修复后需要把新规范固定成自动化回归，避免旧的 fly-by 可执行断言、未取整时长断言和错误 robconf 夹具掩盖真实行为。
- 修改内容：新增启动前 fly-by 零运动断言、Coordinator 三阶段同 requestId 断言、非零 required robconf 真实 FK 目标断言；更新毫秒取整容差和 fly-by 失败预期。
- 修改影响：测试集直接覆盖本次修复的执行边界、构型筛选和日志关联契约。
- 验证：`npm run check` 与相关 45 项测试通过。

## 2026-08-26 — 保证 Core 几何重定时满足严格递增时间契约

- 修改文件：`src/robot-motion-core/planner.ts`、`UPDATE_LOG.md`。
- 修改原因：纯姿态或极短路径在毫秒取整后可能出现相邻 waypoint 同时刻，Coordinator 会按契约拒绝该计划。
- 修改内容：重定时总时长至少覆盖 waypoint 间隔数，并对取整时间施加 waypoint 序号下限，保持严格递增整数时间。
- 修改影响：短路径仍按几何速度标定；在不可避免的毫秒精度场景下保证计划可提交。

## 2026-08-26 — 删除 RAPID 层失效的旧时长工具

- 修改文件：`src/rapid/planning/motion-input.ts`、`UPDATE_LOG.md`。
- 修改原因：`simulateDurationMs` 已无生产调用，且按未变换目标计算距离，保留会形成第二套错误时长语义。
- 修改内容：删除该死代码及其模型类型依赖，MoveJ/MoveL 统一读取 Core 计划终点时间。
- 修改影响：RAPID 规划层不再存在可绕过 Tool/WObj 几何处理的旧时长入口。

## 2026-08-26 — 加强 Core 跨 JSON/Worker 的运行时契约校验

- 修改文件：`src/robot-motion-core/planner.ts`、`UPDATE_LOG.md`。
- 修改原因：跨边界请求可能绕过 TypeScript 类型，未知构型策略或错误 Tool/WObj 标志会在规划阶段产生未定义行为。
- 修改内容：增加 robconf 有限性、构型策略枚举、Tool/WObj 支持标志和 zone/speed 运行时检查，统一返回结构化 `invalid-request` 或 `unsupported-capability`。
- 修改影响：非法外部请求在 FK/IK 前确定性失败，不引入静默降级。

## 2026-08-26 — 收回非本次任务所需的 KUKA 公开重导出

- 修改文件：`src/application/joint-control.ts`、`src/application/joint-control.test.ts`、`src/application/cartesian-control.test.ts`、`src/components/JointControlPanel.test.ts`、`src/scene/kuka-scene.ts`、`src/robot-models/kuka-like/kinematics/legacy-forward-kinematics.test.ts`、`src/robotics/inverse-kinematics/numerical-ik.test.ts`、删除 `src/robot-models/kuka-like/index.ts`、`UPDATE_LOG.md`。
- 修改原因：规范审查指出 ABB 任务不应新增 KUKA 模块公开接缝。
- 修改内容：KUKA 调用点恢复直接引用既有 `parameters.ts`、`legacy-forward-kinematics.ts` 和 `kuka-robot-model-adapter.ts`，移除仅用于重导出的 KUKA index 文件。
- 修改影响：KUKA 实现、参数和运行行为不变，缩小本次变更范围。
- 验证：`npm run check` 通过。

## 2026-08-26 — 修正文档化构型筛选语义

- 修改文件：`src/robotics/cartesian/candidate-path-planner.ts`、`UPDATE_LOG.md`。
- 修改原因：required robconf 实际只约束路径终点，中间 waypoint 必须允许从当前构型连续过渡，注释不能误写成整条路径锁定。
- 修改内容：将候选图选项注释明确为“终点 waypoint 构型筛选”，与实现和 RAPID 语义一致。
- 修改影响：仅澄清维护约束，不改变运行逻辑。

## 2026-08-26 — 校准 RobotStudio 时长断言的采样误差容差

- 修改文件：`.scratch/robotstudio-oracle/workspace-trajectories-20260826/core-comparison.test.ts`、`UPDATE_LOG.md`。
- 修改原因：RobotStudio 控制器静态采样起点与 Core 固定关节种子存在约毫米级 FK 差异，导致几何时长与理论值出现 2ms 取整偏差；严格相等会把采样误差误报为实现错误。
- 修改内容：直线 80mm/50mm·s⁻¹ 与半圆弧长时长断言改为 ±10ms 的证据容差，仍能区分 waypoint 数量计时与几何长度计时。
- 修改影响：真实轨迹诊断测试反映控制器采样不确定性，不放宽生产规划逻辑。

## 2026-08-26 — 修复 RAPID 启动前 zone 预检与 Coordinator 请求关联

- 修改文件：`src/application/program-control.ts`、`src/rapid/execution/program-executor.ts`、`src/application/motion-coordinator.ts`、`src/application/motion-coordinator.test.ts`、`src/App.vue`、`UPDATE_LOG.md`。
- 修改原因：程序原先逐条执行，fly-by 可能在前序运动后才失败；Coordinator 的 commit 成功路径没有独立 requestId/开始时间，完成日志还读取可变全局请求号；暂停/继续能力也不应出现在程序级 Coordinator 公共接口。
- 修改内容：启动前扫描已解析程序并拒绝所有非 fine zone，错误带精确指令索引/源码范围；ProgramError 保留 Core `coreError`；Coordinator 为 submit/commit 分配稳定请求号和开始时间，记录 `runner-start`/`runner-completed` 阶段；移除 Coordinator 的 pause/resume/status seam；App 改用 Core 版本事实源。
- 修改影响：非支持运动不会产生任何前置运动；运行日志可把规划、Runner 开始和完成关联到同一请求；不改变 MotionRunner 内部能力或 RAPID 语法解析。
- 验证：`npm run check` 通过。

## 2026-08-27 — 制定运动 Core 收口与 RAPID 可扩展架构策略

- 修改文件：`.scratch/wayfinder/final-motion-and-rapid-refactoring-strategy-2026-08-27.md`、`UPDATE_LOG.md`。
- 修改原因：全面架构复核确认当前功能已稳定，但 Core 仍依赖宿主运动实现、规划入口和连续 Jog 生命周期尚未完全收口；同时后续增加复杂 RAPID 语法需要稳定扩展位置，避免继续扩大中央 parser 和 ProgramController。
- 修改内容：给出独立 Core package、Coordinator 唯一 Worker/Runner 所有权、四类运动入口垂直迁移、旧接口删除、RAPID language kernel/中立 IR/显式扩展 registry/受限 capability port、叶子指令与结构语法分级、七阶段无兼容迁移、静态架构门禁、测试矩阵及完成定义。
- 修改影响：仅新增架构与实施方案，不修改生产代码、运行行为或现有测试；后续实施应以该文档的单向依赖和删除门槛为准。
- 验证：文档结构与本地引用已复核；`git diff --check`、`npm run check` 通过。

## 2026-08-27 — 根据独立反过度设计审核重写收缩版重构策略

- 修改文件：`.scratch/wayfinder/minimal-motion-and-rapid-refactoring-strategy-2026-08-27.md`、`.scratch/wayfinder/final-motion-and-rapid-refactoring-strategy-2026-08-27.md`、`UPDATE_LOG.md`。
- 修改原因：独立 `gpt-5.6-sol / medium` 审核确认原方案运动侧合理，但通用 RAPID plugin、generic payload IR、capability manifest、版本化 registry、预建 IoPort 与立即 workspace 拆包缺少第二消费者，存在为了未来扩展而提前建设平台的问题。
- 修改内容：新方案收缩为 RobotMotionCore、MotionCoordinator、RapidRuntime 三个真实深 module；保留强类型 RAPID 判别联合，将物理拆包、pause/resume、Timer/Io port 和内部 registry 推迟到真实需求出现；把七阶段迁移压缩为 Core、Coordinator、四入口、runtime/host 四批，并补充删除清单、静态门禁、测试矩阵和未来扩展决策表。旧方案保留为审计记录并标记已被替代。
- 修改影响：仅重写架构与实施方案，不修改生产代码和运行行为；后续实施以收缩版方案为唯一正式依据。
- 验证：收缩版文档层级、旧方案替代链接与本地引用已复核；`git diff --check`、`npm run check` 通过。

## 2026-08-27 — 实施收缩版运动与 RAPID 架构方案

- 修改文件：`src/application/motion-coordinator.ts`、`src/application/motion-coordinator.test.ts`、`src/application/motion-requests.ts`、`src/application/cartesian-control.ts`、`src/application/cartesian-control.test.ts`、`src/application/cartesian-jog-session.ts`、`src/application/cartesian-jog-session.test.ts`、`src/App.vue`、`src/application/program-control.ts`、`src/application/program-control.test.ts`、`src/rapid/execution/motion-execution.ts`、`src/rapid/runtime/rapid-runtime.ts`、`src/rapid/runtime/index.ts`、`src/rapid/runtime/rapid-runtime.test.ts`、`src/rapid/language/features/README.md`、`src/rapid/runtime/features/README.md`、`src/rapid/planning/motion-requests.ts`、`src/rapid/planning/motion-requests.test.ts`、`src/rapid/planning/motion-input.ts`、`src/robot-motion-core/index.ts`、`src/robotics/cartesian/worker/adapter.ts`、`src/robotics/cartesian/worker/adapter.test.ts`、`src/robotics/cartesian/index.ts` 及相关测试文件。
- 修改原因：按收缩版方案消除 `commitPlan`、RAPID `corePlan` 和 MoveJ/MoveL/MoveC 多套规划入口，修复空 waypoint 进入 Runner 导致程序卡死的路径，并将 RAPID 语言语义从 Vue host 移出。
- 修改内容：
  1. Coordinator 仅公开 `submit/stop/dispose`，统一规划、计划最小验收、Runner 结算、source 清理和规划器异常处理；单 waypoint 计划直接结算，不再把空数组交给 Runner。
  2. Joint、Cartesian、Gizmo、RAPID 使用 `MotionPlanningRequest`；App 不再直接调用 `planMotion` 或 `commitPlan`。Worker adapter 只保留 active request 和 requestId 生命周期，不维护业务 future queue。
  3. 删除 RAPID 旧 `planMoveJ/planMoveL/planMoveC` 及重复测试入口；新增 `buildRapidMotionRequest` 与 Core request 测试，禁止缺计划时降级为 joint-target。
  4. 新增无 Vue 的 `RapidRuntime`，承接表达式、赋值、IF/WHILE/FOR/EXITDO、SingArea/ConfJ/ConfL 与 MotionPort 分派；ProgramController 仅保留源码解析、PP/off-path、编辑历史和快照投影。
  5. 收紧 Core barrel，不再公开宿主 request helper；删除 Cartesian barrel 的业务规划重导出；删除 Cartesian Jog session 的空 `request/rollback` 接口；为未来叶子语法建立显式 feature 目录说明，不提前建设通用插件协议。
  6. 新增静态架构门禁，锁定生产代码无旧双轨入口、`planMotion` 调用边界、RapidRuntime 无 Vue 依赖和 Core barrel 公开面。
- 修改影响：程序运动规划失败、Worker 异常和 Runner 异常均回到可观察的失败/停止态；空轨迹不再触发 `startTrajectory` 异常卡死；运行语义可脱离 Vue 单独测试；现有 ABB/KUKA 数值算法保持不变。
- 验证：`npm run check` 通过；`npm test -- --run` 通过（67 files / 534 tests）；`npm run build` 通过（仅保留既有大 chunk 提示）；新增架构门禁 4/4、RapidRuntime/request 测试 2/2、RobotStudio 既有普通工作区对照 7/7 通过。RobotStudio 只执行了只读 Inspect，确认 `Controller1/T_ROB1` 为虚拟控制器、RobotWare 6.16.0.3、Auto、MotorsOn、RAPID Stopped、Task Ready；本轮未在未获得当前请求明确变更授权时上传或运行控制器程序。
