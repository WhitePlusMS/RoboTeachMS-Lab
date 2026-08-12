# 平台当前支持的 RAPID 语法与功能清单

> 调研性质：本文件仅作只读现状梳理，供后续与 ABB 官方 RAPID 能力对比。所有"支持 / 部分支持 / 不支持"结论均尽量标注 `src/rapid/rapid-parser.ts` 等源码的 file:line 依据；其中"规划/交接文档提到但未实现"的事项单独列出并标注来源，避免与已实现能力混淆。
>
> 单一事实源结论：RAPID 源程序是点位与程序的唯一事实源；Program Data 视图由 `parseRapidProgram` 同一次解析派生，无第二份点位存储或平行 parser（见 `rapid-parser.ts:72-99` 的 `RapidParseResult.data`、`program-control.ts:117-118` 的注释）。

---

## 1. 总览表

| 能力 | 状态 | 关键依据 |
| --- | --- | --- |
| 运动指令 MoveJ / MoveL | **支持** | parser `parseMainBody`/`parseMotion`；`rapid-parser.ts:503-504,442-488` |
| 数据声明 CONST / PERS robtarget | **支持**（详见 §3） | `rapid-parser.ts:393-440` |
| 可选参数 `\\WObj:=wobj0` | **部分支持**（仅 `wobj` 且值仅 `wobj0`） | `rapid-parser.ts:456-468,637-644` |
| 注释 `! ...` | **支持**（单行注释，词法层跳过） | `rapid-parser.ts:207-210` |
| 模块 / 单一过程结构 `MODULE ... PROC main() ... ENDMODULE` | **部分支持**（仅单个 `main`，见 §3） | `rapid-parser.ts:566-598,535-564` |
| 诊断 | **支持**（9 种代码，见 §4） | `rapid-parser.ts:25-41` |
| 源码定位粒度 | **支持**（sourceRange + 各 operands 的 operandRanges） | `rapid-parser.ts:44-63` |
| 程序执行链 | **支持**（运行/单步/停止/PP to Main） | `program-executor.ts` |
| 运动规划链 | **支持**（MoveJ 关节 / MoveL 笛卡尔） | `movej-planner.ts`、`movel-planner.ts`、`plan-shared.ts` |
| Program Data 派生与示教 | **支持**（读取/新建/改名/删除/Modify Position/插入运动） | `controlled-rapid-edit.ts`、`ProgramDataPanel.vue` |
| 运行时教学观察 | **支持**（PP/MP 行、结构化指令、TCP 轨迹） | `ProgramControlPanel.vue`、`RapidSourceEditor.vue`、`SceneViewport.vue` |
| MoveC / MoveAbsJ | **不支持**（触发 unsupported-syntax，不解析） | `rapid-parser.ts:509-512` |
| 控制流 IF / WHILE / FOR | **不支持**（执行层不解释） | `rapid-parser.ts:493,506-507,513-515`；`map.md` |
| 非 main 过程 / 多过程 / 参数 | **不支持** | `rapid-parser.ts:548-557` |
| WaitTime / I/O / 通信 | **不支持** | 全仓库无实现（见 §5，grep 无命中） |
| Zone 过渡（非 fine） | **不支持**（仅 `fine`） | `rapid-parser.ts:621-628` |
| 自定义 tool / wobj / speeddata | **不支持**（仅 `tool0`/`wobj0`/`v50/v100/v200`） | `rapid-parser.ts:612-644`、`142-146` |
| robconf 非零构型 / 外部轴 | **不支持**（仅 `[0,0,0,0]` 与 9E9 未使用轴） | `plan-shared.ts:157-180` |

---

## 2. RAPID 源码层（解析）支持范围

### 2.1 词法/注释/模块结构

