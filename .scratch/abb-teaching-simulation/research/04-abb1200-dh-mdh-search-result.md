# ABB IRB 1200-5/0.9 DH/MDH/URDF 参数复核结果

- 检索日期：2026-08-10
- 访问时区：Asia/Shanghai
- 研究对象：经典款 `ABB IRB 1200-5/0.9`，不含 Hygienic、Next Generation/Gen2、Lite+
- 研究边界：只核查资料和参数，不修改 `src`、`package.json` 或业务场景代码
- 现有项目研究：[02-abb1200-model-and-parameters-research-result.md](./02-abb1200-model-and-parameters-research-result.md)

## 结论先行

这次检索找到了三类可用于运动学研究的资料，但可信度和可直接使用程度不同：

1. **ABB 官方产品手册**可以确认经典款型号、6 轴、工作范围、关节范围、主要机构尺寸、校准标记和轴运动方向，但没有公开一张可直接复制的完整 DH/MDH/URDF 表。
2. **ABB 官方 RobotStudio SDK**明确提供从已加载机器人机制读取 DH、FK、IK、关节限制、关节模型偏置、法兰和零位的 API。这证明官方机制中存在可等价驱动 FK/IK 的运动学数据，但公开 API 文档没有给出 `IRB 1200-5/0.9` 具体机制的数值表；本机也没有发现 RobotStudio 安装目录或对应 `.rslib` 文件。
3. **ROS-Industrial**有明确针对 `IRB 1200-5/0.9` 的 URDF/Xacro 支持；**2026 年公开论文**也明确给出一张该型号 DH 表。这两者可以作为实现和交叉验证的候选输入，但都不是 ABB 官方标定数据。论文 DH 表与 ABB 官方关节限制存在冲突，不能未经验证直接成为生产级 ground truth。
4. 另一篇明确以 5 kg/0.9 m IRB1200 为对象的研究给出 `a2=448 mm` 的 DH 表；该数值与 ABB 手册中的 5/0.9 机构尺寸以及 ROS-Industrial URDF 的 `448 mm` 关节原点一致。公开论文之间存在 `350 mm` 与 `448 mm` 两种表，前者不能直接作为经典 5/0.9 的参数。

因此，本项目当前的准确结论是：

> 存在可用于前端 FK/IK 的公开“候选 DH/URDF 等价参数”，但目前没有找到一份已经被 ABB 官方公开、与经典 `IRB 1200-5/0.9` 的具体 Type A/Type B、零位、法兰坐标和当前 FBX 同时核验过的完整参数包。

## 1. 来源索引

