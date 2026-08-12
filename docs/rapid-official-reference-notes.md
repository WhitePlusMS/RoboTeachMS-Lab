# ABB RAPID 编程语言 —— 官方参考资料调研笔记

> 调研日期：2026-08-12
> 目的：为本项目（ABB IRB 1200 教学仿真前端的 RAPID 解析 / 运动学 / 教学判断模块）建立一份**基于官方文档**的 RAPID 语言能力清单与语法笔记。
> 说明：所有条目均标注来源 URL；"用途说明"描述该能力在真实工业 RAPID 程序及本项目解析器中的含义。

---

## 0. 官方 / 权威来源清单（高可信）

### ABB 官方出版物
| 编号 | 文档 | 来源 URL |
|---|---|---|
| 1 | **Technical Reference Manual – RAPID Instructions, Functions and Data Types（RobotWare 7）**（= RAPID Reference Manual Part 1） | https://library.abb.com/d/3HAC065038-010 , https://library.abb.com/d/9AKK107046A8697 |
| 2 | Technical Reference Manual – RAPID Instructions, Functions and Data Types（RW 6） | https://library.abb.com/d/3HAC050917-001 |
| 3 | Technical Reference Manual – RAPID（旧版 Part 1, 3HAC16581-1 rev J） | https://library.e.abb.com/public/688894b98123f87bc1257cc50044e809/Technical%20reference%20manual_RAPID_3HAC16581-1_revJ_en.pdf |
| 4 | **Technical Reference Manual – RAPID Overview** | https://search.abb.com/library/Download.aspx?DocumentID=3HAC050947-001 , https://search.abb.com/library/Download.aspx?DocumentID=3HAC065040-001 |
| 5 | 官方 RAPID Instructions PDF（Rapid_instructions.pdf） | https://library.e.abb.com/public/b227fcd260204c4dbeb8a58f8002fe64/Rapid_instructions.pdf |
| 6 | ABB Robotics 官方技术社区（RAPID Programming 板块） | https://tech-community.robotics.abb.com/ |
| 7 | RobotStudio 官方开发中心（RobTarget / RapidDataType 等 RAPID 领域对象） | https://developercenter.robotstudio.com/api/pcsdk/api/ABB.Robotics.Controllers.RapidDomain.RobTarget.html |

### 高质量第三方课程 / 教程（作为官方手册的可读性补充）
| 编号 | 来源 | 来源 URL |
|---|---|---|
| A | Xpert Robotics – ABB RAPID Programming Basics（首个模块示例） | https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics |
| B | DA Dynamic Automation – ABB RAPID Fundamentals & Best Practices | https://www.dynamic-automation.de/en/blog/abb-rapid-programming |
| C | Control.com – ABB Robot Example Programming Tutorial | https://control.com/technical-articles/abb-robot-example-programming-tutorial/ |
| D | plcprogramming.io – ABB Robot Programming Tutorial | https://plcprogramming.io/blog/abb-robot-programming-tutorial |
| E | GitHub – FLo-ABB/RAPID-Scripts-and-Demos（官方工程师示例脚本） | https://github.com/FLo-ABB/RAPID-Scripts-and-Demos |

> 注：DuckDuckGo MCP 搜索接口在本环境被反爬拦截时，改用 Playwright 浏览器（1920x1080）直接访问 DuckDuckGo 搜索页，成功获取以上全部来源。（来源：搜索结果页 https://duckduckgo.com/ ）

---

## 1. 程序结构（Program Structure）

RAPID 是结构化语言（类似 Pascal / C 风格），不以行号组织。

### 1.1 MODULE ... ENDMODULE（程序模块）
- 一个 RAPID 程序由一个或多个 `MODULE` 组成。“程序文件”（program file）与“模块文件”（module file）均是模块。
- 每个模块包含**数据声明**（VAR / CONST / PERS）与**例程**（routine：PROC / FUNC / TRAP）。
- 语法示例：
  ```rapid
  MODULE MainModule
    PERS num partCount := 0;
    PROC main()
      ...
    ENDPROC
  ENDMODULE
  ```
- 来源：https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics（结构定义与示例）；https://search.abb.com/library/Download.aspx?DocumentID=3HAC050947-001（RAPID Overview）
- 用途说明：本项目解析器中"程序 = 多个模块"，程序数据（Program Data）应从模块的数据声明区派生。

