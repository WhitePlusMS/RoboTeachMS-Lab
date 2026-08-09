# 更新日志

## 2026-08-09：实现任务 04——场景辅助功能

- 新增 `src/scene/scene-helpers.ts`：复用原项目的基坐标轴和工具坐标轴绘制方式。
- 新增 `src/scene/trajectory.ts`：提供轨迹点最小距离去重和 200 点上限控制。
- 修改 `src/scene/kuka-scene.ts`：网格默认开启；加入基坐标/工具坐标辅助轴、末端轨迹采样、轨迹线显示、清空轨迹和资源释放。
- 修改 `src/components/SceneViewport.vue`：增加网格、基座/工具坐标、轨迹、清空轨迹辅助工具栏及轨迹点数提示。
- 新增 `src/components/CoordinateInfoPanel.vue`，并修改 `src/App.vue`、`src/style.css`：展示基坐标系与工具坐标系的位姿信息。
- 审查后改用固定轨迹缓冲区，合并坐标值格式化函数，并简化清空轨迹的状态同步路径。
- 验证结果：TypeScript 类型检查通过，`vitest` 通过（7 个测试文件、24 个测试），`vite build` 通过；仅保留既有单 chunk 体积提示。

## 2026-08-09：移植原项目运动动画过渡

- 新增 `src/core/robot/motion-smoothing.ts`：复用原项目的 `easeInOutCubic`、关节插值和默认运动参数。
- 新增 `src/robot/motion-control.ts`：接入 RAF 关节动画、800ms 缓动、60°/s 长按限速、连续目标更新和卸载清理。
- 修改 `src/App.vue`：关节单击、回零、随机姿态和笛卡尔目标统一使用平滑过渡；滑块输入仍保持即时提交。
- 修改 `JointControlPanel.vue`、`CartesianControlPanel.vue`、`cartesian-control.ts`：区分普通操作与连续长按目标。
- 新增动画曲线测试，更新关节面板事件测试。
- 验证结果：TypeScript 类型检查通过，`vitest` 通过（7 个测试文件、22 个测试），`vite build` 通过；仅保留既有单 chunk 体积提示。

## 2026-08-09：实现任务 03——笛卡尔控制与逆解闭环

- 新增 `src/core/robot/ik-solver.ts`：基于 DH 正解的数值 Jacobian DLS 六维逆解和位置-only 回退。
- 新增 `src/robot/cartesian-control.ts`：World/Tool 坐标增量、独立位置/姿态步进、逆解调用和失败保护。
- 新增 `src/components/CartesianControlPanel.vue`：X/Y/Z/RX/RY/RZ 数值输入、点击/长按、坐标系切换和状态提示。
- 修改 `src/App.vue`、`src/style.css`、`src/core/robot/types.ts`、`src/robot/joint-control.ts`：接入笛卡尔控制并复用现有关节状态与场景同步。
- 新增核心测试，覆盖小位移/小姿态逆解收敛、远目标失败、World/Tool 方向和非法输入保护。
- 验证结果：`npm test` 通过（6 个测试文件、20 个测试），`npm run check` 和 `npm run build` 通过。

## 2026-08-09：修正任务 03 逆解链路，完整对齐原项目实现

- 补齐 `ml-matrix`、`RobotModel`、旋转误差、向量限幅和角度工具，逆解改为原项目的 Levenberg-Marquardt DLS 参数与矩阵求解流程。
- 新增 `src/scene/kuka-scene-model.ts`，GLB 加载后直接从真实 KUKA Pivot 采样 FK/Jacobian，避免 DH 近似模型与三维场景轴向不一致。
- `SceneViewport` / `App` 将真实场景模型注入笛卡尔控制；GLB 未就绪时才回退到 DH 模型。
- 修正姿态目标使用完整旋转矩阵，不再用欧拉角差替代原始 `orientationError`。
- 删除重复的 `Pose` 类型声明，并将位置-only 回退提示改为“姿态未约束”，与实际算法能力保持一致。
- 验证结果：`npm test` 通过（6 个测试文件、20 个测试），`npm run check` 和 `npm run build` 通过。
