# ABB Robot Programming Lab

独立的 Vite + Vue3 + TypeScript 机器人仿真前端骨架。当前阶段提供 KUKA 六轴机器人基准三维场景和关节空间控制闭环，后续再接入笛卡尔控制和 ABB 编程调试能力。

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

## 第一阶段范围

- KUKA 模型、工作台、地面网格和世界坐标轴
- Three.js 场景生命周期与 GLTF 模型加载
- 左键旋转、滚轮缩放和右键平移
- 本地模型加载失败时的几何占位，保证场景仍可观察
- 六轴滑块、手动角度输入、单步/长按调整和步进幅度选择
- KUKA 关节范围限制、回零、随机姿态与正解末端位姿显示
- 控制状态通过 `SceneViewport` 单向传递到 Three.js Pivot 适配器，模型加载完成前也会保留目标姿态

## 关节控制约定

- 控制台角度统一使用度；DH 正解内部统一转换为弧度，长度单位为毫米。
- 关节范围来自 `src/robots/kuka-like/robot-config.ts`，越界手动输入会被限制到安全范围。
- 复制后的机器人核心位于 `src/core/robot/`，控制状态位于 `src/robot/`，场景适配位于 `src/scene/`。

该目录拥有自己的依赖、资源、构建配置和测试，不通过路径别名、工作区、软链接或运行时加载引用其他项目。