### 1.2 PROC ... ENDPROC（过程 / 子程序）
- `PROC` 定义无返回值的例程（相当于子程序），是机器人任务的主要执行单元。
- 例：`PROC PickPart() MoveL pickPos, v100, fine, gripper; ... ENDPROC`
- 来源：https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics ；https://www.dynamic-automation.de/en/blog/abb-rapid-programming
- 用途说明：对应教学"程序条目 / 指令行"的容器；`main` 为程序入口。

### 1.3 FUNC（函数，有返回值）
- `FUNC` 定义带返回值的例程，例如位置偏移 `Offs()`、`RelTool()` 等内置函数，或用户自定义函数。
- 来源（FUNC 属三类例程之一）：https://www.dynamic-automation.de/en/blog/abb-rapid-programming （PROC / FUNC / TRAP 三大类）；RAPID Overview – 3HAC050947-001
- 用途说明：本项目 RAPID 解析需区分指令调用与函数/表达式（函数有返回值，可用于组合 robtarget）。

### 1.4 主程序 main（程序入口）
- 每个机器人任务（Task，如 T_ROB1）必须有一个名为 `main` 的过程（`PROC main()`），它是执行起点。
- 来源：https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics （“The entry point is always a PROC named main.”）；ABB 社区 https://tech-community.robotics.abb.com/t/why-do-new-routines-i-create-always-appear-embedded-in-my-main-procedure/8817
- 用途说明：启动运行、PP to Main（程序指针回 Main）都基于此约定（本项目已实现 PP to Main）。

### 1.5 TRAP ... ENDTRAP（中断例程）
- 中断例程，由外部中断（软/硬信号、定时器）触发，非由调用栈调用。
- 例：
  ```rapid
  VAR intnum iStopSignal;
  PROC main()
    CONNECT iStopSignal WITH TrapStop;
    ISignalDI di_EmergencyInput, 1, iStopSignal;
  ENDPROC
  TRAP TrapStop
    StopMove;
    TPWrite "Emergency stop activated!";
  ENDTRAP
  ```
- 来源：https://www.dynamic-automation.de/en/blog/abb-rapid-programming
- 用途说明：本项目教学层面可列为"未支持但真实程序中存在"的高级要素。

---

## 2. 数据声明与数据类型（Data Declaration & Types）

### 2.1 声明限定词 CONST / VAR / PERS
- **CONST**：常量，编译期固定，不可修改（适合固定参数、固定点位）。
- **VAR**：变量，程序执行期间可改，断电不保留。
- **PERS**：持久变量，断电后保留（适合示教点位、计数、工艺参数）。
- 最佳实践（Best Practices）：示教点位用 `PERS`（FlexPendant 可改）；固定参数用 `CONST`。
- 来源：https://www.dynamic-automation.de/en/blog/abb-rapid-programming （代码示例 `PERS num partCount := 0;`）；https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics
- 用途说明：本项目可据此标注 Program Data 的可变性（predict/constant/persistent）。

### 2.2 核心位置类数据类型
| 数据类型 | 用途说明 | 典型字段/示例 | 来源 |
|---|---|---|---|
| `robtarget` | TCP 目标位姿 + 轴配置 + 外部轴 | `[[x,y,z],[q1,q2,q3,q4],[cf1..cf6],[eax1..eax6]]` 四字段 | https://www.dynamic-automation.de/en/blog/abb-rapid-programming |
| `jointtarget` | 各关节角位置 + 外部轴 | `[[j1..j6],[eax1..eax6]]` | https://www.dynamic-automation.de/en/blog/abb-rapid-programming |
| `speeddata` | 运动速度（TCP mm/s 与转角 %） | `v500`, `v1000` | https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics , (B) |
| `zonedata` | 路点转弯半径/平滑度 | `fine`, `z0..z200`（z50=50mm） | https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics |
| `tooldata` | 工具坐标系（TCP）与质量 | `[robtask, tframe, tload]` | https://www.dynamic-automation.de/en/blog/abb-rapid-programming |
| `wobjdata` | 工件坐标系（用户/工件坐标系） | `[robhold, ufprog, ufmec, uframe, oframe]` | https://www.dynamic-automation.de/en/blog/abb-rapid-programming , ABB 社区 https://tech-community.robotics.abb.com/t/wobj-and-tool-coordinates/5251 |

