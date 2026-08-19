# ABB Robot Programming Lab

独立的 Vite + Vue3 + TypeScript ABB 机器人仿真前端。当前提供 ABB IRB 1200 六轴模型、正逆解与关节/笛卡尔控制，并支持面向教学的 RAPID 基础逻辑子集解析、诊断和仿真执行。本项目不是完整 RAPID 编译器，也不是 ABB 控制器的完整仿真器。

## 运行

```bash
npm install
npm run dev
```

## 验证

```bash
npm run check
npm run test
npm run build
npm run preview
```

## 当前范围

- ABB IRB 1200 模型、工作台、地面网格和世界坐标轴
- Three.js 场景生命周期与 GLTF 模型加载
- 左键旋转、滚轮缩放和右键平移
- 本地模型加载失败时的几何占位，保证场景仍可观察
- 六轴滑块、手动角度输入、单步/长按调整和步进幅度选择
- ABB 关节范围限制、回零、随机姿态与正解末端位姿显示
- X/Y/Z/RX/RY/RZ 笛卡尔控制、World/Tool 坐标系切换、独立位置/姿态步进和长按调整
- 基于 DH 正解的数值 Jacobian DLS 逆解；失败时保留最近一次有效关节状态并提示原因
- RAPID 源程序编辑、源码范围诊断、`MoveJ`/`MoveL` 与模块级 `VAR num/bool` 数据
- FlexPendant 式程序编辑器：「添加指令」只列 MoveJ/MoveL 并插入 `*,v1000,z50,tool0` 未示教占位（程序不可运行）；参数编辑器改写目标点/速度/转弯区、修改位置；剪切/复制/粘贴、注释/取消注释、Change to MoveJ↔MoveL、撤销/重做（3 步）。Program Data 暂不维护第二份点位存储。
- 最小标量赋值表达式：字面量、变量、括号、算术、比较、`AND`/`OR`/`NOT`
- 非嵌套 `IF`/`ELSEIF`/`ELSE`/`ENDIF` 分支；`WHILE` 与 `FOR ... TO ... STEP ...` 循环、循环内 `EXITDO` 提前退出，条件/循环/嵌套 IF 与运动共用同一执行计划
- 嵌套 `IF` 与嵌套循环（循环体/条件体内允许多层递归区块）
- 教学防死循环：整个程序的循环步进全局累计上限（默认 1 万次），超限报 `runtime-error` 并自动停止
- 循环单步：每轮经过循环头都作为一个可单步断点，便于观察每轮迭代
- ABB 风格运行/单步/停止/继续/PP to Main；Program Data 同时观察声明初值与运行当前值
- 控制状态通过 `SceneViewport` 单向传递到 Three.js Pivot 适配器，模型加载完成前也会保留目标姿态

## 关节控制约定

- 控制台角度统一使用度；DH 正解内部统一转换为弧度，长度单位为毫米。
- 关节范围来自 `src/robot-models/kuka-like/robot-config.ts`，越界手动输入会被限制到安全范围。
- 分层目录：通用机器人能力位于 `src/robotics/`（FK/IK/数学/Cartesian/MotionRunner，不依赖 Vue/Three/RAPID/具体型号），RAPID 层位于 `src/rapid/`，Vue 编排与内置程序位于 `src/application/`，具体型号与 DH 模型位于 `src/robot-models/`，测试支持模块位于 `src/testing/`，场景适配位于 `src/scene/`，页面组件位于 `src/components/`。
- 笛卡尔控制的位移使用毫米、姿态使用度；Tool 坐标下的位置/姿态增量会先转换到世界坐标，再交给 IK。

## RAPID 教学子集边界

当前刻意只覆盖基础逻辑教学闭环：模块级 `VAR num/bool`、标量赋值与表达式、非嵌套与嵌套 `IF`/`ELSEIF`/`ELSE` 条件分支、`WHILE`/`FOR` 循环与 `EXITDO` 提前退出，以及分支/循环内既有 `MoveJ`/`MoveL`。运行值由现有 ProgramExecutor 快照持有，源码、Program Data、PP/MP 和运动规划不建立平行状态；循环结构变化会触发停止/完成态的 PP to Main 要求。

当前未实现：`REPEAT...UNTIL`、`TEST/CASE`、PROC/FUNC 调用、I/O、复合数据赋值、变量驱动 `Offs`/`RelTool`、完整调试器能力和完整 RAPID 编译器语义。超出子集的语法会给出诊断并阻止部分执行。

该目录拥有自己的依赖、资源、构建配置和测试，不通过路径别名、工作区、软链接或运行时加载引用其他项目。

## Linting & Formatting

项目使用 ESLint（flat config）+ TypeScript-ESLint + eslint-plugin-vue + Prettier + Stylelint，并统一由 Prettier 负责格式，ESLint 的格式类规则通过 `eslint-config-prettier` 关闭以避免冲突。首次使用前需先 `npm install`（安装 ESLint/Prettier/Stylelint 等新依赖）。

```bash
# 类型检查（既有）
npm run check

# ESLint 检查 / 自动修复（src/**/*.ts 与 *.vue）
npm run lint
npm run lint:fix

# Stylelint 检查（src/**/*.css 与 *.vue 内样式）
npm run lint:style

# Prettier 格式化 / 检查
npm run format
npm run format:check
```

格式化约定（见 `.prettierrc.json`）：无分号、单引号、`trailingComma: 'all'`、`printWidth: 100`、`tabWidth: 2`——与代码库既有风格一致。`.editorconfig` 固定 utf-8、LF、2 空格缩进。
