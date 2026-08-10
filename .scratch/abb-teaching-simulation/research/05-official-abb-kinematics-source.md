# ABB IRB 1200-5/0.9 官方机制、手册与论文运动学资料复核

## 结论先行

当前公开资料可以确认 IRB 1200-5/0.9 的几何尺寸、工作范围、轴限位和 RobotStudio 机制 API；但本次检索没有找到 ABB 官方公开、可直接下载并可逐项对应当前 FBX 的完整 `IRB1200-5/0.9` DH/MDH 数值包。

因此：

- ABB 官方手册数据可以直接用于型号、尺寸、限位和工作范围校验。
- 论文 DH 表可以作为候选 FK/IK 输入，但不能标记为 ABB 控制器标定值。
- 真正的 ABB 机制 FK/IK 应优先来自 RobotStudio mechanism/virtual controller 数据。
- 当前项目的 `399.1 / 448 / 42 / 451 / 82` 表是候选几何模型，不应称为“官方完整 DH”。

## 一、ABB 官方资料

### S01：IRB 1200 Product Manual

- 文档：[ABB IRB 1200 Product Manual, 3HAC046983-001](https://library.e.abb.com/public/cc6ba9c00e7c4005b715a13839e8bc69/3HAC046983%20PM%20IRB%201200-en.pdf)
- 可确认：IRB 1200-5/0.9 型号、安装方式、工作范围、关节限位、校准/同步标记、安装与维护相关信息。
- 对 5/0.9 可确认的限位包括：J1 `+170/-170`、J2 `+130/-100`、J3 `+70/-200`、J4 `+270/-270`、J5 `±130`、J6 默认 `+400/-400`，并说明最大 revolution value `±242`。
- 文档的尺寸图能够确认包括 `399.1`、`448`、`42`、`451`、`82` 在内的机构几何数量级。
- 注意：尺寸图中的标注是机械尺寸，不等价于已经定义好坐标原点、轴方向、零位偏置和法兰坐标的 DH/MDH 表。

### S02：IRB 1200 Product Specification

- 文档：[ABB IRB 1200 Product Specification, 3HAC081417-001](https://library.e.abb.com/public/7ff4f4ef657d4aaba704f247ae728d38/3HAC081417%20PS%20IRB%201200%20on%20OmniCore-en.pdf)
- 可确认：5/0.9 的 5 kg payload、0.9 m reach、6 axes、机器人高度约 `967 mm`、机器人底座约 `210 × 210 mm`，以及轴范围和版本差异。
- 该规格书仍然是产品规格和工程尺寸资料，不是针对某个 RobotStudio mechanism 的完整标定参数导出。

## 二、ABB 官方 RobotStudio 机制数据入口

### S03：Mechanism API

- 文档：[ABB RobotStudio Mechanism API](https://developercenter.robotstudio.com/api/robotstudio/api/ABB.Robotics.RobotStudio.Stations.Mechanism.html)
- 官方 API 明确提供：
  - `GetDenavitHartenbergParameters()`：读取机制 DH 参数；
  - `CalculateForwardKinematics()`：根据机制关节值计算 TCP/tool0 变换；
  - `CalculateInverseKinematics()`：根据目标位姿和参考关节值计算逆解；
  - `ModelBaseFrame`：读取机制模型基座坐标；
  - `GetFlange()`：读取法兰；
  - `GetJointTransform()`：读取指定关节在机制坐标中的变换；
  - `GetCalibrationPosition()`、`GetSyncPosition()`：读取校准/同步位置；
  - `SetJointModelOffset()`：定义关节值与名义模型之间的零位偏置；
  - `GetAllConfigurationsAsync()`、`ConfigurationData`：读取多个可达配置和 ABB 构型信息。
- 这说明完整的 ABB 运动学数据属于已加载机制/虚拟控制器模型，而不是仅靠产品手册中的尺寸数字拼出来的。

### S04：ABB DH 参数语义

- 文档：[ABB RobotStudio DenavitHartenbergParameters](https://developercenter.robotstudio.com/api/robotstudio/api/ABB.Robotics.RobotStudio.Stations.DenavitHartenbergParameters.html)
- ABB API 对 `D`、`Theta`、`A`、`Alpha` 的语义依赖所附坐标系约定：`D` 是沿前一坐标系 z 的偏移，`A` 是公法线长度，`Theta` 是绕前一 z 的角度，`Alpha` 是绕公法线的扭转角。
- 因此同样的 `399.1`、`448`、`451`，如果 frame 原点、轴方向或 DH convention 不同，不能直接得到相同 FK。

### S05：官方 RobotStudio library 线索

- ABB Robotics Community：[IRB 1200 on RobotStudio](https://tech-community.robotics.abb.com/t/irb-1200-on-robotstudio/6318)
- 该 ABB 官方社区帖子提到历史 RobotStudio library 名称 `IRB1200_5_90_STD_01.rslib`。
- 本次检索没有找到 ABB 官方当前可公开直接下载的该 `.rslib` 文件，也没有在本机发现 RobotStudio 安装或对应机制文件。因此不能把该文件中的参数假设为当前已获得的数据。

## 三、原始论文与候选 DH 数据

### S06：Sensors 2025，明确使用 IRB1200 5/0.9 的误差补偿论文

- 论文：[Research on End-Effector Position Error Compensation of Industrial Robotic Arm Based on ECOA-BP](https://www.mdpi.com/1424-8220/25/2/378)
- 论文 Table 1 给出标准 DH 候选：

  | Joint | d (mm) | a (mm) | alpha (deg) |
  |---:|---:|---:|---:|
  | 1 | 399.1 | 0 | -90 |
  | 2 | 0 | 448 | 0 |
  | 3 | 0 | 42 | -90 |
  | 4 | 451 | 0 | 90 |
  | 5 | 0 | 0 | -90 |
  | 6 | 82 | 0 | 0 |

- 论文还给出若干理论位置与实测位置的误差补偿数据。
- 该表属于论文建立的误差模型，不是 ABB 官方机制标定输出；论文没有证明其 frame 零位、flange/tool0 和当前 FBX 完全相同。

### S07：ARCI 2021 会议论文集中的 IRB 1200 5/0.9 模型

- PDF：[ARCI 2021 proceedings](https://sensorsportal.com/ARCI/9788409275380.pdf)，相关内容约在 PDF 第 14 页。
- 该论文的 DH 表使用 `a2=448 mm`，并将 J6 的常数 `theta` 写为 `pi`；其逆解使用 BFGS，初始值使用 home position，连续轨迹则使用上一点的配置作为下一点初值。
- 这支持“连续路径使用上一姿态作为 seed”是有研究依据的，但它仍然是论文建模选择，不是 ABB 官方控制器机制数据。

### S08：Machines 2026 的混合 IK 论文

- 论文：[A Novel Hybrid IK Architecture for Robotic Arms: Iterative Refinement of Soft-Computing Approximations with Validation on ABB IRB-1200 Robotic Arm](https://www.mdpi.com/2075-1702/14/3/292)
- Table 1 写出的候选表包含 `a2=350 mm`、`d1=399.1 mm`、`d4=451 mm`、`d6=82 mm`，并将 J6 常数 `theta` 写为 `180°`。
- 该论文的搜索摘录和附录公式中又出现 `448`，与 Table 1 的 `350` 产生冲突；因此该论文不能作为无条件的参数真值来源。
- 论文重点是 ANFIS/混合 IK 近似与迭代校正，不等价于 ABB 官方控制器 IK。

## 四、对当前项目的直接结论

当前 `src/robots/abb-irb1200/robot-config.ts` 中的几何量与 S01/S02 的尺寸以及 S06 的候选表有交叉吻合，但以下字段仍是假设或坐标转换：

- J2 的 `thetaOffset=-90°`；
- J6 是否存在 `180°` 常数偏置；
- DH 与 Three.js 场景坐标的 BaseFrame 平移/旋转；
- `joint7` 是否就是 ABB flange、还是需要固定 flange/tool0 变换；
- ABB 机制零位、同步标记和 joint model offsets；
- ABB configuration/confdata 分支。

因此当前不能把代码称为“官方 ABB DH/IK”。更准确的名称应是“IRB 1200-5/0.9 几何候选模型 + 数值 IK”。

## 五、推荐的正式计算路线

### 路线 A：拿到官方 RobotStudio mechanism（首选）

1. 在 RobotStudio 中加载 `IRB1200_5_90_STD_01` 对应的官方 mechanism/library。
2. 从机制读取 DH、ModelBaseFrame、Flange、JointTransform、CalibrationPosition、SyncPosition、JointModelOffset 和 joint limits。
3. 导出为项目自己的 JSON profile，明确记录来源、版本、机器人变体和单位。
4. 用导出的机制 FK 作为页面 FK；用 RobotStudio IK 或复刻同一机制的配置分支作为页面 IK。
5. 用同一组 joint values 驱动 FBX，并验证 FBX 法兰与机制 FK 的位置/姿态误差。

### 路线 B：只有官方手册 + 已确认正确 FBX

1. 使用官方手册的尺寸和限位作为约束，不宣称得到官方标定 DH。
2. 从 FBX 读取六个关节的 pivot、轴线、零位世界变换和 flange 节点。
3. 把这些刚体变换表达为显式的 `baseFrame + jointFrame[i] + jointAxis[i] + flangeFrame`，优先使用 MDH/通用固定变换，而不是强行套标准 DH。
4. 用官方尺寸做几何一致性检查，用 FBX 单轴运动做符号/轴方向/零位验证。
5. IK 先使用当前关节作为 seed 的阻尼数值法；再加入多 seed/构型分支，最后用 FK→FBX 法兰闭环验收。

### 不能做的事

- 不能从尺寸图直接推导唯一的 DH frame；
- 不能在 `a2=350` 与 `a2=448` 冲突时任选一个并标注官方；
- 不能把论文的 J2/J6 常数偏置直接当作 ABB 校准偏置；
- 不能用“DH FK→同一个 DH IK→DH FK”代替真实 FBX 法兰验证。

## 资料检索日期

2026-08-10。