- 词法 Token 仅四类：`identifier`、`number`、`symbol`、`eof`；符号仅 `[](),;\\` 与 `:=`（`rapid-parser.ts:101,227-237`）。
- 注释：单行 `! ...（到行尾）`，在词法层直接跳过（`rapid-parser.ts:207-210`）。**不支持块注释 / `(*(*)`**。
- 关键字与标识符均**大小写不敏感**匹配（`normalizeName`，`rapid-parser.ts:148-150`），但保留源码原始拼写（`rapid-parser.ts:88`）。
- 模块结构：必须 `MODULE <name>` 开头、单个 `ENDMODULE` 结尾（`rapid-parser.ts:566-598`）。**一个源程序只允许一个 MODULE**（`rapid-parser.ts:578-581`）。`ENDMODULE` 后不允许任何尾随内容（`rapid-parser.ts:594-597`）。

### 2.2 运动指令（核心）

- **MoveJ 与 MoveL**：仅这两种运动指令被识别为可执行（`rapid-parser.ts:503-504`）。
- 指令形式固定为：`<MoveJ|MoveL> <targetName>,<speedName>,<zoneName>,<toolName>[\\WObj:=<wobjName>];`（`parseMotion`，`rapid-parser.ts:442-488`）。
- 每个操作数在结构上只接受**标识符引用**（名称），不直接接受内联字面量表达式（`rapid-parser.ts:446-453`）。
- 速度名称：只接受内置 `v50` / `v100` / `v200`（`rapid-parser.ts:142-146,612`），其余报 `undefined-symbol`。
- zone 名称：只接受 `fine`（`rapid-parser.ts:621-628`）。
- tool 名称：只接受 `tool0`（`rapid-parser.ts:629-636`）。
- 可选参数：只接受 `\\WObj:=wobj0`（`rapid-parser.ts:456-468,637-644`）；其它可选参数报 `unsupported-option`。注意 `wobj0` 是语法层面唯一接受的名字，`tool0`/`wobj0`/`zone` 也只接受默认值。
- 位置参数是通过名称解析到**模块级 robtarget 符号表**（`rapid-parser.ts:277,601-610`）。

### 2.3 数据声明（Program Data）

- 存储关键字：`CONST`、`PERS`、以及 `TASK PERS`（`rapid-parser.ts:393-405`）。**`VAR` 不支持**（报 unsupported-syntax，`rapid-parser.ts:583`）。
- 类型：只支持 `robtarget`；其它类型报 `unsupported-option`（`rapid-parser.ts:412-416`）。
- robtarget 字面量形状固定为 `[[trans3],[rot4],[robconf4],[extax6]]`，全部为数字；拒绝尾逗号、长度不符、非有限数（`parseRobTarget`/`parseTuple`，`rapid-parser.ts:330-391`）。
  - `trans`：3 项，毫米。
  - `rot`：4 项，ABB 顺序四元数 `[q1..q4]`（q1=w）（`rapid-types.ts:9-17`）。
  - `robconf`：4 项，`[cf1,cf4,cf6,cfx]`；规划层只接受 `[0,0,0,0]`（`rapid-types.ts:20`、`plan-shared.ts:172-174`）。
  - `extax`：6 项，只接受全部为 `9E9`（未使用外部轴），见 `rapid-types.ts:21-28` 与 `plan-shared.ts:175-179`。
- 名称大小写不敏感但保留原始拼写；重复定义（大小写不敏感）报 `duplicate-symbol`（`rapid-parser.ts:428-431`）。
- 每个声明的源码范围、名称范围、值字面量范围、以及每条引用范围都会被精确记录（`rapid-parser.ts:432-439`、`RapidProgramDataTarget` 86-99 行、`SymbolEntry.references` 601-610 行）。

### 2.4 过程/程序结构

- 只接受**一个无参数 `PROC main()`**（`rapid-parser.ts:548-564`）。其他过程名、带参数 main、多 main 均报错（`unsupported-syntax`/`unsupported-option`/`duplicate-symbol`）。
- 非 main 过程的函数体被跳过（`skipProcedureBody`，`rapid-parser.ts:530-533`），因此过程中的 MoveJ/MoveL 不会被解析成可执行指令。
- 无 `main` 报 `missing-entrypoint`（`rapid-parser.ts:673-675`）。

