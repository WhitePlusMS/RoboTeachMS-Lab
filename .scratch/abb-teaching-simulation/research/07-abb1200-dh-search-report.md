# ABB IRB 1200-5/0.9 DH/MDH 深度检索与冲突裁决报告

- 检索日期：2026-08-10
- 研究对象：经典款 `ABB IRB 1200-5/0.9`（5 kg / 0.9 m / 6 轴；**非** Gen2/Next Generation、**非** Hygienic、**非** Lite+）
- 检索方式：deep-research 工作流（Scope → 5 路检索 → 抓取 19 个来源 → 62 条 claim 提取 → 25 条 claim 3 票对抗验证 → 综合）
- 验证结果：25 / 25 条 claim 全部通过 3 票对抗验证（0 条被否决、0 条未决）
- 证据索引：本报告结论带 URL 与证据等级（A–F，见下文）
- 项目边界：本轮仅检索与记录，**未修改任何项目源码**（`src`、`public/models`、`package.json` 均不动）

> ⚠️ 成本提示：本次 deep-research 实际调度了 101 个 Agent、约 212 万子 Agent token、878 次工具调用，耗时约 28 分钟；并触发 3 次 429 限流（1 分钟内最多 40 次请求）。**后续如需复查，请直接使用本报告已核验的一手来源，不要再跑并行检索。**

## 结论先行

1. **ABB 官方没有公开经典 5/0.9 的完整 DH/MDH 数值表。** 官方公开页只给出营销级规格（0.9 m 臂展、5/7/8/9 kg 负载、重复定位精度 ~0.011 mm 等），不含 DH 参数、逐关节角度范围、连杆毫米尺寸或零位偏置。唯一可定位的官方数值锚点是 datasheet `ROB0275EN_A`（2016-09，经 `abb_irb1200_support/package.xml` 反推），本次**未能直接取回**该 datasheet 内容。[证据等级 A/C：官方页面 + package.xml；来源见下]
2. **权威的开源运动学模型 = ROS-Industrial URDF**（`ros-industrial/abb` 仓库，`abb_irb1200_support/urdf/irb1200_5_90_macro.xacro`，含 wrapper `irb1200_5_90.xacro`）。**没有找到**任何官方可下载的 `.rslib`/`.rsxml` RobotStudio 机制文件。[证据等级 D]
3. **a2=448 与 a2=350 的争议，在"URDF 顺序偏移"层面解决为 448**：URDF 中 `joint_3 origin xyz='0 0 0.448'`（J2↔J3 之间的垂直 z 偏移），且整个文件里**不存在 0.350 这个数值**。350 属于**另一种 DH 坐标指派（frame-assignment）**下的解读，不是 ROS-Industrial URDF 的编码值。[证据等级 D]
4. **d1=399.1、d4=451、d6=82 均与 URDF 逐字匹配，可靠**（`joint_1='0 0 0.3991'`、`joint_5='0.451 0 0'`、`joint_6='0.082 0 0'`、`joint_4='0 0 0.042'`）。
5. **J2 范围 = −100°..+130° 确认**（URDF `−1.745..+2.269 rad`，逐字核实），且为 5/0.9 特有（兄弟 7/0.7 是 −100..+135）。
6. **J6 在本 URDF 中为 ±360°（±6.283 rad），不是问题里引用的 ±400°。** ±400° **未出处、未证实**：既不在 URDF，也未能追溯到任何一手 ABB 来源。
7. **零位偏置**：URDF 所有关节 origin 的 `rpy='0 0 0'`，即模型未施加额外的 J2/J6 角度零位偏置，限位围绕标准物理零位姿态给出。这**不能**等同于 ABB 控制器的校准零位偏置（calibration/sync offset）——后者仍需 RobotStudio 机制或实机数据。

---

## 一、关键候选值的逐项裁决

### 1.1 `a2=448` vs `a2=350`