- `robtarget` 四字段：`[trans(平移), rot(四元数姿态), robconf(轴配置), extax(外部轴)]`；不存在的轴用 `9E9` 表示"未定义"。官方 PCSDK 亦定义 RobTarget 结构：https://developercenter.robotstudio.com/api/pcsdk/api/ABB.Robotics.Controllers.RapidDomain.RobTarget.html
- `tooldata` 示例：`PERS tooldata tGripper := [TRUE,[[0,0,150],[1,0,0,0]],[3,[0,0,75],[1,0,0,0],0,0,0]];`
- `wobjdata` 示例：`PERS wobjdata MyWobj := [FALSE, TRUE, "", [[0,0,0],[1,0,0,0]],[[0,0,0],[1,0,0,0]]];`
- 来源：以上均见 https://www.dynamic-automation.de/en/blog/abb-rapid-programming

### 2.3 基本 / 标量数据类型
| 数据类型 | 用途说明 | 来源 |
|---|---|---|
| `num` | 实数（浮点），最常用数值型 | RAPID Overview – 3HAC050947-001 |
| `int` | 整数 | RAPID Overview |
| `bool` | 布尔（TRUE/FALSE） | RAPID Overview |
| `string` | 字符串 | RAPID Overview |
| `dnum`, `byte`, `word`、`clock`、`errstr` 等 | 官方手册中更多类型（扩展） | RAPID Instructions/Functions/Data Types – 3HAC16581-1 |
| `signalai/di/gi/ao/do/go` | I/O 信号数据（半值类型 semi value，可以参与取值类运算但不可被初始化/赋值） | https://search.abb.com/library/Download.aspx?DocumentID=3HAC065040-001（RAPID Overview 官方摘要：Function (return) data types ...） |

- 官方手册"数据类型"章节：RAPID Reference Manual Part 1（3HAC16581-1 / 3HAC065038-010）。
- 来源汇总：https://library.e.abb.com/public/688894b98123f87bc1257cc50044e809/Technical%20reference%20manual_RAPID_3HAC16581-1_revJ_en.pdf 与 https://search.abb.com/library/Download.aspx?DocumentID=3HAC065040-001

---

## 3. 运动指令（Motion Instructions）

### 3.1 MoveL（线性运动）
- TCP 沿直线移动到目标点，端口到端口直线。用于接近/离开夹具等精密直线运动。
- 语法：`MoveL ToPoint Speed [\V] [\T] Zone [\Z] [\Inpos] Tool [\WObj] ... ;`
  - 例：`MoveL pickPos, v100, fine, gripper;`
- 来源：https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics ；https://min.news/en/news/3f3183aadd772d7c70eff1f736d28f55.html（含 MoveC/MoveL/MoveJ 完整参数语法）

### 3.2 MoveJ（关节插补运动）
- 各轴同时运动并同时到达，最快但路径非线性。用于大范围转位（reposition）。
- 语法：`MoveJ ToPoint Speed Zone Tool [\WObj] ...;`
  - 例：`MoveJ approachPick, v500, z50, gripper;`
- 来源：https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics ；https://www.dynamic-automation.de/en/blog/abb-rapid-programming

### 3.3 MoveC（圆弧运动）
- 通过中间点（via point）做圆弧，三点确定圆弧（起点=当前，via，end）。用于弧焊、涂胶。
- 语法：`MoveC [\Conc] ToPoint [\ID] Speed [\V] [\T] Zone [\Z] [\Inpos] Tool [\WObj] [\TLoad];`
  - 例：`MoveC pVia, pEnd, v300, z5, tGripper;`
- 来源：https://www.dynamic-automation.de/en/blog/abb-rapid-programming ；https://min.news/en/news/3f3183aadd772d7c70eff1f736d28f55.html

### 3.4 MoveAbsJ（绝对关节角运动）
- 移动到指定关节角（jointtarget），与 TCP/工具无关，适合回 HOME 位 / 标定。
- 语法：`MoveAbsJ JointPosition Speed Zone Tool ...;`
  - 例：`MoveAbsJ jHome, v500, fine, tGripper;`