---

## 3. 明确"部分支持"的边界细节

| 项 | 允许值 | 拒绝示例（源码依据） |
| --- | --- | --- |
| 运动指令 | `MoveJ`、`MoveL` | `MoveC`、`MoveAbsJ` → `unsupported-syntax`（`rapid-parser.ts:509-512`） |
| 速度 | `v50`、`v100`、`v200` | `v999` → `undefined-symbol`（`rapid-parser.ts:612`；测试 `rapid-parser.test.ts:111`） |
| zone | `fine` | `z20` → `unsupported-option`（`rapid-parser.ts:621`） |
| tool | `tool0` | `tool1` → `unsupported-option`（`rapid-parser.ts:629`） |
| wobj 可选参数 | `\\WObj:=wobj0` | `\\WObj:=wobj1`、`\\speed:=...` → `unsupported-option`（`rapid-parser.ts:637,461-463`） |
| robtarget 构型 | `robconf=[0,0,0,0]` | 非零 → `unsupported-option`（`plan-shared.ts:172-174`） |
| 外部轴 | `extax=9E9*6` | 其它 → `unsupported-option`（`plan-shared.ts:175-179`） |
| 数据存储 | `CONST`、`PERS`、`TASK PERS` | `VAR` → unsupported（`rapid-parser.ts:583`） |
| 数据类型 | `robtarget` | 其它类型 → `unsupported-option`（`rapid-parser.ts:412-416`） |

---

## 4. 诊断能力

### 4.1 诊断代码（`RapidDiagnosticCode`，`rapid-parser.ts:25-35`）

| 代码 | 触发场景示例（file:line） |
| --- | --- |
| `lexical-error` | 无法识别的字符（`rapid-parser.ts:239`） |
| `syntax-error` | 缺关键字/符号/ENDMODULE 等（`rapid-parser.ts:307,319,592`） |
| `unsupported-syntax` | 不支持的控制流/其它过程/MoveAbsJ/MoveC/多余 MODULE/未知语句（`rapid-parser.ts:492,509-518,550,580,583,594`） |
| `unsupported-option` | 非默认 zone/tool/wobj/可选参数/非 robtarget 类型（`rapid-parser.ts:413,462,622,624,630,632,638,640`） |
| `duplicate-symbol` | 重复 robtarget / 多个 main（`rapid-parser.ts:429,559`） |
| `undefined-symbol` | 未定义 robtarget / 不支持的速度（`rapid-parser.ts:608,614`） |
| `invalid-data` | tuple 长度/尾逗号/非有限数（`rapid-parser.ts:338,344,353,357,367`） |
| `missing-module` | 无 MODULE / 无需结束的 MODULE（`rapid-parser.ts:567,598`） |
| `missing-entrypoint` | 无无参 main（`rapid-parser.ts:674`） |

**注意**：全部诊断 `severity` 恒为 `'error'`（无 warning 级别，`rapid-parser.ts:38`；测试 `rapid-parser.test.ts:89`）。存在任一 error 时 `canExecute=false` 且 `program=[]`（即使部分指令语义正确也不执行，`rapid-parser.ts:691-699`；测试 `rapid-parser.test.ts:82-86`）。

### 4.2 定位粒度

- 每个诊断携带一个 `range: RapidSourceRange`（`rapid-parser.ts:36-41`），最小粒度到**行/列**（1-based，`RapidSourcePosition`，`rapid-parser.ts:12-17`）。
- 每条可执行指令除 `sourceRange` 外，还有每个运动操作数的精确范围 `operandRanges.{target,speed,zone,tool,wobj}`（`rapid-parser.ts:44-63`），供编辑器标记与教学回溯。测试验证速度诊断定位到速度 token（`rapid-parser.test.ts:56-68`）。
- 编辑器 gutter 按行高亮诊断行、PP 行（蓝）、MP 行（橙）、运行时错误行（`ProgramControlPanel.vue:63-73,125-134`）。

