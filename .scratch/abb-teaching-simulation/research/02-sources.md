# ABB IRB 1200 模型与参数研究来源

- 访问日期统一记录为：2026-08-10（Asia/Shanghai）。
- `[Sxx]` 是研究结果文档中的证据编号。
- 对动态页面、登录页面和 CAD 下载页，只记录公开可见事实；没有绕过登录、人机验证、下载限制或软件授权。
- “官方/第三方”按来源发布者判断；TraceParts 页面标注 ABB Robotics 制造商，但托管方不是 ABB，故列为第三方托管的制造商 CAD 页面。

| 编号 | 来源标题 | 官方/第三方 | URL | 访问日期 | 支撑事实 | 备注 |
|---|---|---|---|---|---|---|
| S00 | ABB IRB 1200 前端可用模型与对应运动学参数检索任务 | 项目内文件 | [01-abb1200-model-and-parameters-search-task.md](./01-abb1200-model-and-parameters-search-task.md) | 2026-08-10 | 当前项目为浏览器仿真；要求记录具体变体、模型层级、单位、授权和参数来源；禁止猜测和混用 | 用于解释项目基线和研究边界，不替代 ABB 技术参数 |
| S01 | ABB IRB 1200 Next Generation 官方产品页 | ABB 官方 | [abb.com IRB 1200 Next Generation](https://www.abb.com/global/en/areas/robotics/products/robots/articulated-robots/small-robots/irb-1200-next-generation) | 2026-08-10 | Gen2/Next Generation 产品定位；4 个型号：5/0.9、7/0.7、8/0.9、9/0.7；OmniCore；6 轴 | 证明 Gen2 是独立代际，不提供本研究所需的独立 GLB |
| S02 | Product specification - IRB 1200 Gen2，3HAC074710-001 | ABB 官方文档库 | [ABB Gen2 产品规格 PDF](https://library.e.abb.com/public/5ad735ae9a3640cda0052d07acabefeb/3HAC074710%20PS%20IRB%201200%20Gen2-en.pdf) | 2026-08-10 | Gen2 四型号、负载/臂展、名义质量、J1-J6 范围、最高轴速度、法兰图、校准和 RobotWare/OmniCore 背景 | Gen2 参数不能用于经典款模型；公开规格中未找到完整 DH/MDH/URDF 表 |
| S03 | Product specification - IRB 1200 on OmniCore，3HAC081417-001 | ABB 官方文档库 | [ABB 经典 IRB 1200 产品规格 PDF](https://library.e.abb.com/public/2a49a455c8cb40ccbd757b2dc9f33f4a/3HAC081417%20PS%20IRB%201200%20on%20OmniCore-en.pdf) | 2026-08-10 | 经典款型号、5/0.9 负载/臂展、6 轴和轴顺序、关节范围、速度、包络、主要尺寸、安装、校准/同步标记、坐标标准引用 | 选定推荐型号的主要参数来源；产品规格为机构族资料，具体订单配置仍需确认 |
| S04 | IRB 1200 Hygienic 官方产品页与产品规格入口 | ABB 官方 | [abb.com IRB 1200 Hygienic](https://www.abb.com/global/en/areas/robotics/products/robots/articulated-robots/small-robots/irb-1200-hygienic) | 2026-08-10 | Hygienic 5/0.9、7/0.7 型号；卫生应用；IP67/IP69K 相关设计；不锈钢轴 6 法兰；与标准款分开 | 变体辨析和 Hygienic 冲突来源 |
| S05 | IRB 1200 Hygienic CAD models / technical data | ABB 官方页面（staged ABB 域名） | [ABB Hygienic CAD 页面](https://new.stage.abb.com/products/robotics/nl/onze-robots/articulated-robots/irb-1200-hygienic) | 2026-08-10 | 页面列出 CATIA、STL、DXF/DWG、VDA、IGES、VRML、SAT、XT、STEP，并区分 component/joint；页面出现 700 规格选择 | 官方 CAD 入口；页面为 staged 链接，下载和再分发许可仍需确认 |
| S06 | Product specification - RobotStudio，3HAC026932 | ABB 官方文档库 | [ABB RobotStudio 产品规格 PDF](https://library.e.abb.com/public/0218010b18354c67a73df3e80269b044/3HAC026932-en.pdf) | 2026-08-10 | RobotStudio 产品/Robot Library 中包含 IRB 1200；RobotStudio 是官方仿真/编程软件 | 证明官方软件库存在，不证明资源可作为独立网页资产再分发 |
| S07 | Operating manual - RobotStudio，3HAC032104-001 | ABB 官方文档库 | [ABB RobotStudio 操作手册 PDF](https://library.e.abb.com/public/e5b8383d22fd40ea9e2510cd23a8e911/3HAC032104-001_en_BA_Operating_manual_-_RobotStudio.pdf) | 2026-08-10 | RobotStudio 基础/高级能力包含机器人库、仿真、导入/导出几何等能力 | 只说明软件功能边界；不能替代资产授权 |
| S08 | RobotStudio Subscription Model / License | ABB 官方 | [RobotStudio Subscription Model PDF](https://library.e.abb.com/public/ecb63911b1be5aeac12579e300423eed/RobotStudio%20Subscription%20Model.pdf) | 2026-08-10 | 使用 RobotStudio/组件受 EULA、订阅或许可条件约束 | 未发现允许将内部模型转换后放入线上应用的通用授权 |
| S09 | ABB Robotics - Free CAD models - IRB 1200 - TraceParts | 第三方托管/制造商标注 ABB Robotics | [TraceParts IRB 1200](https://www.traceparts.com/en/product/abb-robotics-irb-1200?Product=33-08032022-091040) | 2026-08-10 | 精确产品选择含 IRB 1200-5/0.9、-7/0.7；6 轴；负载/臂展/质量；STEP AP203/AP214/AP242、IGES、OBJ、STL、VRML、Three.js 等输出项 | 页面需要 JS/可能需要登录或人机验证；本次未绕过，也未把“免费 CAD”解释为网页再分发许可 |
| S10 | ABB IRB 1200 Industrial Robot | 第三方 | [Free3D model page](https://free3d.com/3d-model/abb-irb-1200-industrial-robot-9773.html) | 2026-08-10 | 页面列出 GLTF/GLB、FBX、OBJ、MAX；标记未 rigged、未 animated、无纹理；Editorial Only；没有精确变体 | 有实际 GLB 页面候选，但不满足可驱动和授权要求 |
| S11 | Industrial Robot ABB 3D Model | 第三方 | [TurboSquid model page](https://www.turbosquid.com/3d-models/industrial-robot-abb-model-1176791) | 2026-08-10 | 页面列出 glTF/FBX/OBJ 等格式；与 C4 同类模型；版权/品牌说明和 Editorial 使用限制 | 不作为项目模型；只能证明第三方 GLB 线索存在 |
| S12 | IRB1200-5-90 | 第三方聚合/GrabCAD 线索 | [STLFinder IRB1200-5-90](https://stlfinder.com/model/irb1200-5-90/4805642) | 2026-08-10 | 精确名称线索、STL 格式、来源指向 GrabCAD | 单体 STL 没有层级/轴证据；原始许可证不清晰，不可直接使用 |
| S13 | IRB 1200 Lite+ 官方产品页 | ABB 官方 | [abb.com IRB 1200 Lite+](https://www.abb.com/global/en/areas/robotics/products/robots/articulated-robots/lite-plus-robots/irb-1200-lite) | 2026-08-10 | Lite+ 是独立产品家族；产品页说明其与 IRB 1100 等协同，但未提供本任务所需完整运动学参数闭环 | 变体辨析；不选 Lite+ |
| S14 | Export robot to STEP in different poses - RobotStudio Community | ABB 官方社区 | [RobotStudio Community discussion](https://tech-community.robotics.abb.com/t/export-robot-to-step-in-different-poses/10441) | 2026-08-10 | 社区答复提示 RobotStudio ABB Library 中机器人不一定带 CAD 数据，建议从 ABB 网站获取 STEP 并构建机制 | 社区信息仅作限制和工作流线索，不替代正式许可或技术手册 |
| S15 | Release Notes RobotStudio 6.00.01 | ABB 官方文档库 | [RobotStudio 6.00.01 Release Notes PDF](https://library.e.abb.com/public/21b9cf4e220c7ca6c1257de200486ab7/ReleaseNotesRobotStudio60001.pdf) | 2026-08-10 | 官方发布说明的 Simulation Models/Robot Libraries 表明确列出 `IRB 1200 5kg/0.9m STD`、`IRB 1200 7kg/0.7m STD` 等模型，并说明模型随 RobotStudio 安装 | 这是 2015 年版本发布说明；证明官方历史版本存在精确模型，不保证当前版本、独立导出格式或网页再分发许可 |

## 来源使用说明

1. 型号、范围、速度、坐标标准、尺寸和校准结论优先使用 S02/S03/S04 等 ABB 官方资料。
2. C1 的格式和精确型号来自 S09；C3 的精确标准型号名称来自 S15。S09 是第三方托管页面，S15 是旧版官方发布说明，二者都必须单独核查实际文件版本和再分发权。
3. C4/C5 仅作为第三方候选或反例；它们不能支持“可驱动、严格对应、可线上再分发”的结论。
4. 本次检索没有找到 ABB 官方公开的完整 DH/MDH/URDF/等价刚体变换表。因此相关字段在研究结果和资产清单中明确写为“官方未公开/未确认”，没有使用无型号标注的网络参数表补齐。
