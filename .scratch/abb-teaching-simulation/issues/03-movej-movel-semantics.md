# 03 — 确定 ABB RAPID 运动指令子集与仿真语义

Type: grilling
Status: resolved
Blocked by: None
Part of: ../map.md

## Question

以 ABB 官方 RAPID 参考资料为基准，确定首期运动指令子集及其浏览器仿真语义。目标不是另造一套“像 ABB 的教学指令”，而是在不实现真实控制器通信的前提下，尽可能保留真实 RAPID 的代码结构、数据类型、参数和运动差异。

需要决定：

- MoveJ、MoveL、MoveAbsJ、MoveC 等指令哪些进入首期，哪些延后；
- robtarget、jointtarget、speeddata、zonedata、tooldata、wobjdata 等数据类型首期保留哪些字段；
- MoveJ 使用 robtarget 的关节运动、MoveAbsJ 使用 jointtarget 的绝对关节运动、MoveL 的笛卡尔直线运动如何分别映射到现有正解/逆解和关节过渡模块；
- 速度、zone/fine、工具坐标和工件坐标在浏览器中的可观察语义；
- 目标不可达、关节超限、奇异、配置不一致和姿态约束失败时的状态与错误信息；
- 单条指令成功、失败、暂停、停止和完成的判定；
- 哪些 RAPID 语法可以保持原样，哪些只能做明确标注的仿真降级。

决定应同时服务于真实 ABB 程序开发人员和学习者。不能把“浏览器里不能直接运行”误解成“可以随意改写 RAPID 语义”。

## 现有能力的复用约束

- 正解和逆解继续作为运动学实现，不为 MoveJ/MoveL 复制一套算法。
- 现有 MotionRunner 继续负责关节目标的时间过渡、限速、停止和帧循环。
- MoveJ/MoveL 需要新增的是指令解释和路径规划：MoveJ/MoveAbsJ 生成关节目标，MoveL/MoveC 生成笛卡尔路径采样并逐点求逆解。
- 如果需要串行执行多个路径采样点，应增加程序执行编排能力或扩展现有 MotionRunner 的完成通知；不能通过快速重复提交目标，依赖当前“目标替换”语义伪造队列。

## Answer

本票决策如下：

- 首期运动指令只进入 MoveJ、MoveL；MoveC、MoveAbsJ 和其他 RAPID 运动指令留到后续阶段单独决策。
- 程序数据结构保留 ABB RAPID 的完整记录形状，首期重点覆盖 robtarget、jointtarget、speeddata、zonedata、tooldata、wobjdata；暂未实现的字段必须明确标记，不得静默删除或改写成自定义语义。
- MoveJ、MoveL 不新建动画系统。MoveJ 使用现有正解/逆解和 MotionRunner；MoveL 由路径规划生成笛卡尔采样点，逐点求逆解，再由程序执行编排器等待每段完成后提交下一段。
- 程序执行需要同时暴露程序指针和运动指针，并支持运行、单步、暂停、停止、复位、完成和错误状态。
- 首期实现 fine 停点与常用 zone 预设的可观察差异：fine 等待目标完成，zone 允许相邻路径提前过渡；不在首期伪造 ABB 控制器的全部内部速度规划。
- 首期保留 tooldata、wobjdata 的数据契约，并提供 tool0、wobj0 默认对象；完整的用户对象编辑和校准能力后续再决定。
- 产品边界是“尽可能接近 ABB RAPID 的仿真编程教育平台”。它复用公开的指令、数据类型和运动语义，但不试图从头复制 ABB 控制器、完整 RAPID 编译器或控制器通信。

依据：

- ABB RAPID Overview：robtarget 用于末端目标，jointtarget 用于 MoveAbsJ/MoveExtJ，speeddata、zonedata、tooldata、wobjdata 属于运动数据。
  https://library.e.abb.com/public/4dda76ae22e341fca14d56f0a609d45c/3HAC050947%20TRM%20RAPID%20Overview%20RW%206-en.pdf
- ABB RAPID Instructions：MoveAbsJ、MoveC、MoveJ、MoveL 是不同的运动指令。
  https://library.e.abb.com/public/57fea78a6b37441db06ea9f6eba97025/3HAC050917%20TRM%20RAPID%20RW%206-en.pdf