| 项 | 结论 | 证据 |
|---|---|---|
| URDF 编码值 | **448 mm**，作为 J2↔J3 原点间垂直 z 偏移（`joint_3 origin xyz='0 0 0.448'`，Y 轴旋转关节） | 多个验证 Agent 逐字读取 `raw.githubusercontent.com/ros-industrial/abb/kinetic-devel/.../irb1200_5_90_macro.xacro` |
| 350 是否存在 | URDF 全文**无 0.350** | 验证 Agent 确认「file contains NO 0.350 value anywhere」 |
| 448 是什么 | 是 `d3`（URDF 顺序偏移里 J2→J3 的 z 列），不是水平前臂 | fetch Agent 8、16 均标注「448 is modeled as d3 (vertical offset between joint_2 and joint_3)」 |
| 350 是什么 | 一位验证 Agent 指出「ABB 经典 DH 的 a2 有时被写成 350 mm」→ 属**严格/另一种 DH frame-assignment** 下的标签 | open question (3) |
| 裁决 | **448 是本模型物理连杆 2（上臂）几何在 URDF 中的编码值；350 是 DH 坐标指派差异的产物**，无法仅凭开源 URDF 判定 ABB 官方 DH 表会打印哪个符号 | finding (2) + caveat (2) + open question (3) |

> ⚠️ **必须诚实标注**：ROS-Industrial URDF 用**笛卡尔 joint-origin 偏移 + 旋转轴**表达运动学，**不是显式的 DH/MDH 表**（全文无 `a/d/alpha/theta` 标签）。因此把「448 / 451 / 82」写成 `a2 / d4 / d6` 是**把 URDF 的 frame offset 映射到 DH 符号的解释步骤**，不是 ABB 或仓库原文标注。任何把这些值当 ABB 官方 DH 引用的做法都需附带这一 caveat。[caveat (1)]

### 1.2 `d1=399.1`、`d4=451`、`d6=82`

| 符号（URDF 语义） | URDF 逐字值 | 换算 | 判定 |
|---|---|---|---|
| d1 = base→J1 垂直偏移 | `joint_1 xyz='0 0 0.3991'` | 399.1 mm | ✅ 高置信 |
| d4 = J4→J5 前臂水平偏移 | `joint_5 xyz='0.451 0 0'` | 451 mm | ✅ 高置信 |
| d6 = J5→J6 腕部偏移 | `joint_6 xyz='0.082 0 0'` | 82 mm | ✅ 高置信 |
| J3→J4 偏移 | `joint_4 xyz='0 0 0.042'` | 42 mm | ✅（与 `a3=42` 一致）|

以上经 3 位验证 Agent 相互独立逐字读取并转换弧度→角度确认。注意 d1 走的是「局部 forward 参考 `abb_irb1200_5_90_macro.xacro`，`d1=399.1` 而非常见口语的 400 mm」的证据；`0.3991 m` 是 URDF 编码，非 400 mm。[finding (3)]

### 1.3 J2 与 J6 的角度零位偏置

- **URDF 层面**：所有 joint origin `rpy='0 0 0'` → 模型未给 J2/J6 施加额外角度零位偏置，限位围绕标准物理零位给出。
- **ABB 控制器层面**：这不等于 ABB 的校准/同步零位偏移（calibration、sync position、joint model offset）。本检索**未找到**任何可写成 `thetaOffset` 的官方校准偏置数组。仍需 RobotStudio 机制或实机数据。[caveat (5) 引申]

### 1.4 J2 与 J6 的关节范围

| 关节 | 本 URDF 逐字值 | 换算 | 判定 |
|---|---|---|---|
| J2 | `<limit lower='-1.745' upper='2.269' velocity='4.189'/>` | −100.0° .. +130.0° | ✅ 与官方规格一致；**5/0.9 特有**（7/0.7 为 −100..+135）|
| J6 | `<limit lower='-6.283' upper='6.283' velocity='10.472'/>` | ±360° | ⚠️ 与问题中「默认 ±400°」**不符** |

**J6 ±400° 未证实**：该值既不在 URDF（URDF 用 ±360°）、也不在 ABB Gen2 官方页。它很可能存在于官方 ABB datasheet/手册（如 `ROB0275EN_A`）或 RobotStudio 机制文件里，但本次未取到该一手来源，**不能认定 ±400° 为经典 5/0.9 的可靠值**。[finding (5) + open question (1)]

---

## 二、ABB 官方 DH/MDH 是否存在

