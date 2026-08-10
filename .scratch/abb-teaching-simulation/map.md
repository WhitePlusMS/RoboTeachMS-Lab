# 需求二：ABB 1200 教学型编程仿真路线地图

Status: open
Label: wayfinder:map

## Destination

在独立仓库 ABB-Robot-Programming-Lab 内，把现有 KUKA 六轴仿真骨架演进为一个 ABB IRB 1200 的 RAPID 兼容仿真 MVP：复用现有正解、逆解和关节过渡能力，按 ABB 公开的指令、数据类型和运动语义实现浏览器内解释执行；面向 ABB 程序开发人员和学习者提供尽可能接近真实 RAPID 的代码、点位、轨迹和失败反馈。它不承诺可直接下发 ABB 示教器。C# 迁移在 TypeScript 行为和数据契约稳定后再开始。

## Notes

- 领域：工业机器人运动学、离线示教、教学型程序解释执行。
- 当前基线：仓库已有 KUKA 场景、关节/笛卡尔控制、正逆解、运动过渡、坐标辅助和轨迹显示。
- 工作原则：先解决决定性问题，再执行；保持独立仓库；不把当前父项目作为运行时依赖；不提前建设多品牌库、完整 RAPID 编译器或 C# 双线实现。
- 本地图使用 wayfinder、grilling、domain-modeling；涉及架构时补充 codebase-design；需要外部厂商资料时使用 research。
- 目标用户同时包括 ABB 程序开发人员和学习者；浏览器仿真应优先忠实表达公开的 RAPID 语法和运动语义，而不是擅自简化成教学专用指令。

## Decisions so far

<!-- 已确认的终点写在 Destination；关闭的决策票才进入这里。 -->

- [确定 ABB RAPID 运动指令子集与仿真语义](issues/03-movej-movel-semantics.md) — 首期实现 MoveJ/MoveL，复用现有正逆解和 MotionRunner；MoveL 增加路径采样与完成通知编排；保留 RAPID 数据结构及 fine/zone 可观察语义，但不复制 ABB 控制器。
- [确定教学程序文本与编辑器边界](issues/04-teaching-program-representation.md) — RAPID 文本是源头，解析为 AST 后在浏览器内存中执行；首期支持程序调试和示教点位，不做 localStorage、本地文件保存或导入导出。

## Not yet specified

- ABB IRB 1200 的具体变体、三维模型来源、DH/关节范围资料及模型节点命名。
- 机器人 profile 的字段、单位、基坐标/工具坐标约定，以及 profile 与现有 RobotModel interface 的关系。
- MoveJ/MoveL 的具体 RAPID 语法字段、解析校验和编辑器错误呈现。
- MoveL 路径采样、程序指针/运动指针、暂停/停止/错误恢复的具体执行模型。
- MoveC、MoveAbsJ 及其他 RAPID 运动指令何时毕业进入后续阶段。
- 程序文本、点位表、编辑器和解释执行器之间的最小数据模型。
- 轨迹采样、暂停/停止/重置、单步执行和错误定位的可观察行为。
- Circle 是否进入下一阶段，以及工具、工件坐标系和多机器人 profile 的毕业条件。
- TypeScript 到 C# 的迁移边界、共享测试向量和交付形式。

## Out of scope

- 首期直接在 ABB 示教器或控制器上运行的文件格式兼容。
- 首期完整 RAPID 编译器、语法覆盖和控制器通信。
- 首期多品牌机器人库、用户自定义机器人配置页面和在线模型市场。
- 首期 C# 与 Vue3 并行实现。
- 原始教学项目中的相机、抓取、码垛和课程内容迁移；这些不属于本目的地。
