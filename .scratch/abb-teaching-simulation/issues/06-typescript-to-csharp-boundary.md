# 06 — 确定 TypeScript 到 C# 的迁移边界

Type: grilling
Status: open
Blocked by: 02, 03, 05
Part of: ../map.md

## Question

当前 Vue3/TypeScript 版本稳定后，哪些领域契约必须成为 C# 迁移的输入，哪些前端实现细节必须留在浏览器？

需要决定：

- 共享的是 profile、位姿、指令、执行结果还是测试向量；
- 单位、姿态、失败码和浮点容差如何固定；
- C# 迁移的目标是算法库、桌面仿真还是后端服务；
- 迁移何时开始，以及由什么验收样例证明 TypeScript 与 C# 一致；
- 哪些 Three.js、Vue、编辑器和 localStorage 内容明确不迁移。