- **公开产品页**（`new.abb.com` 的 IRB 1200 页）只有性能/机械规格（臂展、负载、重复精度、速度），**没有** DH/MDH、逐关节工作范围或毫米连杆长度。[finding (1)]
- 注意：研究问题里引用的 `abb.com ... irb-1200-next-generation` 是 **Gen2「Next Generation」家族页**，不是经典款；四位 Gen2 变体（5/0.9、7/0.7、8/0.9、9/0.7 Gen2）不能当作经典款参数来源。[finding (1)]
- **结论**：ABB 官方**公开**发布的只有机械尺寸/规格，不是完整 DH/MDH 表；真正的机制级 DH 数据在 RobotStudio 加载的 mechanism/虚拟控制器模型里，需要通过 `GetDenavitHartenbergParameters()` 等 API 读取，或由负责人导出 `.rslib`/`.rsxml`。

## 三、RobotStudio 机制文件（rslib/rsxml）是否存在

- 本次**未定位**到经典 5/0.9 的官方可下载 `.rslib`/`.rsxml` 机制文件。
- 存在**官方社区线索** `IRB1200_5_90_STD_01.rslib`（历史 RobotStudio library 名称，见前序研究 05 号文件），但本次未取得文件本身，且受 RobotStudio EULA/订阅约束，**不得**绕过 ABB 登录/授权抓取或再分发。
- 可行的官方路径：在已授权的 RobotStudio 中加载对应 mechanism，用官方 SDK 读取 DH、BaseFrame、Flange、Home、Calibration、JointLimits、JointModelOffset，并导出为项目自有 profile。**这仍是获取官方机制级参数的首选路线（证据等级 A）。**

## 四、与 5/0.9 明确匹配的开源 URDF/源码

- **可下载、版本匹配**：`ros-industrial/abb`（kinetic / melodic / noetic 分支）`abb_irb1200_support/urdf/irb1200_5_90_macro.xacro` + `irb1200_5_90.xacro`。明确匹配经典 5/0.9，`package.xml` 覆盖「IRB 1200-5/0.9 与 IRB 1200-7/0.7」。[finding (6)]
- **不是** RobotStudio 机制文件；是 URDF/xacro。
- 附带 `abb_irb1200_5_90_moveit_config/config/kinematics.yaml` 的 OPW 几何参数：`c1=0.3991, c2=0.448, c3=0.451, c4=0.082`（米），其中 `c2=0.448` 进一步支持 448 mm 连杆偏移。[fetch agent 25]
- **引用纠错（caveat 3）**：部分搜索结果把文件标到 `ros-industrial/abb_experimental`，但该仓库只是空 metapackage stub（无任何运动学）；**真实数据在 `ros-industrial/abb`**。引用时必须指到 `ros-industrial/abb`。
- 许可：ROS-Industrial 仓库为 Apache-2.0；URDF 可作为教学近似输入（证据等级 D），但不是 ABB 官方标定参数。

---

## 五、带入项目的推荐（严格标注来源与等级）

> 以下为**建议**，本轮**未修改任何源码**。

1. **可进入项目验证的候选（标注「ROS-Industrial URDF 等价模型」而非「ABB 官方 DH」）**：
   - 几何 `d1=399.1 / a2=448(垂直偏移) / a3=42 / d4=451 / d6=82 mm`
   - 限位 `J2 −100°..+130°`；J6 先用 URDF 的 `±360°`，**不要把 ±400° 写入**（除非拿到官方 datasheet）
   - 零位参照 URDF 的 `rpy=0` 物理零位；**不宣称**存在 J2/J6 官方校准偏置
2. **必须用 FK 回归验证**：至少零位 + 三组单轴 + 一组复合姿态，比较「URDF FK」vs「页面 TypeScript FK」vs「FBX 法兰位姿」，再决定是否写入 `src/robots/abb-irb1200`。
3. **仍需 RobotStudio/实机/FBX 对照确认**：
   - ABB 官方 DH/MDH 数值表（若追求官方标定）
   - J2/J6 的校准零位偏置与 `SetJointModelOffset`
   - `joint7..joint9` 与 FBX 的映射（本检索不含 FBX 内部解析，见前序研究）
   - J6 的 ±400° vs ±360°
