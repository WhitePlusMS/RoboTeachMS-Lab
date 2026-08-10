# ABB IRB 1200-5/0.9 DH/MDH 参数并行检索方案

## 任务目标

请多个 Agent 分工查找 ABB IRB 1200-5/0.9 的真实运动学参数。

目标：

1. 确认是否存在 ABB 官方完整 DH/MDH；
2. 确认是否存在官方 RobotStudio 机制文件；
3. 查找可复现的 URDF、源代码或论文模型；
4. 确认每组参数对应的具体型号；
5. 确认坐标系、零位、法兰、基座和单位；
6. 验证参数能否与当前 FBX 的 joint1 到 joint7 对齐。

本任务只做检索和结果记录，不修改项目源码、模型和当前 ABB 参数。

## 固定目标型号

- ABB IRB 1200-5/0.9；
- 经典标准款；
- 5 kg payload；
- 0.9 m reach；
- 6 axes；
- 非 Gen2 / Next Generation；
- 非 Hygienic。

IRB 1200-7/0.7、IRB 1200-7/0.9、IRB 1200-5/0.9 Gen2、Hygienic 和其他型号必须单独记录，不能混用。

## 证据等级

| 等级 | 来源 | 结论能力 |
|---|---|---|
| A | ABB RobotStudio机制、官方SDK导出、官方虚拟控制器 | 最强；可得到机制级参数 |
| B | ABB官方 rslib、rsxml、RobotWare机制文件 | 很强；需要确认版本和型号 |
| C | ABB官方手册、规格书、尺寸图 | 可确认型号、尺寸、限位；不能单独证明完整DH |
| D | ROS-Industrial、开源URDF、可复现源代码 | 可作为候选；必须做FK回归 |
| E | 明确型号的论文和学位论文 | 可作为候选；不是ABB官方标定值 |
| F | 博客、论坛、截图、无来源代码 | 只能提供关键词，不能直接采用 |

## Agent 分工

### Agent 1：ABB官方产品资料

查产品手册、规格书、官方CAD、校准说明、同步标记和法兰尺寸。

必须回答：

- 是否直接公开完整DH/MDH；
- 哪些数字只是机械尺寸；
- 轴限位和零位说明；
- 是否存在法兰和基座坐标定义。

### Agent 2：RobotStudio官方机制和SDK

查以下API：

- GetDenavitHartenbergParameters；
- CalculateForwardKinematics；
- CalculateInverseKinematics；
- GetJointTransform；
- GetCalibrationPosition；
- GetSyncPosition；
- GetHomePosition；
- ModelBaseFrame；
- GetFlanges；
- GetJointLimits；
- SetJointModelOffset。

必须确认DH字段顺序、单位、矩阵约定，以及是否能同时读取BaseFrame、Home、Calibration和Flange。

官方入口：

- https://developercenter.robotstudio.com/api/robotstudio/api/ABB.Robotics.RobotStudio.Stations.Mechanism.html
- https://developercenter.robotstudio.com/api/robotstudio/api/ABB.Robotics.RobotStudio.Stations.DenavitHartenbergParameters.html
- https://developercenter.robotstudio.com/api/robotstudio/articles/Walkthroughs/AuthorComponentsInRsxml.html

### Agent 3：RobotStudio机制文件

查：

- IRB1200_5_90_STD_01.rslib；
- IRB 1200 5kg/0.9m STD；
- IRB1200_5_90 rsxml；
- RobotStudio Robot Library；
- MechunitLibraryMap.xml；
- RobotWare mechanical unit。

记录文件是否存在、是否能从ABB官方入口取得、对应哪个变体、包含哪些字段、是否允许导出和再分发。

不得绕过ABB登录、下载限制或软件授权。

### Agent 4：RobotWare和控制器配置

查 MOC.cfg、RobotWare mechanical unit、IRC5 robot type、OmniCore robot type和calibration data。

必须区分：

- 通用机制参数；
- 某一台真实机器的校准参数；
- 控制器配置参数。

不得索取或上传用户私有控制器备份，只报告需要的文件名和字段。

### Agent 5：ROS-Industrial和URDF

查 irb1200_5_90_macro.xacro、irb1200_5_90.urdf、joint origin、axis、limit、flange和tool0。

逐关节记录 origin xyz、origin rpy、axis和limit，并确认文件确实对应5/0.9。

必须标记：这是开源等价描述还是ABB官方参数。

### Agent 6：GitHub和开源运动学代码

查 IRB1200_5_90 DH、IRB1200-5-0.9 kinematics、forward kinematics、robotics toolbox、flange和tool0。

检查代码是否真正执行FK、参数是否有来源、矩阵属于标准DH还是MDH、是否有测试姿态、许可证是什么。

### Agent 7：MATLAB和Python机器人库

查 SerialLink IRB1200、DHRobot IRB1200、Robotics Toolbox IRB1200和roboticstoolbox IRB1200。

确认具体变体、Link参数、零位、坐标系和是否只是教学近似。

### Agent 8：论文和学位论文

查 IRB 1200-5-0.9 DH、IRB 1200-5/0.9 kinematics、IRB 1200 Denavit-Hartenberg和ABB IRB1200 MDH。

记录型号、DH/MDH表、公式、home position、J2/J6偏置、关节范围和内部矛盾。

论文只能作为候选，不能标记为ABB官方校准数据。

### Agent 9：中文资料

