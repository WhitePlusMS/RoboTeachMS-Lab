# 更新日志

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