### 4.3 稳定诊断契约（parser 加固）

- **排序与去重**：解析结束后诊断按 `range.start.offset`、`range.end.offset`、生成次序升序排列；相同 `code` + 相同起止 offset 的重复条目只保留一条。同一源码重复解析得到顺序完全一致、无重复的诊断列表（`rapid-parser.ts` 末尾，测试 `rapid-parser-diagnostics.test.ts`）。
- **缺失 token 使用零长度范围**：`expectKeyword`/`expectSymbol`/`expectIdentifier` 对缺失 token 发出指向插入位置的零长度诊断（`addMissingDiagnostic`）；已有错误内容只覆盖最小错误 token（非零范围）。
- **有限恢复边界**：声明恢复到分号或下一个明确的模块级结构；运动指令恢复到分号、下一条已知运动或 `ENDPROC`/`ENDMODULE`；模块结构不得越过 `ENDMODULE`。一处根因不再派生"后续所有操作数均缺失"的连锁错误（`parseMotion` 的 `expectOperandSlot`/`recoverMotionTail`）。
- **损坏声明不生成半合法 Program Data**：缺少 `:=`/名称的损坏声明不会进入 `data`；无歧义正确的 robtarget 在错误源码中仍只读展示。
- **LF/CRLF 平价**：同一程序以 LF 或 CRLF 换行解析，得到相同的逻辑行、列与源码片段（列按 `\n` 行首计，`\r` 不改变列）。

---

## 5. 执行层支持范围

### 5.1 ProgramExecutor（`src/rapid/program-executor.ts`）

- 串行按序执行结构化 MoveJ/MoveL 列表，语义对齐 ABB：**运行（run）/ 单步（step）/ 停止（stop）/ PP to Main（ppToMain）**（`program-executor.ts:45-61`）。
- 状态机：`idle | running | stopped | completed | error`（`program-executor.ts:8`），**无程序级暂停/继续状态**（注释 `program-executor.ts:6-7`、`program-control.ts:31`）。
- 指针语义：PP（下一条）+ MP（当前活动指令）；仅当当前运动返回 `completed` 才推进 PP，`stopped` 不推进（`program-executor.ts:108-120`）。规划错误进入 `error` 并保存指令索引（`program-executor.ts:101`）。
- off-path / needsPP-to-Main：源码变化后停止态 PP 无法唯一映射则要求 PP to Main（`program-control.ts:300-346`）。手动 Jog 抢占后标记 off-path，按 ABB **Clear 语义**从当前位置规划到下一目标（`program-control.ts:196-221,233-248`）。

### 5.2 运动规划链

- **MoveJ**：`executeMoveJ` → `planMoveJ`：校验输入 → `robTargetToPose` → `solveIK`（主初值 + 有限备用初值，选离当前关节最近的解）→ `simulateDurationMs`（TCP 距离 / v_tcp 近似）→ `runEased`（关节缓动）。见 `movej-planner.ts:191-199,110-144`；备用初值 `buildAlternateIKSeeds` `movej-planner.ts:39-80`。
- **MoveL**：`executeMoveL` → `planMoveL`：`planCartesianPath` 生成笛卡尔 waypoint（线性插补 + 四元数 slerp + 逐段 IK，`cartesian-path-planner.ts:49-108`）→ `simulateDurationMs` → `startCartesianTrajectory`（`movel-planner.ts:81-89`；`motion-runner.ts` 轨迹播放）。
- 规划错误集（`MotionPlanErrorKind`，`plan-shared.ts:41-46`）：`invalid-data` / `unsupported-option` / `unreachable` / `joint-limit`。
- 时长是**仿真近似**（距离/速度换算毫秒），明确"不是对 ABB 控制器真实关节速度规划的复现"（`movej-planner.ts:107-109`）。

### 5.3 数据与配置校验（运行时第二道防线）