查 ABB IRB 1200-5/0.9 DH参数、IRB1200运动学参数、标准DH、改进DH、正运动学和逆运动学。

重点审查是否引用原始来源，是否混淆 a2=448 和 a2=350，是否混淆型号。

### Agent 10：CAD、STEP和装配文件

查 IRB1200-5-90 STEP、IRB 1200 5/0.9 CAD assembly、joint CAD、flange CAD和tool0。

确认是单体网格还是装配体、是否保存关节轴和原点、是否有单位、是否允许转换和再分发。

### Agent 11：当前FBX结构

只分析FBX结构，不把FBX当成ABB官方DH来源。

记录 Root、joint1 到 joint9父子关系、局部变换、旋转轴、joint7含义、joint8和joint9含义、dizuo固定支架、单位和缩放。

必须区分FBX等价刚体链、ABB官方DH和根据FBX拟合的参数。

### Agent 12：冲突审查

集中比较所有候选值：

- a2=448；
- a2=350；
- d1=399.1；
- d4=451；
- d6=82；
- J2偏置；
- J6偏置；
- J2和J6范围；
- 标准DH和MDH矩阵顺序。

每个冲突必须归类为型号不同、代际不同、坐标系不同、DH约定不同、零位偏置不同、论文错误或未知。

## 统一搜索词

英文：

- "IRB1200_5_90" DH
- "IRB1200_5_90_STD_01"
- "IRB 1200 5kg/0.9m STD" kinematics
- "IRB 1200-5/0.9" "Denavit-Hartenberg"
- "IRB 1200-5-0.9" MDH
- "IRB1200_5_90" URDF
- "IRB1200_5_90" rslib
- "IRB1200_5_90" rsxml
- "IRB1200" flange tool0
- "IRB1200" joint origin axis

中文：

- ABB IRB 1200-5/0.9 DH参数
- ABB IRB1200 5/0.9 运动学参数
- ABB IRB1200 标准DH
- ABB IRB1200 改进DH MDH
- ABB IRB1200 RobotStudio 机制
- ABB IRB1200 法兰坐标
- ABB IRB1200 零位偏置

## 重点冲突

任何Agent发现以下数字，都必须说明来源、型号、DH convention和零位：

- a2=448；
- a2=350；
- d1=399.1；
- d4=451；
- d6=82；
- J2的角度偏置；
- J6的角度偏置；
- J2和J6的关节范围。

不能因为数字出现次数最多，就认定它是正确参数。

## 每个候选必须填写

| J | a | alpha | d | theta/offset | axis | limit | 来源 |
|---:|---:|---:|---:|---|---|---|---|
| 1 |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |

另外必须填写：

- 完整型号；
- 经典款、Gen2或Hygienic；
- 标准DH、MDH、URDF或自定义矩阵；
- 矩阵乘法顺序；
- 长度和角度单位；
- q=0的含义；
- BaseFrame；
- Flange/tool0；
- Home Position；
- Calibration/Sync；
- 许可证和再分发限制。

## 统一FK复现姿态

如果来源提供测试姿态，优先使用来源姿态。

如果来源没有测试姿态，使用：

- q0 = [0, 0, 0, 0, 0, 0]
- q1 = [10, 0, 0, 0, 0, 0]
- q2 = [0, 10, 0, 0, 0, 0]
- q3 = [0, 0, 10, 0, 0, 0]
- q4 = [0, 0, 0, 10, 0, 0]
- q5 = [0, 0, 0, 0, 10, 0]
- q6 = [0, 0, 0, 0, 0, 10]
- qmix = [25, -20, 35, 15, -25, 30]

至少记录法兰位置、法兰旋转、矩阵约定、单位、来源差异和是否可通过固定Base/Tool变换对齐。

一个零位姿态对上，不代表参数正确。至少需要零位、三组单轴姿态和一组复合姿态。

## Agent交付格式

每个Agent必须返回：

1. Agent编号和搜索方向；
2. 搜索日期；
3. 具体型号；
4. 证据等级；
5. 参数或等价变换表；
6. convention、单位和矩阵顺序；
7. BaseFrame、Home、Calibration、Flange和Tool0；
8. FK复现结果；
9. 与其他资料的冲突；
10. 是否可直接用于项目；
11. 原始来源标题、作者或组织、URL和访问日期；
12. 许可证或再分发风险。

禁止只返回没有型号的DH表、搜索结果页面、无来源代码或“看起来应该是448”的判断。

## 最终汇总必须回答

1. 是否找到ABB官方完整DH；
2. 如果没有，RobotStudio是否能读取；
3. 是否找到官方机制文件；
4. 是否找到与5/0.9明确匹配的URDF或源代码；
5. a2=448和a2=350分别来自什么型号或坐标约定；
6. J2和J6偏置分别来自哪里；
7. 哪组参数可以进入项目验证；
8. 哪些参数仍需RobotStudio、实机或FBX对照确认；
9. 是否存在许可证或再分发阻塞。

## 项目边界

汇总完成前，不修改：

- src/robots/abb-irb1200；
- src/scene/abb-scene.ts；
- src/core/robot/ik-solver.ts；
- KUKA相关代码；
- public/models；
- package.json。

相关研究记录：

- 01-abb1200-model-and-parameters-search-task.md
- 02-abb1200-model-and-parameters-research-result.md
- 03-github-reference-projects.md
- 04-abb1200-dh-mdh-search-result.md
- 05-official-abb-kinematics-source.md

检索日期：2026-08-10
