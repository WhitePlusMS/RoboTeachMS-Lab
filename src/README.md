# Web 源码导航与命名约定

目录按共同维护的职责划分；文件按对象与实际工作命名。文件少不是自动合并的理由，文件长也不是自动拆分的理由。

| 目录 | 负责什么 | 从哪里开始读 |
| --- | --- | --- |
| application | Web 状态、用户命令、程序会话和唯一运动控制权 | use-robot-controller.ts；motion/motion-coordinator.ts |
| components | Vue 面板与交互展示 | jog/；program/ |
| scene | 三维生命周期、模型显示、拖拽、ABB 场景坐标适配 | abb-scene.ts；abb-coordinate-conversion.ts |
| rapid/language | 词法、语法、类型诊断；parser/ 中是具体语句解析 | parser/rapid-parser.ts |
| rapid/data | RAPID 值对象、系统数据和目标运算 | records.ts；target-operations.ts |
| rapid/motion | RAPID 参数校验和核心请求转换 | rapid-motion-request.ts |
| rapid/runtime | 指令解释、程序指针和执行状态机 | rapid-runtime.ts；program-executor.ts |
| rapid/editing | 受控源码编辑、示教与指令修改 | controlled-rapid-edit.ts |
| robot-motion-core | 独立规划、时间分配和播放 | index.ts；motion-planner.ts |
| robot-geometry | 通用机器人契约、矩阵、IK 候选和求解 | robot-types.ts；math/；ik/ik-solver.ts |
| robot-models | 机型参数、FK/解析 IK、构型和视觉配置 | registry.ts；abb-irb1200/profile.ts |
| infrastructure/motion-worker | 同步/Worker 规划传输 | motion-planner-client.ts；worker.ts |
| architecture、testing | 跨层约束与测试基础设施 | architecture-gates.test.ts；manual-motion-clock.ts |
| theme | 视觉设计令牌 | 按页面/场景对应文件查找 |

## 关键调用链

手动 Jog / Gizmo 或 RAPID 指令 → MotionCoordinator → MotionPlannerClient → planMotion → 带时间的关节计划 → 同一 Runner → 唯一机器人状态 → UI 和三维显示。

RAPID 先由 parser 解析，再由 runtime 执行；`rapid/motion` 只把指令转换成核心请求。关节 Jog 已知目标关节，不求逆解。笛卡尔 Jog 和 RAPID MoveL 共用直线路径规划。MoveJ 在终点求逆解后走关节路径。

## 新文件放置规则

- 一级目录表达稳定职责。子目录应表达真实子系统、机型资产或独立运行入口；不再创建只有占位说明的 features/ 或无封装作用的 internal/solution/。
- Vue 组合函数采用 `use-对象.ts`，如 use-robot-state、use-cartesian-jog、use-program-session。普通函数不加 use。
- 文件采用 kebab-case；名称描述工作，例如 rapid-motion-request、joint-trajectory-sampler、tcp-trace-buffer。类型文件包含对象名称。
- parser 表示读语法，lowering 表示转换执行结构，request 表示输入转换，runner 表示时间推进，trace 表示历史显示记录。不要混用这些角色。
- 同一机型目录中的 profile.ts、parameters.ts 保持对称命名；跨域容易混淆的文件加对象前缀。
- index.ts 用于稳定公开入口，不为小目录增加转发链；内部实现直接引用具体文件。
- 单元测试与实现相邻，架构测试独立。测试移动时保留原有行为断言与依赖方向约束。

## 保留的小目录与文件

Worker 有独立加载入口，theme/testing 有明确职责，即使文件少仍保留。cartesian/path-limits.ts 是多个算法共用的路径约束，保留一份真源。KUKA-like 保留用于历史场景和通用数值 IK 测试，手动关节工具必须显式接收实际机型限位。

当前只装配一个 ABB 机型，界面没有机型选择器。Unity DLL 交付目录独立维护，本轮目录迁移只针对 Web。