- 来源：https://www.dynamic-automation.de/en/blog/abb-rapid-programming

### 3.5 位置偏移类指令 / 函数
- `Offs(robtarget, x, y, z)`：在 robtarget 基础上沿（当前工作对象）坐标偏移 x/y/z。常与 MoveL/MoveJ 组合：`MoveL Offs(p10, reg1, reg2, reg3), v20, z5, ...`
- `MoveOffs`：个别旧版/辅助指令名（教学中常误用），官方正统写法为 `MoveL Offs(...)` / `MoveJ Offs(...)`。
- `RelTool(pos, dx, dy, dz, ...)`：相对工具坐标系偏移。
- 来源：ABB 社区 https://tech-community.robotics.abb.com/t/wobj-and-tool-coordinates/5251（Offs 用法）；Robot Forum https://www.robot-forum.com/robotforum/thread/23906-applying-the-offs-function-to-several-moves/

> 提示：项目需求提到的 `MoveTo` 并非标准 RAPID 官方指令名；正式 RAPID 使用的是 `MoveAbsJ`（绝对关节）与 `MoveL/MoveJ/MoveC`。在笔记中保留但标注"非官方标准指令"。

---

## 4. 指令参数与绑定参数（Parameters & Optional/Argument Parameters）

RAPID 指令包含**必选参数**、**可选位置参数**与**绑定参数（开关参数，以 `\` 前缀）**。

### 4.1 标准位置参数
- `Speed`：速度，`speeddata` 类型（如 `v500`）。可选绑定义为 `\V`（速度百分比）。
- `Zone`：转弯区，`zonedata` 类型（如 `fine`、`z50`）。可选绑定义 `\Z`（zone 百分比）、`\Inpos`（到达该点判定）。
- `Tool`：工具，`tooldata` 类型（决定 TCP）。
- 来源：https://www.dynamic-automation.de/en/blog/abb-rapid-programming ；https://min.news/en/news/3f3183aadd772d7c70eff1f736d28f55.html

### 4.2 绑定参数（\ 前缀，optional arguments）
| 绑定参数 | 用途说明 | 例 |
|---|---|---|
| `\WObj`（WorkObject） | 指定工件坐标对象 | `MoveL p, v500, fine, tool0 \WObj:=wobj_1;` |
| `\T`（工具/时间） | 在运动中作为目标时间 / 或指定 tooldata 速度目标时间 | 见 MoveC 语法 |
| `\V` | 速度百分比上限 | `MoveL p, v500, \V:=50, ...` |
| `\Z` | 转弯区尺寸 | `... \Z:=20 ...` |
| `\Inpos` | 到达区/到位判定 | `... \Inpos:=stall ...` |
| `\Conc` / `\SyncMoveOn` / `\SyncMoveOff` | 连续运动 / 同步协调运动开关 | `MoveC \Conc ...` |
| `\ID` | 协调运动标识（MultiMove） | `MoveC ... \ID:=10 ...` |
| `\TLoad` | 负载数据 | `... \TLoad:=tload1 ...` |
| `\WObj` 亦可写作 `\Wobj` | 工作对象 | ABB 社区示例 `t_ToolWObj:=wobj_1`（旧语法） |

- 官方 RAPID Overview 指出：指令/函数同时以"简式语法（simplified）"与"正式语法（formal）"描述；用 FlexPendant 编程只需简式语法。来源：https://search.abb.com/library/Download.aspx?DocumentID=3HAC065040-001
- 绑定参数完整列表见 RAPID Instructions, Functions and Data Types（3HAC16581-1）。

---

## 5. 控制流（Control Flow）

| 结构 | 用途说明 | 来源 |
|---|---|---|
| `IF (cond) THEN ... ELSEIF ... ELSE ... ENDIF` | 条件判断；RAPID 用 `ELSEIF`、`ENDIF` | RAPID Overview – 3HAC050947-001 |
| `FOR i := n1 TO n2 DO ... ENDFOR` | 定次数循环（可用 `STEP` 步长） | RAPID Overview |
| `WHILE (cond) DO ... ENDWHILE` | 条件循环 | 例：`WHILE TRUE DO ... ENDWHILE`（xpert 教程） |
| `TEST expr` ... `CASE n:` ... `DEFAULT:` ... `ENDTEST` | 多分支选择 | RAPID Overview |
| `GOTO label` | 无条件跳转（配合 `label:`），工业程序可用但较少 | RAPID Overview |
| `RETURN` | 返回（PROC 提前结束 / FUNC 返回值） | RAPID Overview |
| `RAISE` | 错误处理中向上转发错误 | https://www.dynamic-automation.de/en/blog/abb-rapid-programming |
| `ERROR` 处理器 | 指令级异常处理（`ERROR` 标号后接 `IF ERRNO=...`） | https://www.dynamic-automation.de/en/blog/abb-rapid-programming |

- 示例（xpert 教程主循环）：
  ```rapid
  PROC main()
    MoveAbsJ homePos, v100, fine, tool0;
    WHILE TRUE DO
      PickPart;
      PlacePart;
      partCount := partCount + 1;
    ENDWHILE
  ENDPROC
  ```
  来源：https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics

---

## 6. I/O 与等待指令（I/O & Wait Instructions）

| 指令 | 用途说明 | 来源 |
|---|---|---|
| `SetDO signal, value` | 置位数字输出信号（0/1） | RAPID Instructions – b227fcd.../Rapid_instructions.pdf ; xpert 教程 |
| `WaitDI signal, value` | 等待数字输入达到指定值 | RAPID Instructions |
| `WaitTime t` | 等待固定时间（秒） | xpert 教程：`WaitTime 0.5;` |
| `Set signal`（I/O 高电平，旧式） | 置位数字信号（与 SetDO 相关，早期版本） | RAPID Instructions |
| `Reset signal`（旧式） | 复位数字信号 | RAPID Instructions |
| `PulseDO signal, high_time` | 输出指定时长的高电平脉冲 | RAPID Instructions |
| `TPWrite` / `TPReadNum` 等 | FlexPendant 人机交互（写屏/读数字） | Scribd 摘要（RAPID Instructions, Functions and Data Types）|

- 例（xpert 教程夹爪控制）：
  ```rapid
  SetDO DO_GripperClose, 1;  ! 夹住
  WaitTime 0.5;
  SetDO DO_GripperClose, 0;  ! 松开
  ```
  来源：https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics
- 官方指令手册文件：https://library.e.abb.com/public/b227fcd260204c4dbeb8a58f8002fe64/Rapid_instructions.pdf （内含 AccSet、SetDO 等全部指令，且说明 AccSet 仅用于主任务 T_ROB1 或 MultiMove 的 Motion 任务）

---

## 7. 注释语法与代码结构约定

### 7.1 注释
- **行注释**：以 `!` 开头直到行尾（RAPID 最常用注释）。
  ```rapid
  ! Persistent variable — survives power cycle
  PERS num partCount := 0;
  ```
- **多行/块注释**：`(* ... *)`（官方也支持）。
- 来源：https://www.xpert-robotics.com/en/blog/abb-rapid-programming-basics （! 注释示例）；官方代码示例 https://www.dynamic-automation.de/en/blog/abb-rapid-programming （ERROR 处理器内 `! Motion was interrupted`）

### 7.2 基本字符集与命名约定
- RAPID 标识符（变量名、指令名）规则：不以数字开头；区分保留字。官方明确"已预定义的数据类型名、系统数据、指令与函数名不得作为标识符"。来源：https://search.abb.com/library/Download.aspx?DocumentID=3HAC050947-004（RAPID Overview：保留字说明，法文/多语言版）
- 语句以分号 `;` 结束；结构块以 `ENDxxx` 结束（ENDMODULE / ENDPROC / ENDIF / ENDFOR / ENDWHILE / ENDTEST / ENDTRAP）。
- 大小写不敏感但约定俗成用 PascalCase 命名类型/对象，小写/首字母小写命名对象实例（如 `tool0`、`v100`）。
- 来源：RAPID Overview – 3HAC050947-001；xpert / dynamic-automation 代码风格示例。

### 7.3 常见约定（Best Practices）
- 每个模块负责一个功能域（夹爪 / 相机 / 输送带等单模块单职责）。来源：https://www.dynamic-automation.de/en/blog/abb-rapid-programming
- 示教点位用 `PERS`，固定参数用 `CONST`。
- `AccSet` / `VelSet` 在程序开头定义，勿放在循环内。
- `fine` 仅在真正需要时使用（会完全停止、耗时）；中间路点用 `z50` 或更大区值。
- 用 FlexPendant 示教点位，用 RobotStudio 编写并校验逻辑。来源：https://www.dynamic-automation.de/en/blog/abb-rapid-programming

---

## 8. 一个典型工业 RAPID 程序的完整要素（标准全集）

> 下面列出真实工业 RAPID 模块应有的全部要素。本项目教学平台**可能暂不支持**其中部分高级项，故在此单独列出作为"标准参考基准"。

```rapid
MODULE MainModule
  ! --- 1) 常量 (CONST) ---
  CONST num PICK_SPEED := 500;

  ! --- 2) 示教点位 (PERS robtarget) ---
  PERS robtarget pHome := [[500,0,600],[0.707,0,0.707,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];

  ! --- 3) 工具 / 工件 (tooldata, wobjdata) ---
  PERS tooldata tGripper := [TRUE,[[0,0,150],[1,0,0,0]],[3,[0,0,75],[1,0,0,0],0,0,0]];
  PERS wobjdata wBase := [FALSE, TRUE, "", [[0,0,0],[1,0,0,0]],[[0,0,0],[1,0,0,0]]];

  ! --- 4) 全局任务变量 (VAR num / bool / string) ---
  VAR num partCount := 0;
  VAR bool bBusy := FALSE;

  ! --- 5) 主入口：PROC main (程序指针 PP 在此) ---
  PROC main()
    ! 初始化运动参数
    AccSet 80, 80;
    VelSet 80, 1000;
    ! 返回 HOME
    MoveAbsJ jHome, v500, fine, tGripper \WObj:=wBase;
    ! 主循环
    WHILE TRUE DO
      IF di_Start = 1 THEN
        PickPart;
        PlacePart;
      ENDIF
      WaitTime 0.1;
    ENDWHILE
  ENDPROC

  ! --- 6) 子例程 PROC (含 I/O + 位置偏移 + 错误处理) ---
  PROC PickPart()
    MoveJ Offs(pApproach, 0,0,50), v500, z50, tGripper \WObj:=wBase;
    MoveL pPick, v100, fine, tGripper \WObj:=wBase;
    SetDO DO_GripperClose, 1;    ! 夹紧
    WaitTime 0.3;
    MoveL pApproach, v200, z50, tGripper \WObj:=wBase;
    ERROR
      IF ERRNO = ERR_PATH_STOP THEN
        MoveAbsJ jHome, v200, fine, tGripper;
        TPWrite "Path stopped, back home";
        RAISE;
      ENDIF
  ENDPROC

  ! --- 7) 中断处理 TRAP (外部信号) ---
  VAR intnum iStopSignal;
  PROC ConnectInterrupt()
    CONNECT iStopSignal WITH TrapStop;
    ISignalDI di_Stop, 1, iStopSignal;
  ENDPROC
  TRAP TrapStop
    StopMove;
    TPWrite "Stop signal received";
  ENDTRAP