4. **许可证/再分发阻塞**：官方 `.rslib`/`.rsxml` 受 RobotStudio EULA 约束，不可直接打包进网页；ROS-Industrial URDF（Apache-2.0）可再分发/归档，但网格与再分发条款仍需单独审计。

## 六、来源清单（标题 / 组织 / URL / 访问日期 / 证据等级）

| 编号 | 来源 | 组织 | URL | 访问 | 等级 |
|---|---|---|---|---|---|
| S-R1 | irb1200_5_90_macro.xacro | ROS-Industrial | raw.githubusercontent.com/ros-industrial/abb/kinetic-devel/abb_irb1200_support/urdf/irb1200_5_90_macro.xacro | 2026-08-10 | D（primary）|
| S-R2 | ros-industrial/abb 仓库 urdf 目录 | ROS-Industrial | github.com/ros-industrial/abb/tree/noetic-devel/abb_irb1200_support | 2026-08-10 | D（primary）|
| S-R3 | IRB1200 MoveIt config（OPW 几何） | ROS-Industrial | github.com/ros-industrial/abb/blob/kinetic-devel/abb_irb1200_5_90_moveit_config/config/kinematics.yaml | 2026-08-10 | D（secondary）|
| S-R4 | abb_irb1200_support/package.xml（datasheet ROB0275EN_A 反推） | ROS-Industrial | github.com/ros-industrial/abb/blob/master/abb_irb1200_support/package.xml | 2026-08-10 | D（primary）|
| S-R5 | IRB 1200 Next Generation 页 | ABB | abb.com/global/en/.../irb-1200-next-generation | 2026-08-10 | A/C（营销规格，非 DH）|
| S-R6 | IRB 1200 经典款产品页 | ABB | new.abb.com/products/robotics/industrial-robots/irb-1200 | 2026-08-10 | C（营销规格）|
| S-R7 | irb1200_7_70_macro.xacro（用于 J2 范围反证） | ROS-Industrial | raw.githubusercontent.com/ros-industrial/abb/kinetic-devel/abb_irb1200_support/urdf/irb1200_7_70_macro.xacro | 2026-08-10 | D（primary）|
| S-R8 | abb_experimental 仓库（空 stub，非数据源） | ROS-Industrial | github.com/ros-industrial/abb_experimental | 2026-08-10 | —（排除项）|

## 七、遗留未决问题（Open Questions）

1. **J6 ±400° 到底出自哪里？** 不在 URDF（±360°）、不在 Gen2 官方页。很可能在官方 ABB datasheet/手册（如 `ROB0275EN_A`）或 RobotStudio 机制文件中，需一手 ABB 文档确认或否定 ±400°。
2. **ABB 官方 DH/MDH 表是否在别处发布过？**（datasheet 附录、RobotStudio `.rslib/.rsxml` 机制、或「Technical reference manual RAPID」运动学附录）。本次仅能反推 datasheet ID `ROB0275EN_A`，未取回正文。
3. **在 ABB 严格/经典 DH frame-assignment 下，上臂参数应标 a2=448 还是 a2=350？** 一位验证者称「ABB 经典 DH a2 = 350 mm」，而所有 URDF 读取都是 448 → 这是 frame-convention 差异，**仅凭开源 URDF 无法裁决**。
4. **是否存在经典 5/0.9 官方 RobotStudio 机制（.rslib/.rsxml）或 ABB 认可的 URDF**，能直接读出 DH，并顺带确认/否定 J6 ±400°？

## 八、给后续阶段的建议

- 若追求「教学近似 + 可追溯」，ROS-Industrial URDF（Apache-2.0，证据等级 D）是目前**唯一拿到手、可复现、与 5/0.9 明确匹配**的运动学来源，可用它做 FK 回归基准。
- 若追求「官方机制级精度」，必须走 RobotStudio 机制 API 导出（证据等级 A），或由负责人提供已授权机制文件；在此之前不宜把任意数字宣称为 ABB 官方 DH。
- 任何写入 `src/robots/abb-irb1200` 的 DH/URDF 等价参数，都必须同时记录其来源、版本、证据等级与「是否 ABB 官方/是否开源等价」的标注，避免后续被当作官方真值。
