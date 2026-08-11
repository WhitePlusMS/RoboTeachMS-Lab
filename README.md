# ABB Robot Programming Lab

独立的 Vite + Vue3 + TypeScript ABB 机器人仿真前端。当前提供 ABB IRB 1200 六轴模型、正逆解与关节/笛卡尔控制，并支持首期 RAPID 文本子集（`MODULE`、`PROC main`、`robtarget`、`MoveJ`、`MoveL`）解析、诊断和仿真执行。

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
- RAPID 源程序编辑、完整解析诊断、MoveJ/MoveL 顺序执行，以及运行/暂停/继续/停止/复位控制
- 控制状态通过 `SceneViewport` 单向传递到 Three.js Pivot 适配器，模型加载完成前也会保留目标姿态

## 关节控制约定

- 控制台角度统一使用度；DH 正解内部统一转换为弧度，长度单位为毫米。
- 关节范围来自 `src/robot-models/kuka-like/robot-config.ts`，越界手动输入会被限制到安全范围。
- 分层目录：通用机器人能力位于 `src/robotics/`（FK/IK/数学/Cartesian/MotionRunner，不依赖 Vue/Three/RAPID/具体型号），RAPID 层位于 `src/rapid/`，Vue 编排与内置程序位于 `src/application/`，具体型号与 DH 模型位于 `src/robot-models/`，测试支持模块位于 `src/testing/`，场景适配位于 `src/scene/`，页面组件位于 `src/components/`。
- 笛卡尔控制的位移使用毫米、姿态使用度；Tool 坐标下的位置/姿态增量会先转换到世界坐标，再交给 IK。

该目录拥有自己的依赖、资源、构建配置和测试，不通过路径别名、工作区、软链接或运行时加载引用其他项目。
