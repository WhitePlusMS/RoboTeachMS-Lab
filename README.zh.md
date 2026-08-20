[English](README.md) | [简体中文](README.zh.md)

# RoboTeachMS Lab · 工业机器人示教编程实验室

> 面向工业机器人教学的浏览器端三维示教与编程仿真工作台。
> 通过关节控制、笛卡尔 Jog、末端操作轴、RAPID 程序执行和点位示教，
> 把机器人运动学与程序运行过程放进一个可观察、可操作、可验证的实验环境。

## 项目定位

RoboTeachMS Lab 是一个纯前端工业机器人示教编程仿真项目。

当前应用默认运行 **ABB IRB 1200-5/0.9 六轴机器人**，使用真实 FBX 模型进行三维显示，使用 DH 运动学模型负责正逆运动学与轨迹计算。通用机器人核心与具体厂商模型通过 `robot profile` 分层，后续可以在不重写示教工作台的前提下接入 KUKA、汇川等其他品牌和型号。

本项目面向教学与算法验证，不是完整的 RAPID 编译器、ABB RobotStudio 替代品，也不连接真实机器人控制器。

## 核心功能

| 模块               | 能力                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **三维机器人场景** | 使用 Three.js 与 FBX 加载 ABB IRB 1200 模型；模型加载失败时使用几何占位；支持场景旋转、缩放、平移、网格、世界坐标轴和 DH 调试链显示。                      |
| **关节示教**       | J1～J6 独立控制、角度直接输入、步进幅度选择、单步调整、长按连续调整、回零、随机姿态和关节范围限制。                                                        |
| **笛卡尔 Jog**     | X/Y/Z 与 RX/RY/RZ 控制；支持 World / Tool 坐标系；位置和姿态使用独立步进值；目标通过数值 IK 和轨迹插值驱动机器人。                                         |
| **末端操作轴**     | 在三维场景中切换平移/旋转拖拽；拖拽目标使用 ABB 基座 Pose 求解 IK；操作轴跟随 DH 正解位姿，避免把 FBX 视觉偏差带入求解。                                   |
| **正逆运动学**     | 基于 DH 参数的正运动学、数值 Jacobian、阻尼最小二乘逆解、多初值 Gizmo 目标求解、关节范围校验和不可达目标提示。                                             |
| **RAPID 编辑器**   | 编辑 RAPID 源程序、语法与数据诊断、源码范围定位、程序运行/单步/停止/继续、PP to Main、撤销/重做和运行日志。                                                |
| **程序数据**       | 从同一次 RAPID 解析结果派生 `robtarget`、`tooldata`、`wobjdata`、`speeddata`、`zonedata`、`loaddata`、`num`、`bool` 等数据视图，不维护第二份隐藏点位状态。 |
| **点位示教**       | 新插入运动指令使用 `*` 未示教占位；可以选择已有点位、记录当前位置创建点位、修改位置、重命名和删除点位；三维场景可显示并高亮命名 `robtarget`。              |
| **运动执行**       | `MoveJ`、`MoveL`、`MoveC` 规划与执行；支持速度、转弯区、工具/工件坐标和基础位置函数；程序执行状态、程序指针 PP、运动指针 MP 与日志同步显示。               |
| **本地持久化**     | RAPID 源程序使用浏览器 `localStorage` 保存，无需后端服务或数据库。                                                                                         |

## RAPID 教学子集

项目刻意实现一个可控的 RAPID 教学子集，让“源码 → 诊断 → 规划 → 运动执行”闭环可以在浏览器中观察。

当前支持的主要内容：

- 模块与 `main` 程序结构；模块级 `CONST robtarget`、`PERS`/`VAR` 基础数据声明。
- `tooldata`、`wobjdata`、`speeddata`、`zonedata`、`loaddata` 等运动相关数据的基础解析与校验。
- `MoveJ`、`MoveL`、`MoveC` 运动指令。
- 数值位置函数 `Offs(...)` 与 `RelTool(...)`，以及工具、工件坐标的基础变换。
- `num` / `bool` 标量、字面量、变量、括号、算术运算、比较、`AND` / `OR` / `NOT`。
- `IF` / `ELSEIF` / `ELSE` / `ENDIF`、`WHILE`、`FOR ... TO ... STEP ...` 和 `EXITDO`。
- 词法、语法、名称解析、数据校验和运动规划诊断，并将问题定位到源码范围。
- 循环单步观察和全局循环步数上限，避免教学示例中的死循环阻塞页面。

当前明确不覆盖：

- 完整 RAPID 编译器语义和 ABB 控制器全部系统指令。
- `REPEAT ... UNTIL`、`TEST/CASE`、完整的 `PROC/FUNC` 调用体系。
- I/O、真实控制器通信、外部轴、碰撞检测和动力学仿真。
- 任意复杂表达式驱动的 `Offs` / `RelTool`、复合数据运行时赋值和完整调试器能力。

超出教学子集的内容会通过结构化诊断提示，并阻止不安全的程序执行；具体支持范围以编辑器诊断为准。

## 技术栈

