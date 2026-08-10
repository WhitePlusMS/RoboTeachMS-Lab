# GitHub 参考项目检索结果：ABB RAPID 在线仿真编程平台

检索日期：2026-08-10

## 结论

没有找到一个可以直接复制进 ABB-Robot-Programming-Lab 的完整开源项目，同时满足以下条件：

- ABB RAPID 代码编辑；
- RAPID 解析与执行；
- MoveJ/MoveL 路径规划；
- 六轴工业机器人三维仿真；
- Vue3 + TypeScript + Three.js；
- 浏览器纯前端运行。

因此不采用“找一个成品直接改”的路线。建议按能力分层参考：

1. 用 RAPID 编辑器项目校对语法、关键字、数据类型和编辑体验；
2. 用 ABB RAPID 示例项目校对真实程序写法；
3. 用轨迹教学项目参考 MoveJ/MoveL 的路径采样；
4. 用 TypeScript/Three.js 编辑器项目参考文本到 AST、诊断和三维联动；
5. 自己把这些内容接入当前已有的正解、逆解、MotionRunner 和场景模块。

## 值得参考的项目

### 1. KnoP-01/rapid-for-vim

地址：https://github.com/KnoP-01/rapid-for-vim

许可证：MIT。

可参考：

- ABB RAPID 关键字和语法高亮；
- PROC、FUNC、TRAP、RECORD 等结构；
- RAPID 数据类型和常量；
- 代码缩进、结构导航和定义跳转；
- MoveJ 等指令中的结构数据折叠。

不直接复用：

- 这是 Vim Script 插件，不是浏览器编辑器；
- 没有 Three.js、IK、路径执行或在线仿真；
- 只能提取语言词汇、语法规则和编辑器交互思路。

结论：适合作为 RAPID 语法词典和编辑器行为参考。

### 2. abedGNU/vscode-abb-rapid

地址：https://github.com/abedGNU/vscode-abb-rapid

仓库说明包含 ABB RAPID 的 VS Code 语法高亮和代码补全，仓库规模较小，未发现完整运动仿真实现。仓库页面未显示明确开源许可证，直接复制前必须再次核对 LICENSE 和具体文件版权。

可参考：

- 语法高亮分类；
- 代码补全词汇；
- RAPID 编辑器的最小功能集合。

结论：只作为编辑器功能参考，暂不复制代码。

### 3. FLo-ABB/RAPID-Scripts-and-Demos

地址：https://github.com/FLo-ABB/RAPID-Scripts-and-Demos

许可证：MIT。

仓库包含 ABB RAPID 示例模块，例如：

- ToolCenterCalculations；
- PickPlace；
- CycleTime。

可参考：

- 真实 RAPID 模块结构；
- 工具中心点计算相关写法；
- 点位、工具、矩阵和过程调用的实际代码风格；
- 面向真实 ABB 开发人员的示例组织方式。

不直接复用：

- 它是 RAPID 示例集合，不是浏览器解释器；
- 没有 TypeScript parser、Three.js 场景或运动执行器。

结论：这是最适合校对“真实 ABB 程序长什么样”的项目。

### 4. cychitivav/industrial_robotics

地址：https://github.com/cychitivav/industrial_robotics

许可证：MIT。

这是使用 ABB IRB 140 和 RobotStudio 工作对象执行轨迹的教学项目。

可参考：

- workobject 的 RAPID 写法；
- 多个路径点和工作对象之间的关系；
- RobotStudio 中路径和工作对象的组织方式；
- 实际轨迹项目中如何处理坐标系。

不直接复用：

- 目标机器人是 IRB 140，不是 ABB IRB 1200；
- 依赖 RobotStudio，不是纯前端；
- 不能把它的机器人参数直接用于当前项目。

结论：适合作为 tooldata、wobjdata 和路径组织的案例参考。

### 5. posecode-dev/posecode

地址：https://github.com/posecode-dev/posecode

这是 TypeScript、Vite、Three.js、CodeMirror 项目，包含文本解析、校验、中间表示和三维渲染。

可参考：

- 文本编辑器与三维视口并存的页面布局；
- parser → validated intermediate representation → renderer 的模块关系；
- 行级诊断和编辑器反馈；
- 浏览器纯前端执行，不依赖后端的组织方式。

不直接复用：

- 领域是人体动作，不是工业机器人；
- 语法和运动学模型不能直接用于 ABB RAPID；
- 使用的领域模型需要完全替换。

结论：适合作为“RAPID 文本到 AST 再到三维执行”的前端架构参考。

### 6. game4automation/realvirtual-WEB

地址：https://github.com/game4automation/realvirtual-WEB

这是浏览器 Three.js/TypeScript 工业可视化项目。

可参考：

- GLB/glTF 作为模型载体；
- 模型节点、驱动参数和元数据的组织；
- 按模型加载扩展能力；
- 工业 HMI 与三维场景的组合方式。

不直接复用：

- 它不是 ABB RAPID 解释器；
- 技术栈和产品范围比当前项目更大；
- 需要单独核对其许可证、模型格式和商业模块边界。

结论：适合作为三维模型元数据和工业界面结构参考。

## 当前项目应该如何吸收

### 可以直接借鉴的内容

- RAPID 关键字、声明方式和代码样式；
- robtarget、jointtarget、speeddata、zonedata、tooldata、wobjdata 的命名和字段组织；
- MODULE、PROC、FUNC、TRAP、注释和语句结束方式；
- MoveJ、MoveL 示例代码的真实书写习惯；
- parser、AST、诊断、程序指针和三维执行之间的模块关系。

### 不应直接复制的内容

- Vim Script、VS Code 扩展代码；
- RobotStudio 专有文件或控制器通信代码；
- IRB 140、UR5 等其他机器人的尺寸和运动学参数；
- 第三方模型和没有明确许可证的代码；
- 完整 ABB 控制器、RobotWare 或 RAPID 编译器实现。

## 对本项目的建议

当前的最小实现链路应该是：

文本编辑器 → RAPID 子集解析器 → AST/诊断 → MoveJ/MoveL 路径规划 → 现有 IK → 现有 MotionRunner → Three.js 场景和轨迹。

当前项目是纯前端线上应用：

- 程序文本只存在当前页面内存；
- 不使用 localStorage；
- 不提供本地文件保存；
- 不提供文件导入导出；
- 刷新页面后程序状态可以丢失；
- 代码执行、单步、暂停和轨迹观察都在浏览器内完成。

## 参考优先级

1. ABB 官方 RAPID 文档：确认语义；
2. FLo-ABB/RAPID-Scripts-and-Demos：确认真实代码样式；
3. KnoP-01/rapid-for-vim：确认语法覆盖；
4. posecode-dev/posecode：确认在线编辑器与 AST 架构；
5. cychitivav/industrial_robotics：确认工作对象和路径案例；
6. realvirtual-WEB：确认 GLB 元数据和工业 HMI 组织。

任何代码复制前必须重新检查仓库 LICENSE、文件版权和依赖许可证。