| 编号 | 来源标题 | 来源组织 | URL | 访问日期 | 型号匹配 | 主要确认内容 |
|---|---|---|---|---|---|---|
| S01 | Product manual - IRB 1200，3HAC046983-001 | ABB 官方 | [ABB IRB 1200 Product Manual](https://library.e.abb.com/public/cc6ba9c00e7c4005b715a13839e8bc69/3HAC046983%20PM%20IRB%201200-en.pdf) | 2026-08-10 | 明确包含 `IRB 1200-5/0.9`、Type A、Type B 等经典款资料 | 官方尺寸、工作范围、轴限制、校准、同步标记、轴方向和机构说明；未见完整公开 DH/MDH 表 |
| S02 | Class Mechanism | ABB 官方 RobotStudio Developer Center | [RobotStudio Mechanism API](https://developercenter.robotstudio.com/api/robotstudio/api/ABB.Robotics.RobotStudio.Stations.Mechanism.html) | 2026-08-10 | API 是通用机制接口，具体型号取决于加载的机制文件 | `GetDenavitHartenbergParameters()`、`CalculateForwardKinematics()`、`CalculateInverseKinematics()`、`GetJointLimits()`、`GetJointTransform()`、`GetFlange()`、`GetHomePosition()`、关节模型偏置等 |
| S03 | Struct DenavitHartenbergParameters | ABB 官方 RobotStudio Developer Center | [RobotStudio DH Parameter API](https://developercenter.robotstudio.com/api/robotstudio/api/ABB.Robotics.RobotStudio.Stations.DenavitHartenbergParameters.html) | 2026-08-10 | 通用 DH 数据结构，不是某个型号的数值表 | 明确定义 `D`、`Theta`、`A`、`Alpha` 的语义和单位接口 |
| S04 | Author Components in RSXML | ABB 官方 RobotStudio Developer Center | [RobotStudio RSXML Mechanism](https://developercenter.robotstudio.com/api/robotstudio/articles/Walkthroughs/AuthorComponentsInRsxml.html) | 2026-08-10 | 文档示例是 IRB1300，不可把示例数值当作 IRB1200 | 机制文件可声明 `J1` 等旋转关节、关节两点、限位、法兰、BaseFrame、HomePosition，并明确示例使用 `lengthUnit="mm"`、`angleUnit="deg"` |
| S05 | Structure of a Distribution Package | ABB 官方 RobotStudio Developer Center | [RobotStudio Distribution Package](https://developercenter.robotstudio.com/api/robotstudio/articles/Concepts/Distribution-Package/DP_Structure.html) | 2026-08-10 | 通用 RobotStudio 机制资产说明 | 机制模型通常以 `.rslib` 等 RobotStudio 组件进入库，并通过 `MechunitLibraryMap.xml` 与控制器机械单元关联；不是网页 GLB/URDF |
| S06 | ABB IRB 1200 support package | ROS-Industrial | [ROS package overview](https://ros.fei.edu.br/roswiki/abb_irb1200_support.html)；[source repository](https://github.com/ros-industrial/abb) | 2026-08-10 | 明确包含 `IRB 1200-5/0.9` 和 `IRB 1200-7/0.7` | 有配置、3D 模型和 launch 文件；关节限制/速度基于 ABB 2016 datasheet；Apache-2.0；文档要求使用前核对具体机器人和配置 |
| S07 | A Novel Hybrid IK Architecture for Robotic Arms: Iterative Refinement of Soft-Computing Approximations with Validation on ABB IRB-1200 Robotic Arm | 论文原始来源，Machines 2026 | [MDPI article, DOI 10.3390/machines14030292](https://www.mdpi.com/2075-1702/14/3/292) | 2026-08-10 | 论文明确写 `ABB IRB-1200-5-0.9`，并说明实验验证使用 5 kg/0.9 m 机器人 | Table 1 给出一套标准 DH 表和作者的 FK 公式；论文是独立研究来源，不是 ABB 官方标定发布 |
| S08 | ABB IRB 1200 Next Generation 官方产品页 | ABB 官方 | [IRB 1200 Next Generation](https://www.abb.com/global/en/areas/robotics/products/robots/articulated-robots/small-robots/irb-1200-next-generation) | 2026-08-10 | Gen2/Next Generation，非经典款 | 用于排除代际混用；Gen2 5/0.9 与经典款 5/0.9 不是同一机构 |
| S09 | Product specification - IRB 1200 Gen2，3HAC074710-001 | ABB 官方 | [IRB 1200 Gen2 specification](https://library.e.abb.com/public/5ad735ae9a3640cda0052d07acabefeb/3HAC074710%20PS%20IRB%201200%20Gen2-en.pdf) | 2026-08-10 | Gen2，非经典款 | 用于确认 Gen2 的不同关节范围、质量和速度不能套给经典款 |
| S10 | ABB IRB 1200 Hygienic 官方产品页 | ABB 官方 | [IRB 1200 Hygienic](https://www.abb.com/global/en/areas/robotics/products/robots/articulated-robots/small-robots/irb-1200-hygienic) | 2026-08-10 | Hygienic，非标准经典款 | 用于确认 Hygienic 的保护结构、法兰和部分关节参数不能与标准款混用 |
| S11 | 本地 FBX 资产检查 | 用户提供的本地文件 | [JQR_ABB(1).fbx](C:/Users/admin/Downloads/JQR_ABB%281%29.fbx) | 2026-08-10 | 文件名不含完整 ABB 型号 | 二进制 FBX，1,222,736 bytes；发现 `joint1` 至 `joint9` 等字符串和旋转属性，但未通过文件内容确认 IRB 1200-5/0.9、6 轴层级、单位、零位、法兰或许可 |
| S12 | Research on End-Effector Position Error Compensation of Industrial Robotic Arm Based on ECOA-BP | Sensors / MDPI，论文原始来源 | [Sensors 2025, 25(2), 378](https://www.mdpi.com/1424-8220/25/2/378) | 2026-08-10 | 论文明确以 5 kg、0.025 mm、54 kg 的 IRB1200 为对象 | Table 1 给出 `d1=399.1`、`a2=448`、`a3=42`、`d4=451`、`d6=82 mm` 和标准 DH 结构；属于研究模型，不是 ABB 官方标定数据 |
| S13 | IRB 1200-5/0.9 URDF/Xacro 原始文件 | ROS-Industrial GitHub | [irb1200_5_90_macro.xacro](https://raw.githubusercontent.com/ros-industrial/abb/noetic-devel/abb_irb1200_support/urdf/irb1200_5_90_macro.xacro) | 2026-08-10 | 文件名和宏名明确为 `irb1200_5_90` | 给出每个 joint 的 `origin`、`axis`、limit、flange 和 tool0；可作为等价刚体变换输入，但不是 ABB 官方标定参数 |
| S14 | FbxSystemUnit Class Reference | Autodesk FBX SDK 官方 | [Autodesk FBX System Unit](https://help.autodesk.com/cloudhelp/2020/ENU/FBX-API-Reference/cpp_ref/class_fbx_system_unit.html) | 2026-08-10 | 通用 FBX 单位定义 | `pScaleFactor` 表示相对于厘米的比例因子；用于解释本地 FBX 的 `UnitScaleFactor=1`，不代表模型型号或运动学正确 |

## 2. ABB 官方资料能够确认的参数

以下内容只使用 S01 的经典款产品手册。`IRB 1200-5/0.9 Gen2`、Hygienic 和其他变体的资料没有混入本表。

| 参数 | 经典 `IRB 1200-5/0.9` 官方可确认内容 | 结论 |
|---|---|---|
| 轴数/结构 | 6 轴铰接机器人 | 可用于 profile 基本字段 |
| 负载 | 5 kg | 已确认 |
| 工作范围 | 型号为 0.9 m；工作范围资料给出约 `R = 901 mm` | 已确认；这是工作包络，不等于某一行 DH 的 `a` |
| J1 | `-170° … +170°` | 已确认 |
| J2 | `-100° … +130°` | 已确认；这是与论文表产生冲突的字段 |
| J3 | `-200° … +70°` | 已确认 |
| J4 | `-270° … +270°` | 已确认 |
| J5 | `-130° … +130°` | 已确认，不能使用 Hygienic 的 ±128° |
| J6 | 默认 `-400° … +400°`；资料另列最大 revolution value `±242` | 已确认默认范围；`±242` 不应直接当作本项目普通关节角范围 |
| 主要机构尺寸 | 经典 `5/0.9` 官方尺寸图对应 `399.1 mm`、`448 mm`、`42 mm`、`451 mm`、`82 mm`；`350 mm` 属于 `7/0.7` 结构尺寸 | 可用于交叉核验候选 DH 的数量级；不能把尺寸图直接当作 DH 表 |
| 单位 | 产品尺寸使用 mm，关节位置/速度资料使用 °、°/s | 与项目内部 mm/deg 基线兼容 |
| 校准/零位 | 有同步标记、同步位置、轴运动方向和 Axis Calibration 章节 | 可作为零位和符号核验依据；没有直接公开完整零位偏置数组 |
| 基座/法兰 | 官方手册包含安装和法兰相关图纸/说明 | 几何存在，但没有在公开页面形成可直接复制的 `base -> flange` 完整 SE(3) 参数表 |
| DH/MDH/URDF | S01 产品手册未找到完整公开 DH、MDH、URDF 或逐轴刚体变换表 | 官方公开产品手册不足以直接建立严格 FK |

## 3. 公开论文 DH 表：存在，但只能作为候选输入

S07 的 Table 1 明确写出 `ABB IRB-1200-5-0.9` 的标准 DH 参数，并给出标准 DH 齐次变换公式。按论文原表抄录如下：

| Joint | `a_i` mm | `alpha_i` deg | `d_i` mm | `theta_i` | 论文表中的范围 |
|---:|---:|---:|---:|---|---|
| 1 | 0 | -90 | 399.1 | `q1` | `+170 … -170` |
| 2 | 350 | 0 | 0 | `-90` | `+135 … -100` |
| 3 | 42 | -90 | 0 | `q3` | `+70 … -200` |
| 4 | 0 | +90 | 451 | `q4` | `+270 … -270` |
| 5 | 0 | -90 | 0 | `q5` | `+130 … -130` |
| 6 | 0 | 0 | 82 | `180` | `+360 … -360` |

论文还明确：

- Frame `{0}` 绑定机器人基座，Frame `{6}` 绑定工具法兰；
- 采用标准 DH 形式构造 `T_0^6 = T_0^1 ... T_5^6`；
- 长度参数以 mm、角度参数以 deg 表示；
- 论文实验对象明确写为 5 kg、0.9 m 的 ABB IRB 1200。

### 论文表与 ABB 官方规格的冲突

| 字段 | 论文 S07 | ABB 官方手册 S01 | 处理 |
|---|---:|---:|---|
| J2 上限 | `+135°` | `+130°` | 以 ABB 官方规格作为限制；论文 DH 表不能原样覆盖 profile 限制 |
| J6 默认范围 | `±360°` | `±400°`，另有最大 revolution value `±242` | 以具体 ABB 规格和控制器配置为准；不能原样使用论文范围 |
| DH 约定 | 论文给出标准 DH 公式 | ABB 手册没有公开对应表 | 论文只作为候选运动学模型，必须用 FK/模型/示教姿态回归验证 |
| 零位/偏置 | 论文表没有给出 ABB 校准偏置数组 | ABB 手册说明同步标记和校准流程 | 仍缺少可直接写入 `thetaOffset` 的官方数值 |

论文中的 `399.1 / 42 / 451 / 82` 与 ABB 官方尺寸图的关键数量级一致；其中 `a2=350` 与经典 5/0.9 官方尺寸图的 `448` 不一致，应视为该论文坐标建模或型号/版本适配中的冲突项。即使尺寸一致，也不能证明论文的坐标轴原点、正方向、零位、法兰旋转和 Type A/Type B 配置已经与项目资产一致。因此不把论文表标记为“官方确认”。

### 3.1 另一套与 5/0.9 尺寸吻合的 DH 表

S12 的 Table 1 给出以下标准 DH 几何参数：

| Joint | `a_i` mm | `alpha_i` deg | `d_i` mm | `theta_i` |
|---:|---:|---:|---:|---|
| 1 | 0 | -90 | 399.1 | `theta1` |
| 2 | 448 | 0 | 0 | `theta2` |
| 3 | 42 | -90 | 0 | `theta3` |
| 4 | 0 | +90 | 451 | `theta4` |
| 5 | 0 | -90 | 0 | `theta5` |
| 6 | 0 | 0 | 82 | `theta6` |

这套表的 `448/451/82` 与 ABB 经典款 `5/0.9` 官方尺寸图、以及 S13 URDF 的关节原点数量级一致，因此它比 S07 的 `a2=350` 更适合作为当前项目的离线候选。但它仍然没有给出 ABB 校准零位数组、Type A/Type B 差异、模型节点到机械轴的映射，也没有证明与用户提供的 FBX 同源。

### 3.2 与 ROS-Industrial URDF 的刚体变换交叉检查

S13 对 `5/0.9` 给出的 URDF 等价链为：

| 关节 | `origin` | 旋转轴 |
|---:|---|---|
| J1 | `Tz(399.1 mm)` | `Z` |
| J2 | `T(0,0,0)` | `Y` |
| J3 | `Tz(448 mm)` | `Y` |
| J4 | `Tz(42 mm)` | `X` |
| J5 | `Tx(451 mm)` | `Y` |
| J6 | `Tx(82 mm)` | `X` |

该链在零位下的腕部中心位置为约 `x=451 mm, z=889.1 mm`，再沿 J6 方向增加 `82 mm` 得到法兰位置约 `x=533 mm, z=889.1 mm`，与 ABB 产品手册中的 5/0.9 尺寸图和零位工作位置吻合。这是参数之间的交叉证据，不是 ABB 官方发布的 DH 表。

针对当前项目的矩阵约定，若采用标准 DH 的 `a2=448` 表，需要在适配层明确记录 J2 的坐标系偏置（离线等价计算中为 `thetaOffset=-90°`）以及法兰/`tool0` 的固定旋转；这个偏置是当前坐标约定下的转换结果，不应直接宣称为 ABB 控制器的校准参数。

## 4. ROS-Industrial URDF/Xacro：可用等价描述，但不是 ABB 官方参数包

S06 的 ROS-Industrial 包说明明确指出：

- 包含 `IRB 1200-5/0.9` 和 `IRB 1200-7/0.7` 变体；
- 提供配置数据、3D 模型和 launch 文件，说明存在 URDF/Xacro 形式的机器人描述；
- 关节限制和最大关节速度基于 ABB 2016 datasheet；
- 5/0.9 的部分惯性值由网格估算，Gazebo 最大关节力矩是虚构的仿真值；
- 文档明确要求使用者根据实际机器人型号和配置自行检查。

因此，ROS-Industrial URDF 的判定为：

| 项目 | 结论 |
|---|---|
| 是否存在针对经典 5/0.9 的 URDF 等价描述 | 是 |
| 是否是 ABB 官方发布 | 否，来源是 ROS-Industrial 社区/SwRI |
| 是否可作为 FK/IK 起始输入 | 可以，前提是读取实际 URDF/Xacro 的 joint origin、axis、limit 和 mesh，并与 ABB 官方资料做回归 |
| 是否可以直接作为本项目网页资产 | 不能直接判断；URDF 需要转换，mesh 的来源和再分发条款仍需单独审计 |
| 是否可证明真实 ABB 校准精度 | 不能 |

## 5. RobotStudio 官方机制与等价刚体变换路线

这是目前最接近“官方可验证参数源”的路线。

### 5.1 官方 API 能力

S02/S03 公开文档确认：

- `Mechanism.GetDenavitHartenbergParameters()` 可返回机制全部关节的 DH 数组；没有可用 DH 时返回 null；
- `CalculateForwardKinematics()` 可根据关节值返回 tool0 变换；
- `CalculateInverseKinematics()` 可根据位姿和参考关节值求解；
- `GetJointLimits()`、`InsideLimits()` 可读取/检查关节限制；
- `GetJointTransform()` 可读取各关节在机制坐标中的变换；
- `GetFlange()`、`GetHomePosition()`、`SetJointModelOffset()` 等接口可覆盖法兰、零位姿态和模型偏置；
- S03 将 DH 字段定义为 `D`、`Theta`、`A`、`Alpha`。

### 5.2 官方机制文件能表达的字段

S04 的 RSXML 机制文档示例显示，机制定义可以表达：

- `baseLink`；
- 每个旋转关节的 parent、child、point1、point2；
- `Limits`；
- `Flange` 及其所属 link 和姿态；
- `BaseFrame`；
- `HomePosition`；
- `JointMask`；
- `lengthUnit="mm"` 和 `angleUnit="deg"`。

注意：S04 示例是 IRB1300，示例中的关节坐标和法兰数字不能复制给 IRB1200；它只证明官方机制描述的字段和读取路径。

### 5.3 当前缺口

本次公开检索没有找到 ABB 官方直接发布的 `IRB 1200-5/0.9` `.rslib`、RSXML 或 SDK 输出的 DH 数值文件。S05 还说明 RobotStudio 机制通常属于 `.rslib` 等 RobotStudio 分发包，而不是公开网页上的 GLB/URDF。

本机检查了：

- `C:\Program Files\ABB`
- `C:\Program Files (x86)\ABB`

这两个目录均不存在，因此当前环境没有可直接读取的 RobotStudio 安装机制库。

## 6. 对当前 TypeScript FK/IK 的直接适配判断

### 6.1 当前核心接口能复用的部分

当前项目的 `src/core/robot/types.ts` 已有：

- `DHParams { a, alpha, d, thetaOffset, thetaSign, thetaRange }`；
- 长度使用 mm；
- 页面关节输入使用 deg；
- `RobotModel.forwardKinematics()` 和 `estimateJacobian()` 接口。

当前 `solveIK()` 使用 FK 加有限差分雅可比，不要求 ABB 专用闭式 IK。因此在运动学约定被验证后，ABB 机器人可以复用现有 IK 框架。

### 6.2 不能直接复制论文表的原因

当前 `src/core/robot/kinematics.ts` 的 `dhTransform()` 矩阵排列与 S07 论文给出的标准 DH 矩阵并不相同。

论文标准 DH 形式的主要结构为：

```text
[ cosθ, -sinθ cosα,  sinθ sinα, a cosθ ]
[ sinθ,  cosθ cosα, -cosθ sinα, a sinθ ]
[ 0,     sinα,        cosα,       d       ]
[ 0,     0,           0,           1       ]
```

当前项目代码实际生成的旋转/位移结构等价于把 `Rx(alpha)`、`Tx(a)`、`Tz(d)` 和 `Rz(theta)` 按另一种顺序组合；它不是把上述论文矩阵逐项照抄进来的标准 DH 实现。除此之外，当前 `DhRobotModel` 还硬编码使用 `KUKA_LIKE`，页面和场景控制器也仍然以 KUKA 节点和配置为默认。

因此判定如下：

| 输入来源 | 能否直接驱动当前 TypeScript FK/IK | 原因 |
|---|---|---|
| ABB 官方产品手册尺寸/关节范围 | 否 | 缺少完整轴间变换、零位偏置、法兰变换 |
| S07 论文标准 DH 表 | 否 | DH 矩阵约定不同；并且 J2/J6 范围与官方规格冲突 |
| S12 论文标准 DH 表（`a2=448`） | 否，需转换和回归 | 几何尺寸与 URDF/官方图纸吻合，但仍缺少 ABB 校准偏置、Type A/Type B 机制差异和 FBX 对应关系 |
| ROS-Industrial URDF/Xacro | 否，需转换 | 需要解析 URDF 的 joint origin/axis/limit，转换到当前矩阵约定，并核验 mesh 与法兰 |
| RobotStudio `GetDenavitHartenbergParameters()` 输出 | 条件性可以 | 仍需明确 RobotStudio DH 约定、角度/长度单位、零位、基座和 tool0，并转换到当前核心矩阵语义 |
| 已核验的自有 ABB profile | 可以 | 需要先把 `thetaOffset`、`thetaSign`、范围和基座/法兰变换写成与当前核心一致的 profile，并用回归姿态验证 |

### 6.3 最小的可实现路线

不改业务代码的前提下，下一阶段应先完成一份离线验证数据：

1. 选定一个参数来源：优先是用户提供的已授权 RobotStudio 机制，次选 ROS-Industrial URDF，论文表只作为候选对照。
2. 明确每个关节的轴向、零位和 `thetaOffset`，不要从 FBX 外观猜。
3. 明确当前项目矩阵约定与来源 DH/URDF 的转换关系。
4. 用至少 3 组已知关节姿态比较：来源模型 FK、转换后 TypeScript FK、FBX 法兰位置/姿态。
5. 通过后再建立 `ABB IRB 1200-5/0.9` profile；在此之前不应把论文数字写入 `src`。

## 7. 用户提供的 FBX 检查结果

文件：`C:\Users\admin\Downloads\JQR_ABB(1).fbx`

已确认：

- 文件存在，大小 `1,222,736 bytes`；
- 是 FBX 二进制格式，文件头为 `Kaydara FBX Binary`；
- 可见 `Lcl Rotation`、`RotationOrder`、`RotationMin/Max` 等 FBX 属性字符串；
- 可见 `joint1` 至 `joint9` 等模型名称字符串；
- 文件路径/内部字符串包含 `JQR_ABB`，但没有足以证明完整产品型号的 `IRB 1200-5/0.9` 标识。
- 使用当前项目的 Three.js `FBXLoader` 成功解析；场景包含 `Root` 骨节点、`joint1` 至 `joint7` 的主链，以及从 `joint7` 分出的 `joint8`、`joint9`，共 31 个网格，无动画剪辑。
- FBX 全局 `UnitScaleFactor=1`；按 Autodesk FBX SDK 的单位定义，它是相对于厘米的比例因子。Three.js 解析后的包围盒约为 `83.25 × 167.30 × 50.00` 个场景单位，尚未与官方 `210 mm` 基座和 `967 mm` 机器人高度形成一致的比例证据。

尚不能确认：

- 是否真的是 ABB IRB 1200-5/0.9，而不是其他 ABB 外形或项目自制模型；
- 为什么存在 9 个 joint 名称，是否只有 6 个是机器人主动轴；
- `Root/joint1...joint7` 中哪些节点对应 ABB 的 J1-J6，`joint8/joint9` 是否属于末端工具或其他机构；
- FBX 中是否存在独立、可解释的 flange/tool0 节点；
- 每个关节旋转轴、旋转方向、零位和单位；
- 文件授权和是否允许转换、部署、再分发。

当前 FBX 的判断：**可作为待解析的候选视觉资产，不能作为已确认的 ABB 1200 FK/IK 驱动资产，也不能据此补齐 DH/MDH 参数。**

## 8. 最终确认清单

### 已确认

- 研究型号继续锁定为经典 `ABB IRB 1200-5/0.9`。
- ABB 官方资料确认了型号、6 轴、5 kg、0.9 m、主要关节范围、尺寸、单位和校准/轴方向资料。
- ABB 官方 RobotStudio SDK 确认存在读取 DH、FK、IK、关节限制、法兰、零位和模型偏置的机制 API。
- ROS-Industrial 存在明确针对 5/0.9 的 URDF/Xacro 支持。
- 一篇明确匹配 5/0.9 的原始研究论文给出标准 DH 表。
- 另一篇以 5/0.9 为对象的研究给出 `a2=448` 的 DH 几何参数；它与 ABB 5/0.9 尺寸图和 ROS-Industrial URDF 交叉吻合，但仍不是 ABB 官方标定数据。
- 当前 TypeScript 的数值 IK 可复用，但当前 DH 变换约定不能直接接受论文标准 DH 表。

### 未确认

- ABB 官方公开的经典 5/0.9 具体 DH/MDH 数值表。
- 当前项目应采用 `a2=448` 还是其他坐标系下的等价表达；公开论文之间存在冲突，必须通过统一矩阵和回归姿态决定。
- 当前具体机器人 Type A/Type B 的校准零位偏置和工具法兰刚体变换。
- RobotStudio 机制 `.rslib` 是否可由负责人合法导出并用于线上网页。
- ROS-Industrial URDF 的每个 origin/axis 是否与目标经典款和当前 FBX 完全一致。
- `JQR_ABB(1).fbx` 是否真是 5/0.9 以及其许可范围。

### 当前可以做的工程判断

- **可以继续讨论并设计 ABB profile 的字段契约。**
- **不能还没有核验就修改现有 FK/IK 常量。**
- **最可靠的下一份输入是用户提供的 RobotStudio 机制文件，或从 ROS-Industrial URDF/Xacro 中抽取的 joint origin/axis/limit，并配合官方规格做回归。**
- **当前 FBX 不足以代替机制文件。**

## 9. 需要负责人下一步提供或确认的内容

1. 如果电脑上能取得 RobotStudio，请提供对应 `IRB 1200 5kg/0.9m STD` 机制/模型文件，或允许使用 RobotStudio SDK 导出 DH、关节变换、法兰和零位数据。
2. 如果没有 RobotStudio，请确认是否允许把 ROS-Industrial `IRB 1200-5/0.9` URDF/Xacro 作为教学近似输入，并接受“不是 ABB 官方标定参数”的标注。
3. 提供 `JQR_ABB(1).fbx` 的来源和许可信息；如果它只是外观模型，需要另行提供 6 轴关节层级或机制数据。
4. 在获得上述资料前，不把 S07 论文 DH 表直接写入业务代码；它只能用于离线候选验证。