| 层         | 技术                                                                |
| ---------- | ------------------------------------------------------------------- |
| 前端框架   | Vue 3 + `<script setup>`                                            |
| 语言       | TypeScript                                                          |
| 构建工具   | Vite                                                                |
| 三维渲染   | Three.js、`FBXLoader`                                               |
| 线性代数   | `ml-matrix`、项目内矩阵/旋转工具                                    |
| 代码编辑   | CodeMirror 6                                                        |
| 状态组织   | Vue Composition API、应用层控制器与共享上下文                       |
| 单元测试   | Vitest、Vue Test Utils、jsdom                                       |
| 端到端测试 | Playwright                                                          |
| 代码质量   | ESLint、TypeScript ESLint、`eslint-plugin-vue`、Stylelint、Prettier |

## 架构概览

### 从 RAPID 源码到机器人运动

```text
RAPID 源程序
    ↓
Lexer / Parser / Diagnostics
    ↓
符号表、Program Data、结构化运动指令
    ↓
Program Executor
    ↓
MoveJ / MoveL / MoveC 运动规划
    ↓
MotionRunner 插值执行
    ↓
关节状态 → DH 正解 → ABB Pose → Three.js 场景
```

### 分层原则

- `src/robotics/` 只负责通用运动学、矩阵、IK、轨迹和运动执行，不依赖 Vue、Three.js 或 RAPID 文本。
- `src/robot-models/` 提供具体机器人型号的 profile、DH 参数、关节范围和回零姿态；当前主应用使用 `ABB_IRB1200_PROFILE`。
- `src/rapid/` 负责 RAPID 词法、解析、诊断、符号解析、运动数据和规划器。
- `src/application/` 负责页面级控制编排、程序控制、关节控制、笛卡尔控制、日志和提示。
- `src/scene/` 负责 Three.js 场景、FBX 模型、坐标转换、轨迹、点位标记和末端操作轴。
- `src/components/` 负责工作台、程序编辑器、Jog 面板、数据面板和三维视口等 Vue 组件。

### 坐标与单位

- ABB 机器人基座坐标是运动学和 RAPID 点位的领域真值。
- ABB 位置使用毫米，用户界面角度使用度；DH 内部计算按实现需要转换为弧度。
- Three.js 场景使用米和场景坐标适配层；场景显示坐标不定义 RAPID 或运动学语义。
- Tool / WObj 变换在进入运动规划前完成，避免把视觉模型坐标直接当作机器人控制坐标。

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本

### 安装与运行

```bash
npm install
npm run dev
```

Vite 启动后，在终端显示的地址打开页面即可。

### 构建预览

```bash
npm run build
npm run preview
```

### 常用命令

```bash
# TypeScript / Vue 类型检查
npm run check

# 运行 src 下的单元测试
npm run test

# 运行 Playwright 端到端测试
npm run test:e2e

# ESLint 与 Stylelint
npm run lint
npm run lint:style

# 格式化与格式检查
npm run format
npm run format:check
```

首次运行端到端测试时，如果本机尚未安装 Playwright 浏览器，可执行：

```bash
npx playwright install
```

## GitHub Pages 部署

推送到 `mater` 分支会触发 `.github/workflows/deploy-gh-pages.yml`。工作流使用 Node.js 20 安装依赖、构建 Vite 应用，并将 `dist/` 发布到 `gh-pages` 分支。GitHub Actions 构建时，Vite 会自动使用 `/RoboTeachMS-Lab/` 作为资源基础路径。

## 项目结构

```text
.
├─ public/
│  ├─ brand/                         # RoboTeachMS Lab 品牌图片
│  └─ models/                        # ABB IRB 1200 与其他机器人模型
├─ src/
│  ├─ application/                   # 页面控制器、程序控制、日志、提示
│  ├─ components/                    # Vue 工作台、编辑器、控制面板
│  ├─ rapid/                         # RAPID Lexer、Parser、诊断、规划器
│  ├─ robotics/                      # 通用运动学、IK、轨迹、MotionRunner
│  ├─ robot-models/                  # 机器人 profile 与型号适配
│  ├─ scene/                         # Three.js、FBX、坐标适配、Gizmo
│  ├─ theme/                         # 页面与场景设计令牌
│  ├─ testing/                       # 测试时钟等测试支持
│  ├─ App.vue                        # 应用编排入口
│  └─ main.ts                        # Vue 应用启动入口
├─ e2e/                              # Playwright 端到端场景
├─ index.html
├─ package.json
└─ vite.config.ts
```

## 后续扩展方向

- 接入 KUKA、汇川等厂商的机器人 profile、DH 参数、模型和指令适配。
- 扩展 RAPID 教学子集与其他厂商程序语言的共同抽象。
- 增加更完整的外部轴、工具/工件数据和工业任务流程仿真。
- 在保持浏览器本地教学闭环的基础上，补充可导入、导出和课程实验记录能力。

## 许可证与范围

本项目采用 [GNU Affero General Public License v3.0](LICENSE) 许可证。

本项目的所有运动学、解析、规划和仿真逻辑均在浏览器端运行，不依赖后端服务。项目中的机器人模型、厂商参数和程序语言能力均按教学仿真用途组织，不能直接替代真实机器人控制器上的安全验证流程。