除 parser 层面的名称约束外，规划层 `validateMotionInput`（`plan-shared.ts:187-201`）会再次校验并拒绝：
- tuple 长度错误（`plan-shared.ts:63-83`）；
- 非有限数值（`86-125`）；
- 零长度四元数（`128-143`）；
- 非正速度（`146-151`）；
- **非默认** tool0/wobj0/非 fine/非零 robconf/带外部轴的目标（`157-180`）。

---

## 6. Program Data 与教学（示教）能力

- **派生**：`RapidParseResult.data`（`rapid-parser.ts:78,677-689`）在**每次解析**时由同一份符号表派生：名称、存储（const/pers）、目标值、声明/名称/值范围、每条引用范围。存在 error 时仍暴露已识别数据供只读浏览（`rapid-parser.ts:677`、测试 `rapid-parser.test.ts:223-239`）。
- **受控编辑**（`src/rapid/controlled-rapid-edit.ts`）：唯一结构化编辑入口，命令有 `create-target` / `modify-position` / `rename-target` / `delete-target` / `insert-motion`（`controlled-rapid-edit.ts:13-18`）。错误源码禁止编辑（`guardExecutable` `92-97`）；只做符号级最小文本替换，未涉及内容逐字保留（`103-120`）。删除被引用目标、重复名、非法名等结构化拒绝（`errorCode` 20-27 行）。
- **示教 UI**（`src/components/ProgramDataPanel.vue`）：从当前 tool0 TCP（ABB 基座坐标，由 FK 派生，`App.vue:93`）新建点位、Modify Position、重命名、删除、插入 MoveJ/MoveL（`ProgramDataPanel.vue:136-188`）；对"从上位 TCP 新建点位"使用零 robconf（`makeEmptyTaughtTarget`，`controlled-rapid-edit.ts:250-255`）；查看引用定位到源码（`view-reference` 事件 → `RapidSourceEditor.vue:43-56` 聚焦选中）。
- **运行时教学观察**：PP/MP 源码行、当前结构化指令摘要（操作数名称、不二次解析 RAPID 字符串，`RapidSourceEditor.vue:58-61,99-127`）、TCP 轨迹显示与清空（`SceneViewport.vue:87-118`）。**不建设完整调试器**（`abb-teach-target-and-observe/map.md` 决策 04）。

---

## 7. 平台当前明确不支持（代码/文档依据）

| 能力 | 状态 | 依据 |
| --- | --- | --- |
| MoveC | 不支持 | parser 识别为 `unsupported-syntax` 后跳过（`rapid-parser.ts:509-512,490-499`） |
| MoveAbsJ | 不支持 | 同上（`rapid-parser.ts:509-512`） |
| 控制流 IF/WHILE/FOR | 不支持 | 首期仅报 unsupported，执行层不解释（`rapid-parser.ts:493,506-507,513-515`；`map.md` "Out of scope"） |
| 非 main 过程 / 函数 | 不支持 | `rapid-parser.ts:548-553` |
| 变量 `VAR` | 不支持 | `rapid-parser.ts:574-584`（非 CONST/PERS/TASK） |
| 非 robtarget 类型 | 不支持 | `rapid-parser.ts:412-416` |
| Zone 过渡（zone 非 fine） | 不支持 | `rapid-parser.ts:621-628`、`plan-shared.ts:169-171` |
| 用户 tool / wobj | 不支持 | `plan-shared.ts:163-168` |
| 外部轴目标 | 不支持 | `plan-shared.ts:175-179` |
| 非零 robconf 构型控制 | 不支持 | `plan-shared.ts:172-174`；`map.md`：MVP 明确标注未模拟构型控制 |
| 速度插补 / ABB 转向速度协调 | 不支持 | 时长为距离/速度近似，非真实控制器速度规划（`movej-planner.ts:107-109`、`movel-planner.ts:35`） |
| WaitTime / I/O（SetDO/PulseDO/AO）/ 通信 | 不支持 | 全仓库 grep 无实现；parser 未知语句一律 `unsupported-syntax`（`rapid-parser.ts:516-518`） |
| 程序级暂停/继续 | 不支持（无此状态） | `program-executor.ts:8`；`program-control.ts:31` |
| 块注释 / 多行注释 | 不支持 | 词法只处理单行 `!`（`rapid-parser.ts:207-210`） |
| 导入/导出/本地磁盘保存 | 不支持 | `abb-teaching-simulation/map.md` 决策 04 |
| 完整 RAPID 编译器 / 控制器通信 | 不支持 | `map.md` "Out of scope" |
| 多品牌机器人运行时 / C# 迁移 | 不支持（KUKA 仅保留） | CLAUDE.md、各 map.md |

