# RAPID 模块

- `language/parser`：读取语法、解析操作数，并将结构控制流转换为执行指令。叶子指令关键词集中在 `instruction-keywords.ts`，解析器直接引用具体语句模块。
- `data`：强类型数据记录、系统值与 Offs/RelTool 运算。
- `motion`：校验 RAPID 参数并构造运动核心请求，不求逆解、不规划路径。
- `runtime`：解释指令、维护程序指针和执行状态，向宿主提交运动请求。
- `editing`：受控源码编辑、示教和指令修改。

新增指令时，在现有 parser 中按语义扩展强类型指令，并更新 runtime 的显式分派。不为尚未实现的功能建立占位目录或插件协议。CodeMirror 高亮由 `components/program/rapid-syntax-highlight.ts` 负责。
