# ABB Robot Programming Lab

独立的 Vite + Vue3 + TypeScript 机器人仿真前端骨架。当前阶段只提供 KUKA 六轴机器人基准三维场景，后续再接入关节控制、笛卡尔控制和 ABB 编程调试能力。

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

该目录拥有自己的依赖、资源、构建配置和测试，不通过路径别名、工作区、软链接或运行时加载引用其他项目。
