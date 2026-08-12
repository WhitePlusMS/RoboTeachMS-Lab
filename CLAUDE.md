# ABB Robot Programming Lab 代理约束

## 项目事实

- 这是 Vue 3 + Vite + TypeScript + Three.js 的 ABB IRB 1200 教学仿真前端，不是 React 项目。
- ABB 运动学、RAPID 解析、程序执行和教学判断位于 `src/robotics`、`src/rapid` 与 `src/application`；Three.js 只负责场景显示和真实 TCP 轨迹采样。
- KUKA 代码保留为后续多厂商扩展位置，除非任务明确要求，不删除、不改写 KUKA 模块。
- RAPID 的 Program Data 必须从同一次 parser 结果派生，不建立第二份点位存储或平行 parser。

## 修改原则

- 遵循最简实现、单一职责和严格 TypeScript 类型；禁止 `any`、无依据的兼容层和重复状态。
- 先阅读相关文件和票据，再修改；优先修复编译错误，不把问题归因于缓存。
- 修改前说明原因；每次代码变更都在根目录 `UPDATE_LOG.md` 记录文件、原因和影响。
- 程序运行期间 RAPID 源码只读；停止后结构化编辑必须通过 `controlled-rapid-edit.ts`，并保留准确源码范围。
- ABB 程序控制只提供运行、单步、停止、PP to Main；不要重新引入独立暂停/继续入口。
- 不启动用户维护的 dev server；任务结束时终止本次启动的临时服务。

## 验证

- 修改后先运行 `npm run check` 或针对性测试；完成前运行一次完整测试和构建。
- 使用 `git diff --check` 检查空白；不要未经用户明确要求提交无关文件或删除 KUKA 预留。

## 文档与票据

- 实施票据位于 `.scratch/abb-teach-target-and-observe/implementation/issues/`。
- 代码变更日志唯一写入 `UPDATE_LOG.md`；调研和中间产物放在对应 `.scratch` 或 `docs` 目录。