ENDMODULE
```

**工业 RAPID 模块完整要素清单：**

1. **模块声明** `MODULE` / `ENDMODULE`
2. **数据声明区**：`CONST` / `VAR` / `PERS`，覆盖全部数据类型（num、int、bool、string、robtarget、jointtarget、speeddata、zonedata、tooldata、wobjdata、loaddata、struct 结构体、array 数组、record）
3. **主入口** `PROC main()`
4. **子例程** `PROC ... ENDPROC`
5. **函数** `FUNC ... ENDFUNC`（含返回值、入参、局部变量）
6. **中断机制**：`CONNECT` + `ISignalDI/ISignalDO/ITimer` + `TRAP ... ENDTRAP`
7. **错误处理**：`ERROR` 处理器 + `ERRNO` + `RAISE` + `ERR_PATH_STOP` 等错误常量
8. **运动指令**：`MoveJ / MoveL / MoveC / MoveAbsJ`，配合 `\WObj`、`\T`、`\TLoad`、`\ID` 等绑定参数，以及 `speeddata`、`zonedata`
9. **位置计算**：内置函数 `Offs()`、`RelTool()`、`PoseMult()`、及 FOR/WHILE 组合批量生成点位
10. **I/O 与等待**：`SetDO / SetAO / SetGO / WaitDI / WaitDO / WaitAI / WaitTime / PulseDO / Set / Reset`
11. **人机交互**：`TPWrite / TPReadNum / TPReadFK / UIMessageBox`
12. **运动控制**：`StopMove / StartMove / StorePath / RestoPath / AccSet / VelSet / SpeedRefresh / SoftServo`
13. **通讯**：`SocketCreate / SocketConnect / SocketSend / SocketReceive`（TCP/IP），`Open / Write / Read`（文件）
14. **时间 / 时钟**：`ClkStart / ClkStop / ClkRead / CTimeGet`、`WAIT` 相关
15. **多任务协调**：`\SyncMoveOn / \SyncMoveOff`、`ID` 同步、`WaitSyncTask`
16. **程序 / 返回值管理**：`RETURN`、`CallByVar`、`EXIT`

> 该清单对应的完整语法定义见官方 **RAPID Reference Manual Part 1（Instructions, Functions and Data types）**：https://library.abb.com/d/3HAC065038-010 ；以及 **RAPID Overview**：https://search.abb.com/library/Download.aspx?DocumentID=3HAC050947-001

---

## 9. 关键术语速览（中文对照）

| RAPID 术语 | 中文 | 说明 |
|---|---|---|
| robtarget | 机器人目标位姿 | TCP 点位 + 姿态 + 轴配置 + 外部轴 |
| TCP | 工具中心点 | 工具坐标系原点 |
| jointtarget | 关节角目标 | 六个关节角 + 外部轴 |
| speeddata | 速度数据 | v 前缀，如 v100 / v500 |
| zonedata | 转弯区数据 | fine / z0-z200 |
| tooldata | 工具数据 | 含 TCP 与惯性/质量 |
| wobjdata | 工件数据 | 工件坐标系（工作对象） |
| PERS | 持久数据 | 断电保留 |
| Program Pointer (PP) | 程序指针 | 程序执行位置，PP to Main 即回到 main 起点 |
| Task (T_ROB1) | 任务 | 机器人执行单元 |

---

## 10. 调研结论 / 参考要点

- **已定位的官方来源**：ABB 官方 RAPID 参考手册完整文档链（RW7 / RW6 / 旧版 Part1 3HAC16581-1、RAPID Overview 3HAC050947/3HAC065040、Rapid_instructions.pdf）、ABB 官方机器人技术社区（tech-community.robotics.abb.com）、RobotStudio 官方开发中心（developercenter.robotstudio.com PCSDK）。可作本项目 RAPID 解析器与数据模型的权威依据。
- **本项目平台当前实际已具备（可执行/解析）**：`MODULE ... ENDMODULE`、无参数 `PROC main() ... ENDPROC`、模块级 `CONST/PERS/TASK PERS robtarget` 声明、`MoveJ` / `MoveL`（target,speed,zone,tool，可选 `\WObj:=wobj0`）、`!` 单行注释、运行/单步/停止/PP to Main 执行链与 Program Data 派生示教。当支持范围随里程碑扩展时，以 `docs/platform-current-rapid-capabilities.md` 为准。
- **真实 RAPID 但当前明确未实现（识别并报 unsupported，不执行）**：`VAR` 声明与赋值、`MoveC` / `MoveAbsJ`、`Offs` / `RelTool` 函数、`speeddata/zonedata/tooldata/wobjdata` 等非 robtarget 类型、`IF/FOR/WHILE/TEST` 控制流、`SetDO/WaitDI/WaitTime` 等 I/O、多 `PROC` 与非 main 过程、GOTO/LABEL。这些均为真实 RAPID 能力，Parser 需给出 `unsupported-syntax` / `unsupported-option` / `undefined-symbol` 等诊断而非静默忽略。
- **本项目暂未支持的高阶要素（标准参考）**：TRAP 中断、ERROR 异常处理、多任务同步（\SyncMove、ID）、TCP/IP Socket 通讯、文件读写、时钟、SoftServo 等——这些是"典型工业程序应有而教学平台可暂不实现"的部分。

---

*笔记文件路径：`E:/项目demo/ABB-Robot-Programming-Lab/docs/rapid-official-reference-notes.md`*