---

## 8. 数据 / 假设边界（确定性 vs 规划文档）

### 8.1 确定性（有源码/测试依据，可直接信任）

- parser 对各名称/类型/zone/tool/wobj 的接受与拒绝，均有 `rapid-parser.ts` 对应行与 `rapid-parser.test.ts` 测试断言。
- 诊断代码全集 = `rapid-parser.ts:25-35` 的 9 种，severity 恒 error。
- ProgramExecutor 状态机、指针推进、运行/单步/停止/PP to Main 语义有 `program-executor.test.ts` 覆盖。
- 规划错误与数据校验类型见 `plan-shared.ts:41-203`。

### 8.2 仅出现在交接文档 / README / map，未完全落实或属规划

> 以下均为**规划/文档级**来源（`.scratch/**/map.md`、issue 票据），不是已实现能力，涉及外部能力时尤其不能当作实证。

- "尽量接近真实 RAPID …… 不擅自简化成教学专用指令"是**目的愿景**（`abb-teaching-simulation/map.md` Destination），目前实现仍是受限子集（仅 MoveJ/MoveL）。
- 参考项目（`RAPID-Scripts-and-Demos` 真实模块裁剪验收语料、`rapid-for-vim` / `vscode-abb-rapid` 词法线索、Posecode parser→IR/diagnostics 分层）属于后续裁剪/借鉴来源（`abb-teaching-simulation/map.md` Notes），尚未在仓库实现为完整文法。
- MoveC / MoveAbsJ / 控制流 / 完整编辑器 / 工具-工件坐标系 / 多机器人 profile 等的毕业条件在 `map.md` "Not yet specified" 中列出，属**待定**而非已实现。
- TypeScript→C# 迁移只出现在 map Destination 注释（`abb-teaching-simulation/map.md:8`），仓库仍为纯 TypeScript。

---

## 附：调研涉及的关键文件

- `src/rapid/rapid-parser.ts` — 核心解析器 + 诊断 + Program Data 派生
- `src/rapid/rapid-types.ts` — 结构化数据类型（robtarget/speed/zone/tool/wobj）
- `src/rapid/program-executor.ts` — 程序状态机/运行/单步/停止/PP to Main
- `src/rapid/movej-planner.ts`、`movel-planner.ts`、`plan-shared.ts` — 运动规划链与校验
- `src/rapid/controlled-rapid-edit.ts` — 受控源码编辑
- `src/application/program-control.ts`、`motion-control.ts` — 页面控制器 / MotionRunner 接入
- `src/robotics/motion-runner.ts`、`cartesian-path-planner.ts`、`ik-solver.ts` — 底层运动
- `src/components/`（RapidSourceEditor/ProgramControlPanel/ProgramDataPanel/ProgramWorkspace/SceneViewport）— 编辑器/diagnostics/教学观察 UI
- `.scratch/abb-teaching-simulation/map.md`、`.scratch/abb-teach-target-and-observe/map.md`、`.scratch/abb-teaching-simulation/issues/10-*.md` — 已确认的边界与规划
- `src/application/builtin-program.ts` — 内置示例 RAPID 源（唯一事实源）
- `UPDATE_LOG.md` — 历史变更记录（本调研不据此推断未实现功能）
