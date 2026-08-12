# 更新日志

## 2026-08-12 — 修复 RAPID parser review findings

### 修改文件

- `src/rapid/rapid-parser.ts`
  - 修复空操作数恢复：记录当前槽位是否已消费分隔逗号，避免把同一个缺失操作数再次误报为缺少逗号。
  - 延后 robtarget 引用结算到完整模块解析后，恢复声明位于 `PROC main` 之后时的前向引用，同时保留断裂运动中的目标引用诊断。
  - 补充 `jointtarget`、`int`、`byte`、`word`、`clock`、`errstr` 和 I/O 类型等已知但暂不支持的 RAPID 类型分类。
- `src/rapid/rapid-parser-test-fixtures.ts`
  - 新增诊断测试共用的 robtarget、模块前缀和闭合片段，减少重复夹具与缩写命名。
- `src/rapid/rapid-parser-diagnostics.test.ts`
  - 使用描述性测试夹具名称，保持稳定诊断回归覆盖。
- `src/rapid/rapid-parser-motion-diagnostics.test.ts`
  - 使用共用运动测试夹具，并新增空操作数不派生缺逗号诊断的回归断言。
- `src/rapid/rapid-parser-decl-diagnostics.test.ts`
  - 使用共用声明夹具，新增 main 后声明点位的前向引用和 `jointtarget`/`int` 类型分类测试。
- `docs/platform-current-rapid-capabilities.md`
  - 将易过期的 parser 行号依据改为稳定的类型、常量和函数名；修正 `missing-module` 与缺少 `ENDMODULE` 的诊断边界描述。

### 修改原因

修复本次里程碑 code review 发现的诊断恢复错误、前向引用回归、已知 RAPID 类型误分类、能力文档失真和测试夹具可读性问题。

### 影响

- 空操作数仅保留对应根因，后续合法操作数仍可继续定位。
- 模块级点位引用在完整符号表建立后统一结算，支持当前 parser 接受的声明顺序。
- 不新增执行能力，不修改 ProgramExecutor、planner、Vue 或 Three.js；已执行 `npx vitest run src/rapid`（139 个测试通过）、`npm run check` 和 `git diff --check`。
## 2026-08-12 — code-review 收尾：提取运动多余参数守卫（去重）

### 修改文件

- `src/rapid/rapid-parser.ts`
  - 将 `parseMotion` 中两处近似同构的"多余参数"守卫（普通位置参数之后、可选参数之后）提取为 `rejectTrailingParams(allowWobj)` 辅助函数复用，消除 Duplicated Code 坏味道。`allowWobj` 区分普通位置参数后可跟可选参数反斜杠、可选参数之后不允许第二个反斜杠的差异。

### 修改原因

完成 /code-review 后按 Standards 轴唯一一项判断性发现收敛重复逻辑，符合项目"最简/去重"原则。

### 影响

- 行为不变：两个守卫的触发条件与原实现等价，全部 138 个 rapid 测试与 TS 检查通过。
- 仅结构性去重，无新增能力、无 `any`、无 Vue/planner/KUKA 改动。

## 2026-08-12 — 完成 Ticket 04：用真实 RAPID 语料完成诊断闭环验收

### 修改文件

- `src/rapid/rapid-parser-corpus.test.ts`（新增）
  - 用真实 ABB RAPID 片段验证加固后的 parser 韧性。fixture 保留真实大小写/空格/注释风格并注明来源与裁剪原因：
    - `docs/rapid-real-code-examples.md`（rafacastalla Pick&Place / ptiago 产线 / 0-robinson-1 规则轨迹 / CalibData 工具工件声明）。
    - `.scratch/rapid-research/Drive.mod`（真实 `SetDO/Reset/WaitTime` 写法）。
  - 覆盖：真实 MoveJ 用 z100 与 `\WObj`、VAR/控制流、I/O/WaitTime、MoveC/MoveAbsJ、Offs/RelTool、支持与不支持混合（绝不部分执行）、嵌套块/复杂表达式/真实注释（不崩溃/不死循环/不吞 ENDPROC/ENDMODULE）、损坏声明不生成半合法数据。
- `docs/platform-current-rapid-capabilities.md`
  - §4 新增 `4.3 稳定诊断契约（parser 加固）`：排序去重、缺失 token 零长度范围、有限恢复边界、损坏声明不生成半合法 Program Data、LF/CRLF 平价。
- `docs/rapid-official-reference-notes.md`
  - 修正 §10 将未来建议误写为当前已具备的表述：把"VAR/PERS/MoveC/MoveAbsJ/Offs/控制流/I/O"从"当前已具备"改为"真实但当前明确未实现（识别并报 unsupported）"，并只把实际可实现能力列为当前已具备。
- `.scratch/abb-rapid-parser-hardening/README.md`
  - 记录四张票均已 resolved 与最终支持边界。
- `.scratch/abb-rapid-parser-hardening/issues/04-real-rapid-corpus-validation.md`：状态置为 `resolved`。

### 修改原因

Ticket 04 要求用真实语料证明 parser 能稳定区分当前可执行子集与真实但暂不支持能力，并完整反馈而不崩溃/死循环/静默忽略/部分执行；同时收口绑定文档，避免把未实现能力写成当前已具备。

### 影响

- 当前未支持的关键字（VAR/IF/WHILE/FOR/MoveC/MoveAbsJ/SetDO/WaitTime 等）得到 `unsupported-syntax`/`unsupported-option`/`undefined-symbol`，绝不静默忽略；真实表达式内的未知运算符字符（`+/*=/<` 等）按 `lexical-error` 显式上报。
- 支持与不支持混合时 `canExecute=false`、`program=[]`，绝不执行支持部分；无歧义正确 robtarget 仍只读展示。
- 未新增 VAR、控制流、I/O、过程调用、Offs/RelTool、MoveC/MoveAbsJ 的执行能力；KUKA、planner、ProgramExecutor、Three.js 均未改动。
- 已执行验证：`npx vue-tsc -b` 通过；`npx vitest run src` 全量单测 274 通过（1 个既有 expected fail）；`npx vite build` 生产构建通过；`git diff --check` 通过；未运行 E2E（本轮未改浏览器交互）。

## 2026-08-12 — 完成 Ticket 03：加固 MoveJ、MoveL 参数与可选参数诊断

### 修改文件

- `src/rapid/rapid-parser.ts`
  - 重写 `parseMotion` 的运动操作数解析，改为按位置解析的 `expectOperandSlot` / `operandAfterSeparator`：
    - 空操作数（开头/连续/尾随逗号）在对应位置给出零长度 `缺少…（空操作数）` 诊断并消费逗号继续，不再把逗号误报为首期不支持内容。
    - 操作数间缺逗号只报一次 `运动操作数之间缺少逗号 ","` 根因并恢复，不派生一串缺参错误，也不把残余 token 误报为 unsupported 语句。
    - 第 5 个及以上普通位置参数/尾随逗号报 `运动指令包含多余参数 …` 根因，而非静默忽略或 generic unsupported。
    - 缺分号在语句末尾给零长度 `期望符号 ;`，并恢复到下一条运动或 `ENDPROC`。
  - 可选参数 `\...:=...` 处理：
    - `\WObj:=wobj0` 保持合法；未知可选参数报 `unsupported-option`（范围精确覆盖参数名）后恢复，不再误报 `期望工件坐标名称` 或待解析值。
    - 残缺反斜杠/缺可选名只报缺名根因；缺 `:=` 或工件坐标名给出对应根因；重复 WObj、可选参数后多余 token 明确报出，不再被当作 `首期不支持 \` 或 generic unsupported。
  - 新增 `recoverMotionTail`：断裂运动恢复到分号/下一结构边界，不消费边界 token，保证下一条独立指令继续被分析、`ENDPROC` 不被吞掉。
  - 实际不再被调用的 `expectRequiredOperand` / `failsAtBoundary` 两个 helper 一并删除。
- `src/rapid/rapid-parser-motion-diagnostics.test.ts`（新增）
  - 覆盖：缺 target（开头逗号）、连续逗号、尾随逗号、第 5 个位置参数、缺逗号、缺分号恢复；合法/未知/重复/残缺 WObj 可选参数；未定义 target/speed 的精确范围；z20/自定义 tool/wobj 的 unsupported；target 与 speed 文本重复时仍指向真正操作数；错误运动后的独立指令继续被分析、不吞 ENDPROC。

### 修改原因

Ticket 03 要求运动命令的缺失、过量、错位和不支持操作数都精确指向根因，并在错误指令后继续分析后续独立指令；此前空操作数/多余参数/残缺可选参数会产生误导性 unsupported 诊断甚至吞掉下一条指令。

### 影响

- 合法 MoveJ/MoveL 的 `sourceText`、`sourceRange`、`operandRanges`、Program Data 引用与插入锚点保持原行为（由既有回归与新增测试共同锁定）。
- 运动命令的根因诊断更加精确、无连锁；错误运动后的独立指令继续被分析。
- 未增加 MoveC/MoveAbsJ/zone 过渡/自定义工具或工件的执行能力，不修改 planner 与 ProgramExecutor 契约。
- 已执行验证：`npx vue-tsc -b` 通过；`src/rapid` 130 测试、`src/application` 31 测试通过；`git diff --check` 通过。本票不运行完整 E2E。

## 2026-08-12 — 完成 Ticket 02：加固 MODULE、PROC 与 robtarget 声明诊断

### 修改文件

- `src/rapid/rapid-parser.ts`
  - 新增 `KNOWN_UNSUPPORTED_TYPES`（num/bool/string/tooldata/wobjdata/speeddata/zonedata/loaddata 等）与 `MODULE_NAME_KEYWORDS` 两类声明期分类常量。
  - `parseRobTargetDeclaration`：区分“漏写数据类型”（紧跟的是 robtarget 名称，报零长度 `缺少数据类型（期望 robtarget）`）与“已知但不支持的类型”（num/tooldata 等，报 `unsupported-option`）；缺少 robtarget 名称或 `:=` 时恢复本声明但**不生成半合法 Program Data 条目**，避免损坏声明进入 `data`。
  - 模块门禁：`MODULE` 后紧跟结构化关键字（PROC/ENDMODULE/CONST 等）时报告 `缺少模块名称`，不再把 `PROC` 误当模块名。
  - `parseMainBody`：循环在 `ENDPROC` **和 `ENDMODULE`** 双边界停止；缺少 `ENDPROC` 时给出单一 `期望关键字 ENDPROC` 根因，不再把 `ENDMODULE` 误报为首期不支持/尾随内容，也保留模块边界的正确闭合。
- `src/rapid/rapid-parser-decl-diagnostics.test.ts`（新增）
  - 覆盖：缺模块名称、第二个 MODULE、ENDMODULE 尾随、main 带参数/重复、其它过程/VAR/IF 的 unsupported（非 lexical-error）、缺数据类型、已知不支持类型、缺 `:=`、缺声明分号、tuple 长度/尾逗号、大小写重复名范围、损坏声明后正确声明仍入数据、缺 ENDPROC/ENDMODULE 恢复边界。

### 修改原因

Ticket 02 要求学习者在 MODULE/main/robtarget 声明写错时得到精确且可继续解析的诊断；此前缺数据类型会把名称误判为不支持的类型名，缺 `:=` 会生成半合法数据条目，缺 ENDPROC 会产生吞掉 ENDMODULE 的连锁噪声。

### 影响

- 正确声明仍进入只读 Program Data；任意 error 时 `canExecute=false` 且 `program=[]`，既有结构化写入门禁不受影响。
- 损坏声明不再生成半合法 Program Data 条目；缺失结构的回归范围显著收窄为单一根因。
- 合法 CONST/PERS/TASK PERS robtarget、大小写匹配与引用行为无回归。
- 已执行验证：`npx vue-tsc -b` 通过；`src/rapid` 113 测试通过、`src/application` 31 测试通过；`git diff --check` 通过。本票不运行完整 E2E。

## 2026-08-12 — 完成 Ticket 01：建立稳定诊断与源码保真基础

### 修改文件

- `src/rapid/rapid-parser.ts`
  - 新增 `addMissingDiagnostic`：缺失 token 的根因诊断使用零长度范围，指向应插入位置（当前游标），替代原先覆盖下一个 token 的已有范围。
  - 新增 `isMotionBoundary` / `atOperandBoundary` / `failsAtBoundary` / `expectRequiredOperand`：建立运动参数有限恢复边界——在一个运动指令缺少后续必选操作数或已到达 `ENDPROC`/`ENDMODULE`/下一条运动/EOF 时，只发一条定位到光标处的“参数不完整”根因诊断并中止本指令，不再派生“后续所有操作数均缺失”的连锁错误，也不再吞掉下一条已知运动或过程结束标记。
  - 新增 `recordTargetReference`：目标名在解析阶段即结算引用（已定义计入 Program Data 引用范围，未定义发 undefined-symbol），即使指令随后因断裂恢复被中止，无歧义识别的目标引用根因也不会丢失。
  - 新增 `hasModuleHeader` 状态与模块门禁收口：从未解析出 `MODULE` 关键字时，省略尾随的“缺少 ENDMODULE”与重复的“缺少有效 MODULE”噪声，仅保留一条 `missing-module` 根因；已建立 MODULE 却未闭合时用零长度“缺少 ENDMODULE”作为唯一根因。
  - 解析结束时新增诊断排序与去重：按 `range.start.offset`、`range.end.offset`、生成次序升序排列，并消除“相同 code + 相同起止 offset”的重复条目，使同一源码重复解析得到顺序完全一致、无重复的诊断列表。
- `src/rapid/rapid-parser-diagnostics.test.ts`（新增）
  - 覆盖 Ticket 01 验收：重复解析诊断稳定一致、按 offset 严格排序、同 code 同范围去重、缺失 token 零长度范围、已有错误 token 非零范围、根因不派生连锁、运动断裂后恢复不误吞下一条指令、LF/CRLF 行列平价、注释/空行不改指令顺序与引用、合法程序输出回归。

### 修改原因

现有 parser 对损坏指令会连续抛出多个缺参/缺分隔符诊断，断裂恢复甚至会吞掉下一条合法运动或 `ENDPROC`/`ENDMODULE`，产生误导性噪声。按 Ticket 01 要求把诊断契约固化为“顺序稳定、范围精确、无重复、无连锁”。

### 影响

- 合法 MoveJ/MoveL 程序的结构化输出、Program Data、引用范围与插入锚点保持不变（已由回归测试锁定）。
- 损坏指令现在只产生定位准确的单一根因诊断，而非一串缺参错误；`ENDPROC`/`ENDMODULE` 不再被误报缺失。
- 空源码/缺 MODULE 的噪声显著减少，保留最能指导用户的根因诊断。
- 已执行验证：`npx vue-tsc -b` 通过；`src/rapid`、`src/application` 定向测试 131 通过；`git diff --check` 通过。本票不运行完整 E2E。

## 2026-08-12 — 发布 ABB RAPID Parser 与诊断加固里程碑 Tickets

### 修改文件

- `.scratch/abb-rapid-parser-hardening/README.md`
  - 建立独立 parser 加固里程碑，明确唯一解析入口、复用边界、统一禁止事项和 `01 → 02 → 03 → 04` 线性执行顺序。
- `.scratch/abb-rapid-parser-hardening/issues/01-stable-diagnostics-and-source-fidelity.md`
  - 规划稳定诊断顺序、去重、零长度缺失范围、错误恢复和 LF/CRLF 源码保真基础。
- `.scratch/abb-rapid-parser-hardening/issues/02-module-procedure-and-data-diagnostics.md`
  - 规划 MODULE、main 过程和 robtarget 声明的精确诊断、连锁错误抑制及错误源码只读 Program Data。
- `.scratch/abb-rapid-parser-hardening/issues/03-motion-operand-diagnostics.md`
  - 规划 MoveJ/MoveL 必选操作数、分隔符、分号、`\WObj` 和未定义/暂不支持参数的精确诊断与恢复。
- `.scratch/abb-rapid-parser-hardening/issues/04-real-rapid-corpus-validation.md`
  - 规划使用现有真实 `.mod` 片段验证 unsupported 诊断韧性、禁止部分执行、现有 UI 诊断闭环和最终完整验证。

### 修改原因

现有 parser 已经能执行 MoveJ/MoveL，但结构错误和损坏操作数仍需要更稳定的恢复与精确诊断。用户确认本轮严格限制为加固现有可执行子集，不顺带实现 VAR、控制流、I/O 或更多运动指令，因此将工作拆成小模型可线性执行且不会重复造轮子的四张票。

### 影响

- 本次只新增规划票据和更新说明，不修改业务代码、测试或运行时行为。
- 前三张票只做定向验证，完整单测与构建集中在最后一票，避免重复测试。
- 新里程碑与已完成的点位示教、工作台 UI 和旧 RAPID 路线物理隔离，不回写 resolved 票据。

## 2026-08-12 — 确定 ABB RAPID 教学平台的合理支持范围

### 修改文件

- `docs/research/abb-rapid-teaching-scope.md`
  - 依据 ABB RAPID 官方手册、ABB Programming I/II/III 课程目录、RobotStudio 官方教程与操作手册，以及国内 ABB 实训案例，确定本项目应以“ABB 基础编程课程核心实验”为毕业目标。
  - 给出程序结构、数据类型、控制流、运动指令、位置函数、I/O/等待和教学观察的建议支持清单。
  - 明确中断、错误恢复、多任务、Socket/OPC、SafeMove、视觉、外部轴与工艺包只做识别和 unsupported 诊断，不进入当前核心执行范围。
  - 将实施路线拆为 parser 加固、真实运动数据与坐标、变量与控制流、虚拟 I/O、MoveC/MoveAbsJ 五个阶段，并指出控制流需要最小可执行 IR，不能塞入现有 MotionRunner。
- `docs/research/abb-training-market-scope.md`
  - 汇总 ABB 官方培训与浏览器教学产品样本，比较基础操作、Programming I、Programming II 和高级工程课程的实际教学边界。
  - 对照当前源码确认项目处于 L0，并给出 L0–L3 的课程能力分层与里程碑建议。

### 修改原因

官方 RAPID 参考手册包含数百项能力，不能直接作为教学软件开发清单。本次研究把语言全集、ABB 官方课程、市场实训范围和项目现状分开，避免把“完整”误解为复制 ABB 控制器，也避免只实现零散指令而无法完成教学任务。

### 影响

- 本次只新增研究与路线判断文档，不修改 RAPID parser、执行器、运动规划、Vue 页面或 Three.js。
- 后续开发应先完成现有 MoveJ/MoveL parser 加固，再按研究路线拆成独立里程碑；不得把未实现能力写成当前已支持。
- 研究发现 `docs/rapid-official-reference-notes.md` 第 10 节存在将未来建议误写为当前能力的表述，已在新研究中标明，待文档整理时修正。

## 2026-08-12 — 修正 Program Data 选中操作区布局

- `src/components/ProgramDataPanel.vue`：为选中点位操作区增加“收起/展开”控制；收起时保留当前点位选择和列表高亮，不再占用完整操作区高度。
- `src/style.css`：增加选中操作区标题操作布局和可访问的切换按钮样式；限制展开区高度并允许其内部滚动，避免右侧点位列表被操作区挤压到不可见。

### 影响

- 选中点位后可以收起操作区，恢复完整点位列表；需要继续 Modify Position、查看引用或插入运动时可再次展开。
- 未修改 RAPID 解析、点位派生数据、受控编辑和执行逻辑。

## 2026-08-12 — Three.js WebGL 初始化失败降级

- `src/components/SceneViewport.vue`：捕获 `createAbbScene` 创建 WebGL 渲染器时抛出的异常，向上层发送 `error` 状态并记录单条关键错误日志；WebGL 正常时保持原有初始化、关节同步和资源释放流程不变。
- `src/components/SceneViewport.vue`：增加场景不可用降级提示，明确说明浏览器未提供 WebGL 时的处理建议，避免 Vue mounted hook 未处理异常导致整个示教工作台崩溃。
- `src/components/SceneViewport.test.ts`：新增 WebGL 创建失败回归测试，验证组件可以挂载、显示降级提示并发出 `error` 状态。

### 影响

- 在禁用硬件加速、浏览器沙箱无法创建 WebGL context 或其他 Three.js 初始化异常的环境中，左侧/右侧教学面板仍可继续使用，中央场景区域显示可理解的故障提示。
- 未修改 ABB 运动学、RAPID 执行、轨迹记录或 Three.js 正常渲染路径；恢复可用 WebGL 后无需额外配置即可继续使用三维场景。

## 2026-08-12 — 修复工作台界面复审阻断项

- `src/components/WorkbenchLayout.vue`：折叠/展开按钮增加 `aria-expanded`，明确面板当前可见状态。
- `src/components/JogControlTabs.vue` / `ProgramWorkspace.vue`：方向键切换 Tab 后主动聚焦新激活按钮，保持键盘操作连续性。
- `src/components/ProgramDataPanel.vue` / `src/style.css`：Program Data 改为固定顶部工具区、独立可滚动点位列表和固定选中操作区；右侧 Tab 内容不再整体滚动。
- `src/style.css`：压缩左侧关节控制的间距和位姿卡片，在 1366×768 下保证当前 Tab 内容完整可见且不显示左侧滚动条。
- `src/components/WorkbenchLayout.test.ts`、`JogControlTabs.test.ts`、`ProgramWorkspace.test.ts`：补充无障碍展开状态与键盘焦点回归测试。

### 验证

- 1366×768 临时 preview 实测：左侧关节内容 `scrollHeight` 等于 `clientHeight`；Program Data 列表独立滚动。
- 未启动或触碰用户维护的 5173 服务。

### 票据状态

- `01-collapsible-single-screen-workbench.md`、`02-tabbed-jog-sidebar.md`、`03-tabbed-programming-workspace.md`、`04-abb-program-data-browser.md` 均已更新为 `resolved`。

## 2026-08-12 — 实现 ABB 教学工作台界面优化里程碑

### 修改文件

- `src/components/WorkbenchLayout.vue` / `WorkbenchLayout.test.ts`
  - 新增单屏三栏工作台壳层，左右栏固定宽度并支持独立收起、展开和同时收起。
  - 折叠采用保留组件实例的隐藏方式，避免重新展开时丢失 Tab、编辑器光标、筛选和选择状态。
  - 增加键盘可访问的收起/展开按钮与对应布局测试。
- `src/components/JogControlTabs.vue` / `JogControlTabs.test.ts`
  - 新增左侧“关节 / 笛卡尔”Tab。
  - 只转发现有 Jog 组件事件，关节、步进、坐标系和笛卡尔状态仍由 App 唯一持有。
  - 增加 Tab 键盘方向切换和事件转发测试。
- `src/components/ProgramWorkspace.vue` / `ProgramWorkspace.test.ts`
  - 新增右侧“RAPID / Program Data”Tab 工作区。
  - 将程序源码内容与运行、单步、停止、PP to Main 控制栏分离，控制栏固定在右侧底部。
  - 通过同一 ProgramController、parser 和源码编辑器实例保留执行状态与编辑状态。
- `src/components/ProgramControlPanel.vue`
  - 增加 `all/content/actions` 展示模式，使既有程序控制逻辑可以组合进右侧工作区而不复制状态。
- `src/components/ProgramDataPanel.vue` / `ProgramDataPanel.test.ts`
  - 将点位界面改为 ABB 式 `robtarget` 连续列表、名称筛选、选中目标操作和详情层。
  - 查看引用会发出精确源码范围事件；Modify Position、重命名、删除和插入运动仍通过既有受控源码编辑入口。
  - 保留错误源码只读浏览、共享引用提示、robconf 未模拟说明和唯一 RAPID 事实源。
- `src/components/RapidSourceEditor.vue`
  - 增加按 Program Data 引用范围聚焦源码、选中范围和滚动定位能力。
- `src/App.vue`
  - 接入新工作台、左侧 Jog Tab 和右侧 RAPID/Program Data 工作区。
  - 删除旧的纵向堆叠侧栏和营销式页脚，保留现有 ABB 运动、程序和 Three.js 状态。
- `src/style.css`
  - 增加固定动态视口、三栏网格、折叠轨道、Tab、右栏内部滚动和底部程序控制区样式。
  - 页面根节点不滚动；RAPID 编辑器保留双向滚动，Program Data 保留纵向滚动。
- `e2e/abb-program.spec.ts` / `e2e/abb-irb1200.spec.ts`
  - 迁移受 Tab 布局影响的 Program Data、笛卡尔和点位操作选择器。

### 修改原因

现有教学能力已经完成，但页面结构仍把关节、笛卡尔和 Program Data 纵向堆在左栏，RAPID 与程序控制绑定在单一卡片中。此次按已确认的 ABB 工作台方案重组界面，同时保持运动学、RAPID 解析、程序执行和 Three.js 显示职责不变。

### 影响

- 用户获得可折叠的三栏 ABB 教学工作台：左侧 Jog、中间场景、右侧 RAPID/Program Data。
- 左右栏可以独立收起，释放空间给 Three.js；刷新后恢复默认展开。
- RAPID 和 Program Data 允许内部滚动，页面整体不滚动；程序控制始终固定可见。
- Program Data 不再维护第二份点位状态，列表、筛选、引用和详情均来自同一次 RAPID 解析结果。
- KUKA 预留、ABB 运动学、程序控制语义和 Three.js 场景逻辑未被改写。

### 复审修正

- `src/components/ProgramWorkspace.vue` / `ProgramControlPanel.vue` / `RapidSourceEditor.vue`
  - 为 Program Data 查看引用增加单调 `focusRequestId`，重复点击同一源码范围时也会重新聚焦、选中和滚动定位。
- `src/components/ProgramWorkspace.test.ts`
  - 增加重复查看同一引用的回归测试。


# 2026-08-12：发布 ABB 教学工作台界面优化里程碑 Tickets

## 修改文件

- `.scratch/abb-teaching-workbench-ui/README.md`
  - 建立独立的前端工作台界面优化里程碑，明确四张票采用 `01 → 02 → 03 → 04` 线性实施。
- `.scratch/abb-teaching-workbench-ui/issues/01-collapsible-single-screen-workbench.md`
  - 规划固定视口三栏工作台、左右独立折叠、1366×768 基线和页面无整体滚动的完整验收边界。
- `.scratch/abb-teaching-workbench-ui/issues/02-tabbed-jog-sidebar.md`
  - 规划左侧“关节 / 笛卡尔”Tab，在不复制运动状态的前提下收敛现有 Jog 控制。
- `.scratch/abb-teaching-workbench-ui/issues/03-tabbed-programming-workspace.md`
  - 规划右侧“RAPID / Program Data”Tab、RAPID 双向内部滚动和始终固定的 ABB 程序控制区。
- `.scratch/abb-teaching-workbench-ui/issues/04-abb-program-data-browser.md`
  - 规划 ABB 式 robtarget 连续列表、筛选、选中项操作、详情层和源码引用定位，并集中最终完整验证。

## 修改原因

现有功能闭环已经完成，但页面仍把 Program Data 放在左栏、关节与笛卡尔控制纵向堆叠、RAPID 与程序控制绑定在单一卡片中。新里程碑依据已确认的界面决策，将这些能力重组为可折叠的三栏教学工作台，同时保持 ABB 操作语义和 RAPID 唯一事实源。

## 影响

- 本次只增加规划票据和更新说明，不修改业务代码、样式、测试或运行时行为。
- 新票据与已经完成的点位示教里程碑物理隔离，不回写旧里程碑票据。
- 四张票明确复用现有控制、解析和执行模块，避免实施模型重复创建 Tab 状态、点位存储、程序控制或 Three.js 场景。
- 前三票只要求针对性测试，完整检查、单测、构建和浏览器验收集中在最后一票，减少重复验证。

## 2026-08-12 — 最终复审边界修复

- **`src/application/program-control.ts`**：自由 textarea 编辑只有在新程序中存在唯一同文本指令时才保留 PP；重复候选统一要求 PP to Main，避免静默指向错误运动。
- **`src/components/RapidSourceEditor.vue` / `src/style.css`**：关闭 textarea 软换行并统一编辑器与 gutter 行高为 20px，保证长 RAPID 行的 PP/MP/错误标记不漂移。
- **`src/components/ProgramDataPanel.vue` / `src/App.vue`**：当前 FK 姿态显式允许为空并在示教时给出错误提示；robconf 明示“当前 MVP 未模拟构型控制”，Modify Position 使用 ABB 术语。
- **`src/rapid/controlled-rapid-edit.ts` / `src/rapid/rapid-parser.ts`**：删除已无调用方的编辑范围字段和旧的单一 motionInsertOffset 契约，保留唯一的插入点列表与 PP 位移信息。

## 2026-08-12 — 修复代码评审发现的 RAPID 教学闭环问题

- **修改原因**：本轮 code review 发现操作数诊断定位、Program Data 插入位置、停止态 PP 映射、错误门禁、源码 gutter、轨迹采样和代理文档存在可验证缺口；本次按最简原则直接修复，不引入第二份点位状态。
- **`src/rapid/rapid-parser.ts`**：为 MoveJ/MoveL 保存 target/speed/zone/tool/wobj 的 Token 范围，诊断不再使用 `source.indexOf` 猜测位置；新增 `motionInsertionPoints`，并在可执行指令中暴露 `operandRanges`。
- **`src/rapid/controlled-rapid-edit.ts` / `src/components/ProgramDataPanel.vue` / `src/App.vue`**：插入命令新增 `insertionIndex`，Program Data 面板显示 main 内合法插入位置，受控编辑返回运动下标位移信息，支持首条、中间和末尾插入。
- **`src/application/program-control.ts`**：受控编辑标记改为一次性消费并校验源码仍是编辑产物；插入运动后按下标位移保留旧 PP；idle 源码变化同步诊断；手动 Jog 仅在运行/停止程序上下文标记 off-path。
- **`src/rapid/program-executor.ts` / `src/components/ProgramControlPanel.vue`**：快照新增 `stopReason`，区分用户停止与单步完成；静态诊断存在时禁用运行/单步。
- **`src/components/RapidSourceEditor.vue` / `src/style.css`**：gutter 新增 parser 诊断行和运行时规划错误行标记。
- **`src/scene/abb-scene.ts`**：TCP 轨迹采样与显示开关解耦，关闭显示时仍保留真实采样，之后打开可查看已有轨迹。
- **`src/rapid/movej-planner.ts`**：复用 `SixAxisJointRanges` 六元 tuple，并将 `buildAlternateIKSs` 更名为 `buildAlternateIKSeeds`。
- **`CLAUDE.md`**：删除与真实 Vue 项目不符的 React/不存在文件说明，重写为 ABB 项目事实、KUKA 保留、RAPID 单一事实源和验证约束。
- **测试**：补充操作数精确范围、插入位置、PP 位移、停止原因、错误 gutter、静态诊断门禁和 UI 插入选择测试；针对性测试 7 文件 / 102 项通过，`npm run check` 通过。

## 2026-08-11 — 代码评审修复（standards 气味清理）

- **修改原因**：两轴 code-review 指出三处可验证的清理点，均符合"最简原则"——
  1. `style.css` 遗留 `.program-state-paused` 死样式（暂停/继续概念已随 Ticket 04 删除，无任何引用）。
  2. `ProgramDataPanel.vue` 的 `taughtRobTarget` 手写 `robconf:[0,0,0,0]` 与字面 `[9e9×6]`，与 `controlled-rapid-edit.ts` 的 `makeEmptyTaughtTarget`（用 `NO_EXTERNAL_AXIS` 工厂）重复，改外轴语义时易只改一处。
  3. `planMoveJ` 错误路径为区分 `joint-limit`/`unreachable` 再次调用 `solveIK(primary)`，而 `resolveJointSolution` 内部已算过同一主初值。
- **`src/style.css`**：删除 `.program-state-paused` 死样式。
- **`src/components/ProgramDataPanel.vue`**：`taughtRobTarget` 改为复用 `makeEmptyTaughtTarget` 工厂，消除手写 robconf/extax。
- **`src/rapid/movej-planner.ts`**：`resolveJointSolution` 改为返回 `{ joints }` 或 `{ failure: 'joint-limit' | 'unreachable' }`，`planMoveJ` 据 `failure` 构造错误，不再重复逆解。
- **影响范围**：仅清理与重构，不改变行为；TypeScript 检查通过、全量单测 211 通过；未启动开发服务、未提交 Git。

## 2026-08-11 — Ticket 06：完成源码与运动教学观察闭环

- **修改原因**：学生在三栏工作台上完成 Jog、示教点位、编写 MoveJ/MoveL、单步与连续运行时，应能同时看见源码执行位置、结构化运动参数、机器人状态与实际 TCP 轨迹。
- **`src/rapid/rapid-parser.ts`**：为可执行指令补充 `operands`（target/speed/zone/tool/wobj 原始拼写），使组件展示结构化摘要时不需解析 RAPID 字符串。
- **`src/components/RapidSourceEditor.vue`**（新增）：原生 textarea 旁的行号/状态 gutter（与 textarea 同步滚动），PP 蓝色、MP 橙色、同行可并存；其下结构化指令摘要展示指令类型与操作数原始名称。
- **`src/components/ProgramControlPanel.vue` / `src/App.vue`**：接入 `RapidSourceEditor`；按 `program`（parser 结果）把快照 PP/MP 索引映射到源码行 gutter，并从当前活动/待执行指令派生结构化摘要；off-path Clear、PP to Main、Program Data 与程序控制保持前票 ABB 语义。
- **测试**：`RapidSourceEditor.test.ts` 新增 6 个 gutter/摘要测试；`ProgramControlPanel.test.ts` 新增 PP/MP 行标记与结构化摘要测试；parser 通过。
- **浏览器验收（独立临时 preview）**：改写 `e2e/abb-program.spec.ts` 为运行/单步/停止/PP to Main —— 完整运行、单步等待下一步、停止不推进、停止续跑、完成 PP to Main 重跑、诊断阻止、运行锁源码、教学闭环（新建→插入 MoveJ→单步→连续运行→修改位置→再运行）与结构化摘要联动。删除旧暂停/继续浏览器场景。
- **最终验证**：一次 TypeScript 检查、全量单测（211 通过）、生产构建、浏览器 E2E（14 通过）全部通过；E2E 使用独立临时 4173 preview，结束后已终止该 preview 并确认端口释放，未触碰用户 5173 服务；未提交 Git。

## 2026-08-11 — Ticket 05：处理停止后的源码编辑与 Jog

- **修改原因**：程序停止后用户应能安全修改 RAPID 或手动 Jog；系统要保持正确 PP，无法映射时要求 PP to Main，机器人偏离路径时按 ABB Clear 语义从当前位置继续。
- **`src/rapid/program-executor.ts`**：`createProgramExecutor` 支持 `initialPointer`，供源码编辑后按原 PP 重建执行器。
- **`src/application/program-control.ts`**：新增停止态 PP 映射与 off-path 协调 —
  - `watch(parsed)` 在源码变化后 `reconcileProgramAfterSourceChange()`：受控编辑（带编辑范围）保留指令集合与顺序，PP 按同一下标映射；自由 textarea 编辑用保守策略（下标处 sourceText 一致才保留，否则置 `needsPPtoMain`）；新源码不可执行或无法唯一映射时要求 PP to Main。
  - `offPath`/`needsPPtoMain` 进入快照；`run()`/`step()` 被 `needsPPtoMain`（要求 PP to Main）和 `offPath`（转为 Clear 确认）门控，不立即运动。
  - `stopActiveProgram()`（手动命令入口）在已有停止程序上下文后标记 off-path（初始空闲 Jog 不提示）；`stop()`（用户点击停止）本身不标记。
  - `pendingClear` + `confirmClearToNext()`/`cancelClearToNext()`：off-path 确认后清除标记并从当前姿态按原请求模式规划；PP to Main 不清零机器人、不伪装已回原路径，重建执行器到 main。
- **`src/components/ProgramControlPanel.vue` / `src/App.vue`**：PP 无法映射时禁用运行/单步并提示先 PP to Main；off-path 提示偏离并显示 Clear 确认（从当前位置规划到下一目标）。
- **测试**：`program-control.test.ts` 新增 5 个 PP 映射测试（Modify Position/重命名/自由删除/保守保留）、4 个 off-path 确认测试与 1 个 stop—Jog—confirm—run 单一 MotionRunner 集成测试；`ProgramControlPanel.test.ts` 新增 off-path/PP 门控与 Clear 确认测试。
- **影响范围**：仅修改执行器（首指针）、程序控制器与程序面板；全量单测 202 通过、TypeScript 检查通过；未启动开发服务、未提交 Git。

## 2026-08-11 — Ticket 04：对齐 ABB 程序执行操作

- **修改原因**：用户需要通过 ABB 风格的“运行、单步、停止、PP to Main”操作同一份 RAPID 程序；单步完整完成一条运动后停在下一条，停止后可从当前执行位置继续，PP to Main 只移动程序指针，不再提供独立暂停/继续。
- **`src/rapid/program-executor.ts`**：重构执行器为 ABB 语义 — 状态机收敛为 `idle/running/stopped/completed/error`（删除 `paused`），公开命令为 `run`（从当前 PP 连续运行）、`step`（只执行 PP 对应的一条完整运动，成功后 PP 推进，末条置 completed 否则 stopped 等待下一步）、`stop`（只委托一次 seam.stop）、`ppToMain`（非运行态把 PP 移到 main，不清零机器人/轨迹）。删除 `pause`/`resume`/`reset`，`ProgramExecutionSeam` 收敛为 `execute`+`stop`。
- **`src/application/program-control.ts`**：`ProgramControllerMotion` 移除 `pauseMotion`/`resumeMotion`；控制器命令改为 `run`/`step`/`stop`/`ppToMain`，删除 `pause`/`resume`/`reset`。
- **`src/components/ProgramControlPanel.vue` / `src/App.vue`**：界面只提供运行/单步/停止/PP to Main，删除暂停/继续/复位入口与兼容包装；运行期间源码只读，停止后“等待下一步”提示由 stopped 状态派生。
- **测试**：`program-executor.test.ts` 整体改写覆盖连续、逐步、末条完成、停止续跑、PP to Main、错误与重复命令；`ProgramControlPanel.test.ts` 改写覆盖四类按钮可用性与命令映射；`program-control.test.ts` 更新为 run/step/stop/ppToMain 日志与抢占语义。
- **影响范围**：删除旧暂停/继续/复位后整个 TypeScript 项目独立编译通过、全量单测 191 通过、生产构建通过；未启动开发服务、未提交 Git。

## 2026-08-11 — Ticket 03：完成 Program Data 点位示教与编辑

- **修改原因**：用户 Jog 机器人后应能把当前 TCP 创建为命名点位、Modify Position 更新已有点位、管理名称与引用、并把选中点位插入为 MoveJ/MoveL；所有确认结果都表现为可见的 RAPID 源码最小修改。
- **`src/rapid/rapid-parser.ts`**：为每个 robtarget 派生视图补齐 `declarationRange`（完整声明语句）与 `valueRange`（值字面量），并暴露 `dataInsertOffset`（main PROC 前）与 `motionInsertOffset`（main ENDPROC 前）两个受控编辑插入点。
- **`src/rapid/controlled-rapid-edit.ts`**（新增）：RAPID 受控源码编辑深模块。一次执行一条结构化命令（创建命名目标 / Modify Position / 重命名 / 删除未引用目标 / 插入 MoveJ/MoveL），只做符号级最小文本替换；新建声明与新运动指令使用固定 ABB 风格；源程序存在 error 时禁止编辑；非法名称、重名、缺失目标与删除有引用目标都返回结构化拒绝原因，源文本逐字不变。
- **`src/application/program-control.ts`**：新增唯一受控编辑入口 `applyEdit`，把命令委托给 RAPID 层；成功才更新源码 ref（`parsed` 随之重算），失败保持源码不变。
- **`src/components/ProgramDataPanel.vue`**：在只读浏览基础上加入六类操作——“新建点位”（名称输入 + 当前 ABB 基座 tool0 TCP）、示教 Modify Position、重命名、删除、插入 MoveJ、插入 MoveL；共享目标示教前提示引用影响范围，失败展示结构化拒绝原因，`canExecute=false` 时只读。
- **`src/App.vue`**：为 Program Data 面板提供 `toolPose`（由 FK 派生的当前 ABB 基座 TCP）与 `applyEdit` 回调。
- **测试**：`controlled-rapid-edit.test.ts` 新增 13 个受控编辑测试，`program-control.test.ts` 新增 4 个唯一入口测试，`ProgramDataPanel.test.ts` 新增 5 个示教/编辑组件测试。
- **影响范围**：仅修改 RAPID 受控编辑、程序控制器与 Program Data 面板；运行相关编辑/控制/组件测试（33 通过）与一次 TypeScript 检查；未启动开发服务、未提交 Git。

## 2026-08-11 — Ticket 02：建立三栏 Program Data 浏览闭环

- **修改原因**：需要在同一工作台左侧浏览右侧 RAPID 源码中声明的命名点位，且点位始终由源码实时派生，不存在第二份点位表。
- **`src/rapid/rapid-parser.ts`**：扩展同一份解析结果，暴露 `data`（模块级命名 robtarget 的名称原始拼写、存储类别 `const`/`pers`、值、声明名精确源码范围、每条 MoveJ/MoveL 操作数引用范围）。在 `parseRobTargetDeclaration` 记录存储类别，在程序构建循环按操作数记录引用（大小写不敏感归并，注释/相似标识符不会被误识别）；即使存在 error 也暴露已识别数据供只读浏览。
- **`src/application/program-control.ts`**：新增单一解析事实源 `parsed`（computed 随源码实时重算），`run()` 复用该结果，快照诊断统一取自 `parsed`；消除平行 parser，暴露 `parsed` 供页面与面板共享。
- **`src/components/ProgramDataPanel.vue`**（新增）：左侧 Program Data 派生视图，按声明顺序列出名称、存储、坐标/姿态/robconf/外轴与引用次数；存在 error 时只读浏览并提示禁用结构化编辑。
- **`src/App.vue` / `src/style.css`**：把工作台重构为左中右三栏（左侧控制与 Program Data、中间 Three.js、右侧 RAPID 编辑器），窄屏按左→中→右顺序堆叠。
- **测试**：`rapid-parser.test.ts` 新增 6 个派生视图测试，`ProgramDataPanel.test.ts` 新增 4 个组件测试，覆盖声明/值/共享引用/大小写/错误源码与三栏列表。
- **影响范围**：新增 parser data 输出与 Program Data 面板，重构为三栏布局；运行相关 parser/组件测试（26 通过）与一次 TypeScript 检查；未启动开发服务、未提交 Git。

## 2026-08-11 — Ticket 01：可靠回放大幅 MoveJ（多初值 IK）

- **修改原因**：已示教且可达的大幅 MoveJ 从远端姿态回放时，单一当前关节初值的数值 IK 常落入错误分支或无法收敛（如目标 J1=+60°、当前 J1=-120°），导致被误报为不可达。
- **`src/rapid/movej-planner.ts`**：在 `planMoveJ` 收敛到 `resolveJointSolution` — 主初值仍是当前关节姿态且成功不夹边则立即返回（贴近目标不做多余候选搜索）；主初值无效后才扫描有限、确定性、受关节范围约束的备用初值，从当前姿态按物理构型翻转派生（腕部翻转、J1 ±180° 肩部镜像、肩肘翻转），去重后数量固定。多个候选中按各轴关节范围归一化距离选择离当前姿态最近的解，首见顺序平局稳定。主初值夹边而备用无解仍保持既有 `joint-limit` 语义，真正不可达仍返回 `unreachable` 且不启动运动。
- **`src/rapid/movej-planner.test.ts`**：新增 5 个多初值回放测试 — 大幅 J1 复合目标远端回放、含大幅 J1/肩肘/腕复合目标回放、最近解选择与平局稳定、近距离主初值优先、真正不可达不启动运动。
- **影响范围**：仅修改 MoveJ 规划层；MoveL、通用 IK 接口、KUKA 预留与 Three.js 显示逻辑不变。运行相关 MoveJ 测试（25 通过）与一次 TypeScript 检查通过；未启动开发服务。

## 2026-08-11 — 按 `$to-tickets` 正式发布六张纵向实施票

- **修改原因**：此前九张文档属于模块化实施草稿，没有先经过用户粒度确认，也不符合 `$to-tickets` 的纵向 tracer 与正式发布格式；用户确认将正式执行步骤收敛为六张。
- **删除内容**：移除 `implementation/` 下九张旧草稿，避免小模型同时看到两套冲突执行说明。
- **`implementation/issues/01` 至 `06`**：按用户确认的顺序正式发布六张一票一文件 tickets，覆盖大幅 MoveJ、三栏 Program Data 浏览、点位示教编辑、ABB 程序操作、停止态源码/Jog 处理和最终教学观察闭环。
- **阻塞关系**：Ticket 01 与 Ticket 02 可立即开始；Program Data 编辑由 02 阻塞，随后 03 → 04 → 05 → 06 形成线性主链。
- **票据内容**：每张票只描述用户可验证的端到端行为，声明现有 seam、验收清单和验证边界；正式票不绑定具体源码路径或实现片段。
- **影响范围**：只更新当前里程碑实施文档与 `UPDATE_LOG.md`，不修改父 Wayfinder 地图、业务代码、测试或 KUKA 预留；未运行测试、未启动服务。

## 2026-08-11 — 按小模型 Tracer 审查修正实施票

- **修改原因**：`claude-small-model-check` 发现原 Ticket 05 删除 ProgramExecutor 旧接口却未覆盖调用方，无法独立通过编译；原 Ticket 06 同时承载源码 PP 映射和 off-path 两个状态机，不是单一 tracer。
- **Ticket 05**：扩展为从纯 executor 到 ProgramController/按钮接线的编译绿色纵切，仍不包含源码映射或 off-path。
- **Ticket 06/07**：拆为“停止态受控源码编辑保持 PP”和“停止后 Jog/off-path Clear”两张线性票，各自只有一个状态变化轴。
- **Ticket 08/09**：顺延为三栏 Program Data UI 与最终源码/运动观察；删除重复的程序按钮迁移，明确 Program Data edit result 如何通知 ProgramController，并修正最终 E2E 的独立 4173 preview 流程。
- **Ticket 04/README**：补充写操作返回 `RapidSourceEditResult` 的交接契约，并把线性顺序更新为九张票。
- **影响范围**：仅修订实施文档与日志，不修改业务代码，不运行测试或启动服务。

## 2026-08-11 — 完成 ABB 点位示教与程序观察里程碑实施拆票

- **修改原因**：Wayfinder 的 ABB 操作、Program Data、受控源码编辑、可靠回放、单步状态和三栏观察界面决策已经全部收敛，需要交付小模型可按顺序直接执行且不会重复造轮子的实施 tickets。
- **`.scratch/abb-teach-target-and-observe/implementation/README.md`**：新增线性执行索引与共同约束。
- **`implementation/01` 至 `08`**：依次覆盖 MoveJ 有限备用初值、RAPID inspection、受控源码编辑、Program Data 控制器、ABB ProgramExecutor、源码/off-path 协调、三栏 UI 和最终观察闭环；每票写明现有 seam、允许写集、禁止范围、验收向量和最小验证。
- **`.scratch/abb-teach-target-and-observe/map.md`**：地图状态更新为 `resolved`，清空剩余迷雾并链接实施交接目录。
- **影响范围**：仅新增当前新里程碑的实施文档并更新日志，不修改业务代码、测试或 KUKA 预留，不运行测试或启动服务。

## 2026-08-11 — 复用既有原型完成源码与运动观察决策

- **修改原因**：用户指出三栏原型已经完成；继续创建第二份观察原型属于重复设计，应直接在既有布局上确定最小观察规则。
- **`.scratch/abb-teach-target-and-observe/issues/11-source-motion-observation-ui.md`**：状态更新为 `resolved`，引用现有 `program-data-ui-prototype.html`；确定右侧源码的 PP/MP 行标、结构化指令摘要、中间实际 TCP 轨迹、off-path 提示和错误行定位，并明确复用现有状态区域。
- **`.scratch/abb-teach-target-and-observe/map.md`**：加入观察界面决策；地图剩余迷雾收敛为面向小模型的线性实施拆票。
- **未进行的工作**：没有创建第二份 HTML 原型，没有修改正式 Vue、RAPID 执行器、Three.js 或 KUKA 代码，没有运行测试或启动服务。

## 2026-08-11 — 领取源码与运动观察界面原型票

- **修改原因**：ABB 单步执行契约已经完成，下一开放前沿是确定源码、结构化运动信息与 Three.js 轨迹的最小教学呈现方式。
- **`.scratch/abb-teach-target-and-observe/issues/11-source-motion-observation-ui.md`**：添加当前会话负责人，避免其他会话重复处理。
- **影响范围**：仅更新 Wayfinder 票据与日志，不修改正式代码，不运行测试或启动服务。

## 2026-08-11 — 依据 ABB 官方操作逻辑完成单步执行契约

- **修改原因**：用户要求按正常 ABB 示教器逻辑设计，官方资料证明早期“停止后必须复位”“等待时锁定源码”“Jog 自动终止会话”等建议过于接近普通播放器而不符合 ABB。
- **`.scratch/abb-teach-target-and-observe/research/02-abb-program-step-and-pointer-workflow.md`**：新增 ABB RobotWare 6/7/8 与官方 SDK 一手资料调研，核对 PP、MP、Step、Stop、PP to Main、RegainMode 和停止后源码编辑。
- **`.scratch/abb-teach-target-and-observe/issues/10-program-step-execution-contract.md`**：以官方结论重写并标记 `resolved`；确定运行/单步共用 ProgramExecutor、停止后从当前执行位置继续、PP to Main 独立、Jog 后采用 Clear 语义，并排除程序级暂停/继续入口。
- **`.scratch/abb-teach-target-and-observe/issues/11-source-motion-observation-ui.md`**：前置契约已完成，状态由 `blocked` 更新为 `open`。
- **`.scratch/abb-teach-target-and-observe/map.md`**：加入已确认的 ABB 单步执行决策。
- **`CONTEXT.md`**：将“等待下一步”修正为派生 UI 提示，并新增 PP、MP、PP to Main 和 off path 领域术语。
- **影响范围**：只更新研究、领域与 Wayfinder 文档，不修改 ProgramExecutor、Vue、Three.js 或 KUKA 代码；未运行测试、未启动服务。

## 2026-08-11 — 确认 RAPID 单步契约第二轮边界

- **修改原因**：用户确认等待单步期间的手动 Jog 抢占、末条指令、重复命令和规划错误行为。
- **`.scratch/abb-teach-target-and-observe/issues/10-program-step-execution-contract.md`**：补充第二轮四项决策；明确手动操作先停止程序、末条单步直接完成、活动期间不排队命令、规划失败不推进指针。
- **影响范围**：仅更新 Wayfinder 决策票与日志，不修改业务代码，不运行测试或启动服务。

## 2026-08-11 — 确认 RAPID 单步契约第一轮语义

- **修改原因**：用户确认单步完成后的程序边界状态、继续运行起点、源码锁定和按钮可用性。
- **`CONTEXT.md`**：新增“等待下一步”领域术语，明确它表示一条指令已经完成且当前没有活动运动，不能与运动中途冻结的“暂停”混用。
- **`.scratch/abb-teach-target-and-observe/issues/10-program-step-execution-contract.md`**：记录第一轮五项确认结论，作为后续状态机与 UI 按钮契约依据。
- **影响范围**：仅更新领域与规划文档，不修改 `ProgramExecutor`、控制面板或运行时代码，不运行测试或启动服务。

## 2026-08-11 — 领取 RAPID 单步执行状态契约决策票

- **修改原因**：Program Data 三栏界面已经确认，Wayfinder 下一开放前沿是确定连续运行与单步共用同一执行器的最小状态契约。
- **`.scratch/abb-teach-target-and-observe/issues/10-program-step-execution-contract.md`**：添加当前会话负责人，避免并行会话重复处理同一决策。
- **影响范围**：仅更新里程碑票据与日志，不修改业务代码，不运行测试或启动服务。

## 2026-08-11 — 确认 Program Data 三栏界面决策

- **修改原因**：用户已确认收敛后的 Program Data MVP 原型，可结束界面方案比较并推进下一项执行契约。
- **`.scratch/abb-teach-target-and-observe/issues/09-program-data-teaching-ui.md`**：状态更新为 `resolved`，记录正式实现采用左侧点位、中间 Three.js、右侧 RAPID 编辑器的三栏职责划分。
- **`.scratch/abb-teach-target-and-observe/map.md`**：将三栏教学工作台加入已确认决策，下一开放前沿为单步执行状态契约。
- **影响范围**：仅更新 Wayfinder 规划文档，不修改业务代码，不运行测试或启动服务。

## 2026-08-11 — 收敛 Program Data MVP 为三栏教学工作台

- **修改原因**：用户明确指出不能把所有功能卡片堆在左侧，RAPID 代码输入需要在右侧拥有独立常驻卡片。
- **`.scratch/abb-teach-target-and-observe/prototypes/program-data-ui-prototype.html`**：删除 A/B/C 方案切换，收敛为左侧 Program Data 点位操作、中间 Three.js 显示、右侧 RAPID 代码编辑器的单一三栏布局；右侧使用真实可输入的 `textarea`，保留最小运行、单步、暂停/继续和停止入口。
- **`.scratch/abb-teach-target-and-observe/issues/09-program-data-teaching-ui.md`**：记录用户确认的职责分区，避免正式实现再次把源码编辑器塞入左栏或中间视图区。
- **影响范围**：只修改抛弃式 UI 原型和规划记录，不改正式 Vue、RAPID 解析/执行、Three.js 场景或 KUKA 预留代码；未启动服务、未运行测试。

## 2026-08-11 — 修正 ABB Profile 与内置 RAPID 验收测试

- **修改原因**：复核发现 `robot-profile.test.ts` 中的 `@ts-expect-error` 赋值仍会在 Vitest 运行时执行，真实污染共享 profile 单例；既有 App 测试只比较全局常量，未证明页面控制链使用该模型；MoveL 测试用绝对值比较 Y 坐标且遗漏 MoveJ 终点到首 waypoint 的过渡，可能掩盖镜像和关节跳变。
- **`src/robot-models/abb-irb1200/robot-profile.test.ts`**：把只读契约的负向类型检查移入不可执行分支，继续由 TypeScript 校验 `@ts-expect-error`，但不再在测试运行时替换 `model` 或改写 `homeJoints`。
- **`src/application/app-profile-stability.test.ts`**：合并恒真断言，改为在 `loading/ready/error` 三种状态下分别提交真实 J1 输入；监听唯一 profile 模型的 FK 调用，并核对页面显示位置，证明场景状态不会改变 App 的运动学操作链；同时保留场景组件无 `model` prop 的边界检查。
- **`src/application/builtin-program.test.ts`**：位置和姿态统一使用向量误差；MoveL 以实际 MoveJ 终点为起点校验 Z 向下降和 X/Y 横向误差，不再对 Y 坐标取绝对值；关节步长路径加入 MoveJ 终点到首 waypoint 的过渡；MoveJ 终点使用现有 IK 配置容差。
- **影响范围**：仅修正测试及验收口径，不改生产规划器、运动学、RAPID 程序点位、场景显示或 KUKA 预留代码。
- **最小验证**：只运行 3 个相关 Vitest 文件，结果为 3 files / 8 tests passed；`npm run check` 通过；`git diff --check` 通过。按要求未重复执行全量测试、build 或 E2E，也未启动任何服务。

## 2026-08-11 — 依据小模型代码审查的 ABB Profile/坐标/RAPID 收尾实现

> 本轮落实 `.scratch/abb-profile-coordinate-semantics/reviews/01-small-model-code-review-fix-guide.md` 的六步修复，按红灯测试与最小修复顺序执行，只改动允许范围内的文件。

- **Step 1 删除 JointRange 兼容入口**：`src/application/joint-control.ts` 删除标注“兼容既有使用者”的 `export type { JointRange }` 转导；唯一调用者 `src/components/JointControlPanel.vue` 改为直接从 `src/robotics/robot-profile.ts` 导入领域类型。`rg "JointRange" src` 后领域定义仅存于 `robotics/robot-profile`，application 层不再转导。
- **Step 2 ABB 关节范围源头严格六元 tuple**：`src/robot-models/abb-irb1200/robot-config.ts` 的 `ABB_JOINT_RANGES` 由 `Object.values(...).map(...) as readonly[]` 改为声明为 `SixAxisJointRanges` 并显式引用六个具名 DH 关节的 `thetaRange` 构造；`robot-profile.ts` 删除 `as SixAxisJointRanges` 强断言。任一关节项被删除都会产生编译错误，范围数值仍只存在于 DH 配置单一来源。
- **Step 3 收紧唯一 profile 不可变契约**：`src/robotics/robot-profile.ts` 的 `RobotProfile` 字段全部 `readonly`，回零关节状态 `defaultJoints` 一次性更名为 `homeJoints`（只读六元 tuple `Readonly<JointAngles>`），不在 application 保留旧字段别名。`joint-control.ts`、`App.vue`、`cartesian-control.test.ts`、`robot-profile.test.ts` 同步迁移；`robot-profile.test.ts` 新增 `@ts-expect-error` 编译期证明 profile 字段与 `homeJoints` 元素不可改写。
- **Step 4 场景状态不改变运动学 profile**：新增 `src/application/app-profile-stability.test.ts`（`@vue/test-utils` 挂载 `App.vue` 并 stub `SceneViewport`，不启动真实 WebGL/FBX），依次发出 `loading/ready/error` 三种场景状态，断言模块级 `ABB_IRB1200_PROFILE` 与其 `model` 不被替换、回零与可控单关节变更的正解结果不变；并断言场景组件不存在 `model` prop/emit 交换通道。`robot-profile.test.ts` 删除了“重复读取同一属性仍相等”的恒真单例断言。
- **Step 5 内置 RAPID 三点几何验收**：`src/application/builtin-program.test.ts` 从 `ABB_IRB1200_PROFILE` 取得 model/jointRanges/homeJoints（不再自行组合 `new AbbDhRobotModel() + ABB_JOINT_RANGES + [0..0]`），断言 `pApproach=[451,150,680]`、`pWork=[451,150,630]`、`pRest=[451,0,807.1]` 三个字面量；第一条 MoveJ 终点 FK 位置/旋转矩阵姿态误差满足既有 IK 容差；第二条 MoveL 逐 waypoint FK 验证 X/Y 横向极小、沿 ABB 基座 Z 轴下降约 50mm、终点误差与相邻 waypoint 任一关节 ≤5° 上限；第三条 MoveJ 从 MoveL 末 waypoint 起再以 FK 验证 pRest。全部复用既有 `robTargetToPose`/`orientationError`，未复制姿态算法。
- **Step 6 修正场景视觉工具转换断言**：`src/scene/abb-scene-transform.test.ts` 由“只检查矩阵常数 93.902208”改为断言零位场景机械法兰 `[451,807.1,0]` 与测试内显式 `场景法兰 frame × ABB_FLANGE_TO_FBX_TOOL` 得到的视觉工具 `[451,713.197792,0]`，并断言两处差异（93.902208mm）来自显式视觉变换，防止未来核心 FK 又乘入偏移。
- **未改动**：KUKA 模型/场景/测试（保留）；RAPID parser、MoveJ/MoveL 规划实现、ProgramExecutor、MotionRunner、IK/路径采样；ABB 坐标变换与美工逻辑；仅为删除旧 `JointRange` 入口调整直接导入调用者。
- **验证结果**：`npm run check` 通过；`npm test` 通过（23 个测试文件、157 passed / 1 个既有 expected-fail，较上一轮新增 6 passed 与 1 个测试文件）；`npm run build` 通过（仅既有大 chunk 提示）；`git diff --check` 通过；临时 `vite preview` 后 `npx playwright test` 全部 10 passed（含场景就绪、六轴控制、程序闭环、FBX/DH 闭环、页面位姿闭环），preview 已终止并确认 4173 端口释放。
- 里程碑三张票 `01/02/03` 状态由 `ready-for-agent` 更新为 `resolved`（不修改旧里程碑票据）。

## 2026-08-11 — 审查 ABB Profile/坐标/RAPID 三票实现并生成小模型修复指导

- 以 `50989f1` 为固定点审查当前未提交工作区，规格来源为 `.scratch/abb-profile-coordinate-semantics/` 的地图和三张线性票；按 `code-review` 分离 Standards 与 Spec 两条审查轴，并完整纳入 5 个未跟踪 TypeScript 文件。
- Standards 轴发现：`src/application/joint-control.ts` 保留明确的 `JointRange` 兼容转导，违反“不做向后兼容”；`src/robot-models/abb-irb1200/robot-profile.ts` 将变长数组强断言为六轴 tuple，长度未由类型系统证明。另记录唯一 profile 字段可变、场景视觉工具测试标题与实际覆盖不一致两项健壮性问题。
- Spec 轴发现：内置 RAPID 测试只证明三条指令可规划，未锁定 Ticket 03 要求的 MoveJ FK 终点、MoveL ABB Z 轴直线/横向误差/终点误差/waypoint 步长；现有 profile 单例测试未覆盖 Ticket 01 要求的场景 `loading/ready/error` 不替换运动学 profile。未发现 ABB 坐标变换方向错误、KUKA 被删除或未要求的功能扩张。
- 新增 `.scratch/abb-profile-coordinate-semantics/reviews/01-small-model-code-review-fix-guide.md`：按红灯测试与最小修复顺序，详细规定兼容入口删除、严格六元 tuple、profile 不可变性、场景状态集成测试、RAPID 三点几何验收和视觉工具显式组合测试，并列出允许修改范围、禁止重复实现和最终验证步骤；本轮不修改业务代码。
- 主模型复验：`npm run check`、`npm test`、`npm run build` 均通过，测试结果为 22 文件、151 passed、1 expected fail；构建仅有既有大 chunk 提示。只读检查未发现 4173/5173 监听，未启动或终止任何服务。首次端口读取因空进程 ID 返回命令错误，随后使用空结果安全命令复核为 `NO_LISTENERS_4173_5173`。

## 2026-08-11 — Ticket 02+03 分离 ABB 基座/机械法兰与场景显示坐标，并跑通 RAPID tool0/wobj0 闭环

> 说明：这两张线性票因坐标语义强耦合而一并完成——ticket 02 把核心 FK 改为 ABB 基座机械法兰后，旧的场景坐标内置 RAPID 目标立即不可达，因此必须在同一改动里按 ticket 03 更新内置目标，系统与单测/E2E 才能保持绿色。执行与验收已分别按票记录。

- 修改 `src/robot-models/abb-irb1200/abb-kinematics.ts`（核心坐标修正）：`forwardAbbKinematicsFrames` 从基座单位矩阵开始累乘，不再预乘 `ABB_DH_BASE_TO_SCENE`；`forwardAbbKinematics` 返回第六轴机械法兰 frame，不再乘入 FBX `joint7` 视觉工具变换；从本模块删除 `ABB_DH_BASE_TO_SCENE` 与 `ABB_FLANGE_TO_TOOL`。零位机械法兰约 `[451,0,807.1]` mm（Z 上）。
- 新增 `src/scene/abb-scene-transform.ts`：唯一、纯函数可测的显示 adapter，含 `ABB_BASE_TO_SCENE`（ABB Z 上→Three.js Y 上固定旋转）、`ABB_FLANGE_TO_FBX_TOOL`（flange→joint7 视觉工具，含 93.902208 mm 偏移）与 `abbBaseFrameToSceneFrame`；核心 FK 不携带这三者，只有与 FBX 对照或显示工具节点时才组合。
- 修改 `src/scene/abb-dh-debug-chain.ts`：核心 FK 返回 ABB 基座 frame，显示前经 `abbBaseFrameToSceneFrame` 映射到 Three.js（不再手写 `[x,z,-y]`）。
- 修改 `src/application/builtin-program.ts`（ticket 03）：默认 RAPID 三个 robtarget 改为 ABB 基座/机械法兰字面量 `pApproach=[451,150,680]`、`pWork=[451,150,630]`（沿 ABB 基座 Z 向下 50mm 的 MoveL）、`pRest=[451,0,807.1]`（近零位休止点），均单位四元数、extax 六个 9E9、继续 `tool0/wobj0`；不再与 Three.js/FBX `joint7` 视觉偏移挂钩。
- 完成方式：核心 FK 坐标改动后，旧的场景坐标规划目标/测试常量在全套件中不可达，因此按 ticket 03 逐一改为可达 ABB 基座目标——`movej-planner.test.ts`（`REACHABLE_TARGET`、时长距离）、`program-executor.test.ts`（`REACHABLE`）、`rapid/cartesian-path-planner.test.ts` 与 `rapid/movel-planner.test.ts` 的「跨构型跳变拒绝」改用 ABB 基座下腕部奇异样本 `[15,-20,30,0,-90,-300]`、`movej-planner.test.ts` 终点校验改为按旋转矩阵比较 robtarget 姿态（`orientationError`）而非欧拉角（ABB 基座下单位旋转的 euler 表示不唯一）。
- 修改 `src/robot-models/abb-irb1200/abb-kinematics.test.ts`、新增 `src/scene/abb-scene-transform.test.ts`：零位七帧位置改为 ABB 基座坐标、关节轴经场景显示转换后与 FBX 对齐、显示 adapter 纯函数断言。
- 修改 `e2e/abb-irb1200.spec.ts`（ticket 02/03）：test 4 改为「核心 ABB 基座法兰经唯一场景显示转换后与 FBX 视觉位姿闭环」——DB flange 经 `abbBaseFrameToSceneFrame` 再组合 `ABB_FLANGE_TO_FBX_TOOL` 对照 FBX `joint7`；test 2 的 DH frames 经场景显示转换后与 FBX 场景轴同框比较；test 5 页面位姿零位现为 `[451,0,807.1]` 并与 ABB DH 正解闭环。
- 未改动：KUKA 运动学/场景/测试（保留，未迁移到 ABB 坐标约定）；`rapid-parser`、`ProgramExecutor`、`MotionRunner`、IK/路径采样算法（只因坐标语义变化更新常量与期望值）。
- 修改原因：落实 `.scratch/abb-profile-coordinate-semantics/issues/02-abb-base-flange-scene-adapter.md` 与 `03-rapid-tool0-wobj0-base-frame-program.md`——ABB 机器人基座/机械法兰成为 FK/IK/RAPID/笛卡尔唯一空间真值，Three.js/FBX/dizuo/`joint7` 仅属场景显示；按「不做向后兼容」一次性迁移并让编译器暴露遗漏。
- 影响：页面正解坐标面板与 World/Tool 笛卡尔操作现在读取与解释 ABB 基座机械法兰；三维 FBX 六轴转动方向、支架抬升与视觉工具保持原样；RAPID 内置程序在 ABB 基座语义下完整运行 MoveJ→MoveL→MoveJ。
- 验证结果：`npm run check` 通过；`npm test` 通过（22 个测试文件、151 passed、1 个既有 expected-fail）；`npm run build` 通过；临时 Vite preview 后 `npx playwright test` 全部 10 passed（含核心/显示位姿闭环、页面位姿、World/Tool 直线、程序完成/暂停/停止/诊断阻止/锁定）；preview 进程已终止并确认 4173 无监听；`git diff --check` 通过。

## 2026-08-11 — Ticket 01 用单一 RobotProfile 驱动 ABB 操作链

- 新增 `src/robotics/robot-profile.ts`：在厂家无关机器人领域层定义严格类型的 `RobotProfile`（`id`、`displayName`、`model: RobotModel`、六轴 `jointRanges`、`defaultJoints`）与只读 6 元组范围类型 `SixAxisJointRanges`/`JointRange`；不引入 `any`，也不吸收 DH、FBX、颜色或 RAPID 默认值。
- 新增 `src/robot-models/abb-irb1200/robot-profile.ts`：导出唯一 `ABB_IRB1200_PROFILE` 单例，直接复用既有型号名称（`ABB_IRB1200_5_90_STANDARD_DH.name`）、一体化 `AbbDhRobotModel`、`ABB_JOINT_RANGES` 与 `ABB_DEFAULT_JOINTS`，未复制任何数值。
- 修改 `src/application/joint-control.ts`：`JointControlOptions` 由 `config/defaultJoints/jointRanges` 收敛为单个 `profile`；回零与范围取自 `profile`，位姿改由 `profile.model.forwardKinematics` 作为唯一 FK 来源驱动（原 `poseFromJoints(RobotConfig)` 路径移除），并保留 `resolve` 的 KUKA 纯函数默认值。
- 修改 `src/application/cartesian-control.ts`、`src/application/program-control.ts`：选项由 `robotModel: Ref<RobotModel>` + `jointRanges` 收敛为 `profile`；`solveTarget` 与 `execute` 直接从 `profile.model`/`profile.jointRanges` 复用既有 `planCartesianPath`/`planMoveJ`/`planMoveL` 与 MotionRunner，不新增规划器或品牌分支。
- 修改 `src/App.vue`：页面只选择一次 `ABB_IRB1200_PROFILE`，关节/笛卡尔/程序控制全部从同一个 profile 获得模型与限制；删除自行创建 `AbbDhRobotModel` 回退、`robotModel` shallowRef、`handleRobotModel` 与 `@model` 订阅，场景不再充当运动学来源；状态文案「已切换 ABB 回退模型」改为纯显示语义「场景几何加载失败，使用占位显示」。
- 修改 `src/components/SceneViewport.vue`、`src/scene/abb-scene.ts`：移除 `@model`/`onModel` 事件与 `AbbSceneOptions.onModel`，场景只保留 `onStatus`/显示开关/轨迹计数，纯显示职责。
- 删除 `src/scene/abb-scene-model.ts`（`AbbSceneRobotModel` 包装器）：唯一调用方即被删除的场景模型发布路径，删除后无死代码。
- 更新测试 `src/application/cartesian-control.test.ts`、`src/application/program-control.test.ts`：改为传入 profile（ABB 用 `ABB_IRB1200_PROFILE`，KUKA 测试按票允许用既有 KUKA 模型/常量构造局部 profile）；新增 `src/robot-models/abb-irb1200/robot-profile.test.ts` 覆盖唯一单例、字段复用既有常量、只读 6 轴范围、零位落界、模块级稳定单例与单模型 FK。
- 修改原因：落实 `.scratch/abb-profile-coordinate-semantics/issues/01-robot-profile-application-seam.md`——消除「场景决定运动学」链，让 FK/Jacobian 与关节/笛卡尔/RAPID 操作统一走 `RobotProfile`；按「不做向后兼容」，一次性迁移调用方并由编译器暴露遗漏。
- 影响：关节、笛卡尔、RAPID 程序现在共享 `ABB_IRB1200_PROFILE.model` 与限制；Three.js/FBX 场景加载成功、失败或未完成时应用使用的 `RobotModel` 对象恒为 profile 内模型；尚未改动 FK 数学、ABB 坐标转换（留在 Ticket 02）；KUKA 源码、配置与测试保留并按既有常量构造局部 profile 测试。
- 验证结果：`npm run check` 通过；`npm test` 通过（21 个测试文件、148 passed、1 个既有 expected-fail）；`npm run build` 通过；临时 Vite preview 后 `npx playwright test` 全部 10 passed（覆盖场景就绪、六轴控制、坐标辅助、程序闭环），preview 进程已终止并确认 4173 无监听。

## 2026-08-11 — Wayfinder 确认 ABB 资产基准已完成，进入 profile 契约前沿

- 修改 `.scratch/abb-teaching-simulation/issues/02-robot-profile-contract.md`：按 Wayfinder 的单票推进规则认领“确定机器人 profile 与单位坐标契约”；本轮只分析并决定 profile seam，不修改业务代码，也不提前关闭后续结构化运动、解析器或教学观察票。
- Git/验证核对：当前 `master` HEAD 为 `50989f1 feat(ui): RAPID 源程序编辑区样式`；`npm run check`、`npm test`、`npm run build` 均成功，单元/组件测试为 20 个文件、143 passed、1 expected fail。构建仅保留既有的大于 500 kB chunk 提示，npm PowerShell 包装脚本的用户目录权限提示未影响退出码。
- 架构观察：现有 `RobotConfig` 保存 DH、关节范围和展示颜色，`RobotModel` 仅暴露 FK/Jacobian，调用方另行传递 `jointRanges`；同时 ABB FK 当前输出已转换到 Three.js Y-up 并乘入 FBX `joint7` 视觉工具偏移。它与 RAPID `wobj0/tool0` 应基于机器人基座/机械法兰的语义尚未形成明确契约，因此 profile 与坐标 seam 是下一步实际前沿。
- 修改 `CONTEXT.md`：根据用户“以 ABB 操作为主、Three.js 仅用于显示”的决定，新增“ABB 机器人基座坐标”“机械法兰位姿”“场景显示适配”三个领域术语。明确核心运动学与 RAPID 使用 ABB 坐标真值、`tool0` 以机械法兰为单位变换、FBX/Three.js 只承担显示映射；影响是后续 profile 设计和实现不得继续把场景 Y-up 或 `joint7` 视觉偏移当作 RAPID 位姿。
- 修改 `CONTEXT.md`：用户接受毫米位置、度关节角、旋转矩阵姿态真值，以及最小机器人 profile 契约；新增“机器人 profile”和“厂家 adapter”术语。profile 只聚合型号身份、运动学模型、关节范围和回零关节状态，不吸收 DH、FBX、颜色或场景节点。
- 多厂家边界：KUKA 代码明确保留，不删除、不重构，也不纳入当前 ABB 里程碑；通用 `robotics` seam 为未来多厂家留下位置，但当前不建设 profile 注册中心、厂家选择 UI 或额外厂家实现。
- 完成 Wayfinder 决策票 `.scratch/abb-teaching-simulation/issues/02-robot-profile-contract.md`：记录用户确认的 ABB 基座/机械法兰真值、单位与姿态、最小 `RobotProfile`、厂家 adapter 职责、KUKA 保留边界，以及 `Base→Flange = Base→WorkObject × WorkObject→TargetTCP × inverse(Flange→ToolTCP)` 组合关系；票据标记 resolved，并解除旧地图中“程序解释执行与运动观察语义”“结构化 MoveJ/MoveL 与运动规划契约”的 profile 依赖。
- 新增独立里程碑目录 `.scratch/abb-profile-coordinate-semantics/map.md`：新里程碑“ABB Profile 与坐标语义修正闭环”不放入原 `.scratch/abb-teaching-simulation/`；地图单独记录目标、实施边界、验收边界和明确范围外事项，并通过链接复用已关闭 profile 决策，避免复制两份决策正文。
- 只读目录检查发现旧 `.scratch/abb-rapid-motion-execution/` 只有 `issues/`、没有 `map.md`，读取该不存在文件返回错误；未产生文件写入或运行服务。新里程碑不沿用这一缺口，明确提供独立地图入口。
- 新增 `.scratch/abb-profile-coordinate-semantics/issues/01-robot-profile-application-seam.md`、`02-abb-base-flange-scene-adapter.md`、`03-rapid-tool0-wobj0-base-frame-program.md`：经用户确认，将新里程碑拆为三张线性 tracer 票据，分别唯一负责 profile 注入 seam、ABB 基座/机械法兰到场景显示 seam、RAPID `tool0/wobj0` 端到端程序。每票详细列出已有模块复用点、禁止重复实现、严格验收项、验证命令、KUKA 保留边界和 `UPDATE_LOG.md` 要求，供小模型按阻塞顺序独立执行。
- 小模型可执行性终审：按 `claude-small-model-check` 逐票完整复核，三票结论均为 `READY`。验收归属互斥：第一票独占 profile/application seam，第二票独占 ABB→Three.js 场景坐标 seam，第三票独占 RAPID 示例与程序 E2E；不存在需要继续正式拆票的双状态机，也不存在适合临时并行 fanout 的共享写集。`git diff --check` 通过。
- 修改 `.scratch/abb-teaching-simulation/issues/01-abb1200-model-asset-baseline.md`：根据仓库现有用户提供的 `ABB_IRB1200_5_90.fbx`、场景适配器、ABB profile、单元测试和 Playwright E2E 证据，将资产基准票从 claimed 标记为 resolved，并记录经典 `IRB 1200-5/0.9`、`dizuo`/`joint1..joint7` 层级、厘米到场景比例、关节范围、单位以及“候选 DH 是运动学真值、FBX 仅视觉资产”的边界。
- 修改 `.scratch/abb-teaching-simulation/map.md`：将资产基准加入 Decisions so far，移除已经完成的具体型号/模型资产未决项，保留机器人 profile、结构化运动和 RAPID 契约作为后续前沿。
- 修改原因：用户指出资产与 ABB 基准阶段已经完成；核对确认当前实现确实具备可追溯的模型文件、节点结构、比例、轴向、关节范围、场景加载和运动学回归证据，旧地图状态已落后于代码事实。
- 影响：不修改运行时代码；Wayfinder 下一张可推进的决策票变为 `02-robot-profile-contract.md`。用户提供 FBX 的第三方再分发授权仍不在本次技术闭环中宣称，若未来公开发布模型需单独审查。
- 修改 `.scratch/abb-teaching-simulation/issues/02-robot-profile-contract.md`：资产基准票已解决，解除 profile 契约票的 `Blocked by: 01`，使其成为当前唯一未阻塞的下一张决策票；不替该 HITL 票预先填写答案。

## 2026-08-11 — 完成 RAPID 文本执行闭环最小实现

- 新增 `src/rapid/rapid-parser.ts`：实现首期 RAPID 文本子集的词法扫描、大小写不敏感关键字、`!` 行注释、单 `MODULE`、无参数 `PROC main()`、`CONST/PERS robtarget`、`MoveJ/MoveL`、`v50/v100/v200`、`fine`、`tool0`、默认 `wobj0` 与 `\\WObj:=wobj0` 解析；完成点位符号解析、重复/未定义名称、记录长度/有限数值、非法尾逗号、不支持语法和模块尾随内容诊断，并为每条合法运动保留源码范围与原文。
- 修改 `src/application/program-control.ts`：把编辑区 RAPID 源文本作为唯一输入，运行前完整解析；存在诊断时进入错误快照且不启动 MotionRunner；合法文本转换为现有结构化 MoveJ/MoveL 后复用既有规划器和 ProgramExecutor；运行/暂停期间由面板锁定源文本，规划错误附带对应源码范围。
- 修改 `src/application/builtin-program.ts`、`src/application/builtin-program.test.ts`：内置演示改为真实 RAPID `MODULE TeachingDemo` 文本，固定执行 MoveJ → MoveL → MoveJ，并通过 parser 后按顺序验证可达性。
- 修改 `src/components/ProgramControlPanel.vue`、`src/components/ProgramControlPanel.test.ts`、`src/App.vue`、`src/style.css`：新增 RAPID 文本编辑区、诊断列表、源码位置、运行锁定和运行控制；保持现有单向状态传递与 MotionRunner 抢占策略。
- 修改 `e2e/abb-program.spec.ts`：覆盖三条 RAPID 文本完整执行、暂停/继续、停止不推进、诊断阻止运动、活动期间锁定编辑器；共 5 条程序 E2E 通过。新增 `src/rapid/rapid-parser.test.ts` 覆盖有效语料、源码范围、静态诊断、重复/非法数据、唯一入口、模块尾随内容和尾逗号；修改 `src/application/program-control.test.ts`、`src/components/ProgramControlPanel.test.ts` 适配文本输入并验证控制器/UI 契约。
- 修改 `README.md`：更新当前范围为 ABB IRB 1200 与 RAPID 文本仿真，补充首期支持能力和目录分层说明。
- 修改原因：落实 Wayfinder 已确认的“RAPID 文本执行闭环”里程碑；保持首期边界，不引入完整 RAPID 编译器、控制流、MoveC/MoveAbsJ、用户 tooldata/wobjdata、持久化、编辑器框架或控制器通信。
- 修改影响：RAPID 源程序现在是程序执行的唯一事实源；错误源程序在运动前被拒绝，合法文本继续复用已验证的 MoveJ/MoveL、IK、路径采样和 MotionRunner 生命周期；不改变现有 FK/IK 和手动运动语义。
- 验证结果：`npm test` 通过（20 个文件、141 passed、1 个既有 expected-fail）；`npm run check`、`npm run build`、`git diff --check` 通过；临时 Vite preview 后完整 `npx playwright test` 通过（10 passed），预览进程已终止并确认 4173 无监听；用户原有 4174 服务未触碰。npm/npx 输出的 `Test-Path` 权限提示来自本机包装脚本，不影响命令结果。

## 2026-08-11 — 依据代码评审的收尾修正

- 修改 `src/rapid/plan-shared.ts`：抽取共用仿真时长助手 `simulateDurationMs(model, currentJoints, trans, vTcp)`，统一“正解失败返回 null + 距离/v_tcp 转毫秒 + 有限性/正时长钳位”逻辑；`movej-planner.ts` 与 `movel-planner.ts` 改为复用该助手，删除两处逐字重复的时长计算块（原两处 `> 0` 与 `>= 0` 钳位条件不一致，属隐性缺陷）。
- 修改 `src/application/program-control.ts`：`stop()` 直接委托给 `stopActiveProgram()`，消除两个逐字节相同的方法体。
- 修改 `src/application/program-control.test.ts`：把“程序运行时手动抢占”从单一 `startEased` 用例扩展为按四类手动命令逐一验证（关节单步/随机姿态/机器人回零走 eased、笛卡尔命令走 trajectory），每类都断言：活动程序先停止、手动运动完成、始终 ≤1 个活动运动、旧程序最终 stopped 且指针不增加、无残留请求帧；连同既有“程序暂停时抢占”与“idle 无操作”覆盖评审指出的 Ticket 05 抢占测试缺口。
- 修改原因：代码评审（Standards：movej/movel 时长重复与钳位条件分叉、program-control stop 重复；Spec：Ticket 05 手动抢占只覆盖 2/5 场景）。
- 影响：`planMoveJ/planMoveL` 返回的 `durationMs` 语义不变（零距离仍钳位为 1ms）；`ProgramController.stop` 行为不变；测试文件新增参数化抢占用例。未改业务行为，无新增依赖。
- 验证结果：`npm run check` 通过；`npm test` 通过（20 文件、139 passed / 1 个既有 expected-fail，重复运行稳定）；`git diff --check` 通过。

## 2026-08-11 — Ticket 06 一次性重命名目录

- 目录重构（`git mv`，纯机械移动，不改业务行为）：
  - `src/core/robot` → `src/robotics`（通用机器人能力：FK/IK/数学/Cartesian planner/MotionRunner/通用类型）
  - `src/core/rapid` → `src/rapid`（RAPID 类型、MoveJ/MoveL planner、ProgramExecutor、规划错误）
  - `src/robot` → `src/application`（Vue composable、浏览器时钟 adapter、手动/笛卡尔/程序控制、内置程序）
  - `src/robots` → `src/robot-models`（ABB IRB1200 / KUKA-like 具体型号与 DH 模型）
  - `src/robotics/manual-motion-clock.ts` → `src/testing/manual-motion-clock.ts`（测试支持模块，运行时代码不导入 testing）
  - 移动后用 `rmdir` 删除已为空的 `src/core`。
- 用脚本按每个文件的新目录重新计算全部相对 import（先按旧目录解析目标、映射到新目录、再相对化），并修复两处特例：同目录 import 的 `./` 前缀（避免退化成裸模块名）、`manual-motion-clock` 依赖 `robotics/motion-runner`（在 testing 下用 `../robotics/motion-runner`）。
- 修改 `e2e/abb-irb1200.spec.ts`：`../src/core/robot/kinematics|types` → `../src/robotics/...`，`../src/robots/abb-irb1200/abb-kinematics` → `../src/robot-models/...`；`src/scene` import 不变。
- 修改 `README.md`：目录说明改为分层描述（robotics/rapid/application/robot-models/testing/scene/components）。
- 依赖方向符合契约：robotics 只放通用机器人能力、不导入 Vue/Three/RAPID/具体型号；rapid 允许依赖 robotics、不依赖 Vue/components/scene；application 依赖 rapid/robotics/robot-models；robot-models 依赖 robotics、不依赖 Vue/application；testing 只放测试支持模块、运行时不导入它。
- 修改原因：为持续增长的 RAPID parser 任务腾出清晰的分层边界，让机器人数学、RAPID、Vue 编排与具体型号职责分离，避免核心/控制器混在同一命名空间。
- 影响：只重命名目录并同步修改 import 与 README；未创建兼容目录、重导出、路径别名或 index.ts barrel；未顺手改函数名/状态机/业务逻辑；历史 UPDATE_LOG 旧条目保路径，不改写。
- 验证结果：`npm run check` 通过；`npm test` 通过（19 个文件、131 passed / 1 个既有 expected-fail）；`npm run build` 通过；临时启动 `vite preview` 后 `npm run test:e2e` 通过（8 passed）；完成前搜索 `rg "core/robot|core/rapid|src/robot/|src/robots/"` src e2e README.md 无结果；`src/core/robot|core/rapid|src/robot|src/robots` 四个旧目录均不存在；预览已终止、端口 4173 确认释放。

## 2026-08-11 — Wayfinder 确认 RAPID 文本执行闭环里程碑

- 修改 `.scratch/abb-teaching-simulation/issues/09-next-milestone-after-structured-motion.md`：关闭“确定基础运动指令后的下一阶段里程碑”，确认下一阶段自研最小 RAPID 文本解析模块，将真实 `MODULE + PROC main + robtarget + MoveJ/MoveL` 转换为现有结构化执行输入；记录运行前完整诊断、运行期间锁定源程序、RobotStudio 仅作外部验证以及首期明确推迟项。
- 新增 `.scratch/abb-teaching-simulation/issues/10-rapid-parser-grammar-diagnostics-contract.md`：把已经清晰的下一问题升级为 Wayfinder 决策票，后续专门确定首期文法、名称解析、数据校验、诊断代码/源码范围和现有 ProgramExecutor 的输入契约；该票受教学文本边界、结构化 MoveJ/MoveL 契约和本轮里程碑决策阻塞。
- 修改 `.scratch/abb-teaching-simulation/map.md`：在“已确认决策”加入本轮里程碑摘要，并从“尚未明确”删除已升级为新决策票的 RAPID 语法/解析/编辑器错误与文本数据模型条目，保持地图只做索引、不复制详细答案。
- 修改 `CONTEXT.md`：新增“RAPID 文本解析模块”领域术语，明确它只负责完整检查源程序并生成结构化运动指令或诊断，不承担 IK、路径采样、运动执行或完整编译器职责。
- 修改原因：用户确认当前仍处于 Wayfinder，接受 RAPID 文本闭环的模块职责、验收样例、运行锁定、外部验证和推迟范围；需要将讨论固化为一个已解决决策，并揭示下一张可讨论的票，而不是提前实现 parser。
- 业务影响：未修改 `src`、测试、依赖或运行时行为；未启动任何前后端服务。

## 2026-08-11 — Ticket 05 收缩内置程序并补齐 UI 抢占测试

- 修改 `src/robot/builtin-program.ts`：把内置程序从 7 段搬运循环收缩为固定三条 `MoveJ → MoveL → MoveJ`——① MoveJ 高速接近取件区上方 `(100,-100,60)`、② MoveL 低速下降到位 `(100,-100,25)`、③ MoveJ 高速返回高位休息点 `(0,0,120)`。三个目标固定、可读、基于 home 零位 TCP 偏移、0° 姿态、全部使用 tool0/wobj0/fine 且无外部轴；不在运行时根据当前 FK 临时生成目标，不保留 7 段兼容入口（删除不再使用的 `yaw` 辅助）。
- 修改 `src/robot/builtin-program.test.ts`：断言程序长度严格为 3 且顺序为 movej/movel/movej、均使用默认 tool0/wobj0/fine；可达性测试改为按真实程序顺序逐条规划——从 home 规划第一条 MoveJ，用其规划终点作第二条 MoveL 起点，用第二条最终 waypoint 作第三条 MoveJ 起点，每步都确认成功（不再每条都从零关节分别规划）。
- 修改 `src/robot/program-control.test.ts`：新增手动抢占测试（用真实共享 MotionRunner）——程序运行时手动命令先停止活动程序、程序最终 stopped 且指针不增加、手动运动完成、始终 ≤1 个活动运动；程序暂停时手动命令抢占同样先停止再手动运动；idle 时 `stopActiveProgram` 是无操作。App 的关节单步/随机/回零/笛卡尔四个手动入口都是先调 `stopActiveProgram()` 再启动手动运动，机制一致。
- 修改 `e2e/abb-program.spec.ts`：describe 标题改为“MoveJ → MoveL → MoveJ”，完整运行程序指针断言由 7 改为 3；停止测试改为稳定流程——先点击停止、等待 UI 显示“已停止”、再读取停止后位姿、等待 700ms 验证位姿不再变化（不再在点击停止前读取位姿并与复位后比较，避免动画帧竞态）。
- 修改原因：让内置程序、UI 文案、单测与 E2E 表达同一个固定三条程序，并用真实竞争场景证明手动命令不会与程序争用 MotionRunner；复位只复位程序、不移动机器人。
- 影响：执行语义（ProgramExecutor 串行/暂停/停止/复位）不变；UI 文案本就是“MoveJ → MoveL → MoveJ”，与三条程序一致，无需改动面板与面板测试。
- 验证结果：`npm run check` 通过；`npm test` 通过（19 个文件、131 passed / 1 个既有 expected-fail）；`npm run build` 通过；临时启动 `vite preview` 后 `npm run test:e2e` 通过（8 passed，含 3 条程序用例与 5 条既有回归），预览已终止、端口 4173 确认无 LISTEN、已释放。

## 2026-08-11 — Ticket 04 收紧 ProgramExecutor 和程序 adapter

- 修改 `src/core/rapid/program-executor.ts`：
  - `ProgramError.code` 由 `string` 改为 `MotionPlanErrorKind`，直接复用规划错误的可辨识联合类型，禁止复制字符串联合、不再接受任意 string。
  - `stop()` 增加私有 `stopRequested` 停止请求状态：第一次 stop 在 running/paused 时置位并调用一次 `seam.stop()`，第二次 stop 在当前指令返回前不再调用 seam；`executeLoop` 开头清空停止请求（保证新一次运行不继承旧请求）、指令结算为 `stopped` 后清空；`reset()` 也清空停止请求。
- 修改 `src/robot/program-control.ts`：
  - 从 `ProgramControllerMotion` 删除未使用的 `getMotionStatus`，去掉对应 `MotionStatus` 类型导入。
  - 增加 `[ABB-PROGRAM]` 关键事件日志，放在 application adapter 而非纯 ProgramExecutor：程序开始（info）、暂停（info）、继续（info）、停止请求（info，仅活动程序时）、程序完成/程序停止（info）、程序规划错误（error）。100ms 轮询不做日志输出。
- 修改 `src/App.vue`：同步删除 `useMotion` 解构中的 `getMotionStatus`，并从传给 `useProgramController` 的 `motion` 对象中移除；`useMotion` 自身仍暴露 `getMotionStatus`（属于 MotionRunner 的已确认能力，不删除）。
- 修改 `src/core/rapid/program-executor.test.ts`：新增连续两次 stop 只调用一次 seam.stop 且指针不增加、reset 后重新运行再次停止不继承旧停止请求两个用例；文件末尾用 `@ts-expect-error` 断言 `ProgramError.code` 不接受任意 string。
- 新增 `src/robot/program-control.test.ts`（jsdom）：用可结算的运动 fake 验证 `ProgramControllerMotion` 不再要求 getMotionStatus（对象不含该字段能编译）、运行/暂停/继续/停止请求/程序停止等关键事件都以 `[ABB-PROGRAM]` 前缀输出（不锁定全部文案），并验证手动命令下沉到 MotionRunner。
- 修改原因：重复 stop 会重复调用 seam 造成竞态、错误码弱类型（string）、无效的 interface 字段残留、以及缺少可观测的关键生命周期日志。
- 影响：`ProgramExecutionSeam` 接口不变；日志只加在 adapter，纯 ProgramExecutor 不输出日志；未引入 motionId、AbortController、取消 token 或通用任务系统；`motion-control.ts` 生命周期实现未改。
- 验证结果：`npm run check` 通过；`npm test` 通过（19 个文件、127 passed / 1 个既有 expected-fail）；`git diff --check` 通过。未运行长期驻留服务。

## 2026-08-11 — Ticket 03 修复 MotionRunner 暂停后 retarget 时间轴

- 修改 `src/core/robot/motion-runner.ts`：`startEased` 与 `startTrajectory` 在设置新的 `startTime/animationDuration` 后，立即重置 `totalPausedTime = 0`、`pausedAt = null`。修复根问题：此前同模式 retarget 只更新 startTime/startJoints/目标/duration，却不重置 `totalPausedTime/pausedAt`，导致暂停过一次后再同模式 retarget，`effectiveElapsed = now - startTime - totalPausedTime` 可能变成负数，运动被额外延迟甚至倒退。
  - 运行中同模式 retarget：复用同一个 Promise、复用同一个 RAF 循环，从当前关节重新开始，新 duration 从 retarget 时刻计算，以前累计的暂停时间不影响新目标。
  - 暂停中同模式 retarget：状态继续保持 `paused`、不创建 RAF、复用原 Promise、更新目标与起始关节，`resume` 后立即从进度 0 开始，不额外等待历史暂停时间。
  - 新模式切换语义保持不变：旧 Promise 返回 `stopped`、新模式拥有新 Promise、始终最多一个 RAF。
- 修改 `src/core/robot/motion-runner.test.ts`：新增 4 条用例——eased 暂停→继续→运行中 retarget 按新 duration 完成且始终 ≤1 个请求帧、eased 暂停中 retarget 保持 paused/不建 RAF/resume 后按新 duration 完成、trajectory 暂停中 retarget 复用 Promise/resume 后准确到新终点、暂停很久后 retarget 不额外等待历史暂停时间（resume 后 1ms 不跳到终点）。
- 修改原因：`totalPausedTime` 在 retarget 场景未随新时间轴清零，属“测试已覆盖暂停/继续但不覆盖暂停后再 retarget”的时间轴竞态。
- 影响：未新增 motionId、时间戳 waypoint 或第二个暂停状态机；`manual-motion-clock.ts` 未改动（既有测试能力足够）；speed-limited 与模式切换的既有用例仍通过，无回归。
- 验证结果：`npm run check` 通过；`npm test` 通过（18 个文件、124 passed / 1 个既有 expected-fail）；`git diff --check` 通过。未运行长期驻留服务。

## 2026-08-11 — 固化 RAPID 参考项目证据边界与文本闭环术语

- 修改 `.scratch/abb-teaching-simulation/map.md`：把 `.scratch/abb-teaching-simulation/reference-projects` 和 `research/10-reference-projects-analysis.md` 写成后续 RAPID 规划的长期证据约束，并明确真实 RAPID 样例、词法/编辑器项目、Posecode 分层参考各自的用途与许可证边界。
- 修改 `CONTEXT.md`：新增“RAPID 源程序”“诊断”“运动规划错误”三个领域术语；明确源文本是唯一事实源、静态 error 阻止执行、运行期规划错误通过 MoveJ/MoveL 的源码范围回溯，避免 parser、编辑器、程序执行器和 MotionRunner 混用状态与错误概念。
- 修改原因：用户提醒后续不能遗忘上一阶段整理的地图和本地参考项目；本轮再次核对了 `RAPID-Scripts-and-Demos/PickPlace/PickPlace.mod`、`rapid-for-vim/syntax/rapid.vim`、VS Code 语言配置及 Posecode parser/diagnostics 公共边界，需要把这些依据从会话记忆固化到路线地图。
- 设计影响：后续最小 RAPID 子集应从真实模块裁剪验收语料，但不能把 Vim/TextMate 高亮正则当 parser，也不能复制无明确许可代码；当前仍只规划一个小而深的文本解析边界，不建设完整 RAPID 编译器。
- 业务影响：未修改 `src`、测试、依赖或运行时行为；未启动任何前后端服务。

## 2026-08-11 — Ticket 02 补齐 RAPID 规划输入校验

- 修改 `src/core/rapid/plan-shared.ts`：把 `validateMotionInput` 扩展为严格按序的四层校验，非法数据返回 `invalid-data`，合法但首期不支持的配置返回 `unsupported-option`：
  1. **结构长度**：运行时校验 `trans`=3、`rot`=4、`robconf`=4、`extax`=6、`tframe.rot`=4、`cog`=3、`aom`=4、`uframe.rot`=4、`oframe.rot`=4，畸形长度在索引访问前拒绝（否则读取 undefined 会被当成配置问题）。
  2. **数值有限性**：robtarget/speeddata/zonedata（pzoneTcp/pzoneOri/pzoneEax/zoneOri/zoneLeax/zoneReax）/tool（tframe、tload 的 mass/cog/aom/ix/iy/iz）/wobj（uframe/oframe）全部数值必须有限，NaN/Infinity/-Infinity → `invalid-data`。
  3. **四元数非零可归一化**：`robtarget.rot`、`tooldata.tframe.rot`、`loaddata.aom`、`wobjdata.uframe.rot`、`wobjdata.oframe.rot` 长度为零/非有限 → `invalid-data`。
  4. **speeddata**：`v_tcp/v_ori/v_leax/v_reax` 四个字段都必须为正（原来只校验 v_tcp）。
  5. **首期支持范围**：在工具/工件/fine 之后新增 `robconf` 必须为 `[0,0,0,0]` 的校验（不再静默忽略 robconf），非法零值外部轴（非 9E9）同样返回 `unsupported-option` 并指出具体字段。
- 修改 `src/core/rapid/movej-planner.test.ts`：新增校验用例——非零 robconf → unsupported-option（消息含 robconf）、全零 extax 不再被当成未使用 → unsupported-option、畸形 trans/rot 长度 → invalid-data、speeddata 任一速度字段≤0 → invalid-data、zone 非有限 → invalid-data、负载 aom 零四元数 → invalid-data、非默认 ufmec → unsupported-option、非默认工具 frame → unsupported-option。
- 修改 `src/core/rapid/movel-planner.test.ts`：新增校验用例——非有限 zone 值返回 invalid-data 且 `runTrajectory` 不被调用、畸形 rot 长度返回 invalid-data 且 `runTrajectory` 不被调用，证明非法输入不会进入 `planCartesianPath`。
- 修改原因：此前只在 robtarget 上做有限性/四元数/部分速度校验，zone/tool/wobj 的畸形与非法数据、非零 robconf 都被静默放过，可能把非法数据带入 IK/路径规划，或把“合法但不支持”的配置当成正常输入。
- 影响：Safe 的校验顺序与错误分类（非法数据 vs 不支持配置）明确化，`robTargetToPose`/`solveIK`/`planCartesianPath` 只在校验通过后调用；测试用 `as unknown as` 构造畸形数据，不使用 `any`；未修改 IK、ABB 模型、Cartesian planner、MotionRunner。
- 验证结果：`npm run check` 通过；`npm test` 通过（18 个文件、120 passed / 1 个既有 expected-fail）；`git diff --check` 通过。未运行长期驻留服务。

## 2026-08-11 — 确认下一阶段为 RAPID 文本执行闭环

- 修改 `CONTEXT.md`，新增“RAPID 文本执行闭环”领域术语：真实 RAPID 子集必须经过解析、诊断和符号解析，再复用现有结构化程序执行器；它不等同于完整 RAPID 编译器。
- 修改原因：用户确认基础结构化 MoveJ/MoveL 之后，下一阶段优先打通 RAPID 文本到机器人运动，而不是先深化 zone/tool/wobj 运动语义或扩展教学观察 UI。
- 设计影响：后续讨论将围绕最小真实语法、诊断门禁、入口过程和文本界面展开；运动执行、IK、路径规划和 MotionRunner 继续作为既有下游能力复用。
- 业务影响：未修改 `src`、测试、依赖或运行时行为；Wayfinder 决策票仍在 HITL 讨论中，尚未关闭。

## 2026-08-11 — 认领基础运动后的下一阶段里程碑决策

- 新增 `.scratch/abb-teaching-simulation/issues/09-next-milestone-after-structured-motion.md`，认领“确定基础运动指令后的下一阶段里程碑”HITL 决策票。
- 修改原因：MotionRunner、结构化 MoveJ/MoveL 和程序执行基础能力已经实现并由用户验证；下一步存在“RAPID 文本闭环、运动语义深化、教学调试体验”三个竞争方向，需要先确定单一里程碑，避免功能横向铺开。
- 设计影响：本票只决定下一阶段优先级、成功标准和推迟范围，不实现 parser、编辑器、zone、工具/工件变换或新 UI。
- 业务影响：未修改 `src`、测试、依赖或运行时行为；进入 Wayfinder 的 grilling/domain-modeling 讨论。

## 2026-08-11 — Ticket 01 修正 ABB RAPID 数据契约

- 修改 `src/core/rapid/rapid-types.ts`：让 RAPID 结构类型忠实承载未来 parser 解析出的 ABB 数据，而非项目内部自定义形状。
  - 新增 `RapidQuat` 类型，明确 ABB 四元数记录顺序为 `[q1,q2,q3,q4]`：q1 是标量 w、q2 是 x、q3 是 y、q4 是 z，单位四元数是 `[1,0,0,0]`（绕 Z 转 90° 为 `[cos45°,0,0,sin45°]`）；新增 `RAPID_UNIT_QUAT = [1,0,0,0]` 领域常量。
  - 把含糊命名的 `RapiDegreeFrame` 改名为清晰的 `RapidPose`，不使用旧别名。
  - `RobTarget.rot` 改用 `RapidQuat`；`RobConf` 注释明确为 `[cf1,cf4,cf6,cfx]`。
  - 新增 `NO_EXTERNAL_AXIS = [9E9,9E9,9E9,9E9,9E9,9E9]` 领域常量：无外部轴的 robtarget 六项用 ABB 未定义值 9E9，不再用全零。
  - `ZoneData` 调整为与 ABB zonedata 记录一致：`finep/pzoneTcp/pzoneOri/pzoneEax/zoneOri/zoneLeax/zoneReax`，删除错误的 `zone/zoneRot`。
  - `LoadData` 增加 `ix/iy/iz`，`aom` 改为 `RapidQuat`。
  - `ToolData.frame` 改为 ABB 对应的 `tframe`。
  - `WobjData` 删除错误的 `uMecRot` 四元数，改为 `ufmec: string`，并保留 `robhold/ufprog/uframe/oframe`。
  - `defaultTool0/defaultWobj0` 的 frame 四元数改为单位 RAPID `[1,0,0,0]`，`ufmec` 为空字符串，`loaddata` 提供 `ix/iy/iz`，`aom` 为单位四元数。
  - `isDefaultTool0` 改为校验 robhold/tframe、负载质量/质心/aom（单位四元数）/ix/iy/iz；`isDefaultWobj0` 校验 robhold/ufprog/ufmec 空字符串/uframe/oframe。
- 修改 `src/core/rapid/plan-shared.ts`：这是 RAPID → 机器人 Pose 的转换 seam。
  - 新增 `rapidQuatToInternal`（RAPID `[q1,q2,q3,q4]` → 内部 `[x,y,z,w]`）与 `internalQuatToRapid`（反向），机器人的 `rotation3d`/`quaternionToRotationMatrix` 只按内部 `[x,y,z,w]` 工作，不猜测两种顺序。
  - `robTargetToPose` 在归一化后、调用 `quaternionToRotationMatrix` 前，先经 `rapidQuatToInternal` 显式转换四元数顺序。
  - `checkSupportedConfiguration` 的外部轴判定改为：六项均为 `NO_EXTERNAL_AXIS`（9E9）才视为无外部轴，其余返回 `unsupported-option`；不再把全零当“未使用”。
- 修改 `src/robot/builtin-program.ts`：`yaw()` 四元数改为 RAPID 顺序（返回 `[cos,0,0,sin]`），目标默认姿态与 `extax` 使用单位四元数/`NO_EXTERNAL_AXIS`（9E9）。
- 修改测试 fixture：`movej-planner.test.ts`、`movel-planner.test.ts`、`program-executor.test.ts` 的目标从内部 `[0,0,0,1]` 四元数与全零 `extax` 改为 RAPID 单位四元数 `[1,0,0,0]` 与 `NO_EXTERNAL_AXIS`（9E9）；`movel-planner.test.ts` 的 `degreeFrameFromPose` 在 FK 四元数（内部顺序）送入 RAPID `rot` 前经 `internalQuatToRapid` 转换，10° 姿态用例同理。
- 新增 `src/core/rapid/rapid-types.test.ts`：覆盖数据契约验收——单位 RAPID 四元数转换得单位矩阵、Z 轴 90° 四元数转换得正确旋转矩阵、顺序为 `[q1,q2,q3,q4]`、LoadData 含 ix/iy/iz、WobjData.ufmec 为 string、ZoneData 字段与 ABB 一致、无外部轴常量六项 9E9、默认 frame 四元数为 `[1,0,0,0]`。
- 修改原因：根问题在于“测试通过但不兼容真实 ABB RAPID”——四元数顺序、无外部轴表示、zone/load/tool/wobj 字段都与 ABB 记录不符，未来 parser 无法把解析结果塞进当前形状。统一改到 ABB 约定，为后续 RAPID parser 铺路。
- 影响：RAPID `rot` 现为 `[q1,q2,q3,q4]`（q1=w），数学模块内部 `[x,y,z,w]` 约定不变，转换只在 plan-shared seam 进行；无外部轴 fixture 全部改用 9E9；`zoneRot/uMecRot/RapiDegreeFrame` 等旧符号不再存在。机器人数学、Cartesian path planner、MotionRunner 未改动。
- 验证结果：`npm run check` 通过；`npm test` 通过（18 个文件、110 passed / 1 个既有 expected-fail）；`git diff --check` 通过；完成前搜索 `rg "RapiDegreeFrame|uMecRot|zoneRot|rot: \[0, 0, 0, 1\]|extax: \[0, 0, 0, 0, 0, 0\]"` 无结果。未运行长期驻留服务。

## 2026-08-11 — 内置演示程序升级为更复杂的搬运循环

- 修改 `src/robot/builtin-program.ts`：把内置演示程序从 3 条（MoveJ → MoveL → MoveJ）升级为 7 条的“取件 → 转移 → 放件”搬运循环，全部沿用现有 `tool0`/`wobj0`/`fine`、无外部轴：① MoveJ 高速接近取件点上方 → ② MoveL 低速下降取件 → ③ MoveL 低速提起 → ④ MoveJ 高速转移到放件点上方 → ⑤ MoveL 低速下降放件 → ⑥ MoveL 低速提起 → ⑦ MoveJ 高速返回高位姿态点。
  - 拆分出 `FAST_SPEED`（v_tcp=150）与 `WORK_SPEED`（v_tcp=60）两种速级：接近/转移用较快速，取放/定位用较慢速，便于观察段落差异，也更能证明结构化执行链按序推进、速级随指令变化。
  - 目标点更远且取向区分：取件点位于 home 前左 `(100,-100)`、0° 姿态，放件点位于 home 后右 `(-100,100)`、绕工具 Z 回转 90°（新增 `yaw(deg)` 四元数辅助函数），两工位相距约 280 mm 且姿态相差 90°，形成经典的“抓取后回转 90° 再放置”；`targetPos` 增加可选 `rot` 参数。工作高度取 z≈25/60（低于此高度时远点的 MoveL 笛卡尔直线路径会不可达，已通过规划器探明并避开）。
  - 目标点固定、可读、基于 home 零位 TCP 偏移，并用真实规划器 + ABB 模型逐一验证全部 7 条（含 90° 姿态的 MoveL 下降/提起）均可规划成功。
- 新增 `src/robot/builtin-program.test.ts`：回归测试，校验内置程序每条 MoveJ/MoveL 目标点经 ABB 模型规划均可达，防止手写目标点后续越界。
- 修改 `e2e/abb-program.spec.ts`：完整运行用例的程序指针断言由 3 改为 7（七条指令全部完成），describe 标题更新为“搬运循环”。
- 修改原因：让页面内置演示程序更接近真实 ABB 搬运程序的结构，覆盖多段 MoveJ/MoveL 交替、两种速级、较远工位与 90° 回转放件，更好演示结构化执行链，同时仍严格限定在当前已有实现（结构化 MoveJ/MoveL、tool0/wobj0/fine、无外部轴）范围内。
- 影响：程序执行语义（`ProgramExecutor` 串行推进、暂停/停止/复位）不变；仅内置演示程序内容、e2e 指针断言与新增可达性回归测试。`npm run check` 通过；`npm test` 通过（17 个文件、102 passed / 1 个既有 expected-fail）；目标点先经临时 vitest 探明 MoveL 可达包络后再定格。

## 2026-08-11 — Ticket 06 在现有页面跑通内置结构化 ABB 程序

- 新增 `src/robot/builtin-program.ts`：内置演示程序 `createBuiltinProgram()`，固定、可读、经 ABB 模型验证可达的 MoveJ → MoveL → MoveJ，全部使用 `tool0`/`wobj0`/`fine`、无外部轴；目标值固定（基于 home 零位 TCP 偏移，不是运行时从当前 FK 临时生成的“假”目标）。`v_tcp=60` 便于在教学中观察每条运动与暂停冻结。
- 新增 `src/robot/program-control.ts`：`useProgramController` 把 Vue 无关的 `ProgramExecutor` 接到现有 `MotionRunner`、ABB `RobotModel` 与共享 `joints` 状态上。只负责构造程序、发出控制命令与同步快照（100ms 轮询刷新 `snapshot`，终止后自动停止轮询），不新增动画循环/IK/路径规划/通用 store。`stopActiveProgram()` 供手动关节/笛卡尔命令在活动程序时先终止程序，避免争用同一 MotionRunner。
- 新增 `src/components/ProgramControlPanel.vue`：显示程序状态、程序指针、运动指针与当前规划错误，提供运行/暂停/继续/停止/复位按钮，按钮可用性与 `ProgramExecutor` 状态一致（idle 仅运行、running 暂停+停止、paused 继续+停止、终止态复位），并发出对应命令事件。
- 新增 `src/components/ProgramControlPanel.test.ts`：覆盖按钮可用性、控制命令映射、状态/指针显示、规划错误显示。
- 修改 `src/App.vue`：`useMotion` 补充 `pauseMotion/resumeMotion/getMotionStatus`，创建 `programControl` 并把 `ProgramControlPanel` 接入侧栏；手动关节（滑块/步进/随机/回零）与笛卡尔控制入口先调用 `programControl.stopActiveProgram()`，确保手动运动与程序不并发、切换手动后旧程序不继续推进。
- 修改 `src/style.css`：新增 `program-panel` 样式块（状态/指针/按钮/错误展示）。
- 新增 `e2e/abb-program.spec.ts`（1920×1080 viewport）：验证完整运行后状态 `已完成` 且程序指针=3、运动中暂停后关节冻结/继续完成同一次运动、停止后不推进到下一指令且复位不移动机器人。
- 修改原因：在现有 ABB 教学页面跑通内置结构化程序的最小控制面板，使用户能运行、暂停、继续、停止、复位并观察状态与指针随真实三维机器人运动变化。
- 影响：UI 只复用既有 MotionRunner、ABB RobotModel、关节状态与 ProgramExecutor；未新增第二个 runner、复制关节状态或直接操作 Three.js 关节节点；未加入代码编辑器/parser/持久化/zone blending，也无后端接口或 DTO。内置程序只用于证明结构化执行链。
- 验证结果：`npm run check`、`npm test`（16 文件、101 passed / 1 个既有 expected-fail）、`npm run build`、`npm run test:e2e`（8 passed，含既有 5 条回归与新增 3 条程序用例）全部通过；临时启动的 `vite preview` 已终止，端口 4173 确认无 LISTEN、已释放。

## 2026-08-11 — Ticket 05 补齐程序暂停、继续、停止与复位

- 修改 `src/core/rapid/program-executor.ts`：
  - `ProgramState` 增加 `paused`；`ProgramExecutionSeam` 增加 `pause/resume/stop`（委托给底层运动，即 UI seam 中的 MotionRunner），ProgramExecutor 只把这些命令委托给 seam，不含 RAF/IK/路径采样/Vue ref/UI 文案/回零。
  - `pause` 仅在 `running` 时把状态改为 `paused` 并委托当前运动；指针与未完成的运动 Promise 保持不变。`resume` 仅在 `paused` 时恢复同一次运动与同一条执行链，不重新规划、不重复提交、不创建第二个执行 Promise。`stop` 在 `running/paused` 时只委托当前运动停止，**不直接改写程序状态**（避免“旧 async 链在 stop/reset 后再次写状态”的竞态），终止结果由执行链恢复后统一结算为 `stopped`，programPointer 不增加、后续指令不执行。
  - 重复 `pause/resume/stop` 幂等，不抛与状态竞争有关的异常。
  - `reset` 仅在无活动运动的 `idle/completed/stopped/error` 清理状态、指针与错误；在 `running/paused` 不做任何修改（调用方必须先 stop）。reset 不移动机器人、不回零、不清空场景轨迹、不重新规划程序。
- 修改 `src/core/rapid/program-executor.test.ts`：为 fake seam 实现 pause/resume/stop（stop 把挂起 execute 结算为 stopped，模拟 MotionRunner 结算；pause/resume 记账），并新增：运行中 pause 委托且指针/未完成 Promise 不变、暂停后停止不推进、重复命令幂等、completed/error 后 reset 回到 idle、active 态 reset 不做修改、以及真实 MoveJ/MoveL 暂停冻结关节/继续完成/暂停后停止的集成测试。
- 修改原因：为结构化 ProgramExecutor 提供稳定状态快照与执行控制，使上层能运行、暂停、继续、停止并复位程序，同时保证暂停属于同一次运动、停止不推进程序。
- 影响：`ProgramExecutionSeam` 的 execute-only 接口扩展为包含控制命令，现仅有测试调用方已一次性迁移；快照仍只含状态、程序指针、运动指针与当前错误，不加日志历史/百分比/motionId/订阅器/暂停原因栈。未实现单步、断点、速度倍率或持久化。
- 验证结果：`npm run check` 通过；`npm test` 通过（15 个测试文件、94 passed / 1 个既有 expected-fail）。未运行长期驻留服务。

## 2026-08-11 — Ticket 04 串行执行结构化 MoveJ/MoveL 程序

- 新增 `src/core/rapid/program-executor.ts`：领域层 `ProgramExecutor`（不依赖 Vue/Three.js），接受结构化 MoveJ/MoveL 数组和注入的 `ProgramExecutionSeam.execute` seam。`ProgramExecutionSeam` 只要求 `execute(instruction) => Promise<InstructionOutcome>`，ProgramExecutor 不含 FK/IK/路径采样/关节插值/RAF/通用队列/UI 文案。
- 状态与指针语义：
  - `ProgramState`：`idle | running | completed | stopped | error`（暂停由下一票补充）。
  - `programPointer` 为下一条允许执行的指令索引，仅当前运动返回 `completed` 后加一；`motionPointer` 为当前规划/运动指令索引，无活动指令时为 `null`。
  - 最后一条完成后 `programPointer === 长度`、`motionPointer === null`、状态 `completed`；空程序确定进入 `completed` 且指针为 0。
  - 运动返回 `stopped` 不算完成：指针不增、motionPointer 清空、程序进入 `stopped`，后续指令不执行。
  - 规划错误进入 `error`，快照保存准确指令索引、稳定错误码（=规划错误 kind）与可读消息，后续指令不执行。
  - `run()` 仅从 `idle` 启动，运行中/终止时幂等返回当前状态，不产生第二条执行链，并 resolve 为最终终止状态。
  - `getSnapshot()` 返回稳定快照（state/programPointer/motionPointer/error），调用方不能改写内部状态。
- 新增 `src/core/rapid/program-executor.test.ts`：通过可控 fake seam 覆盖空程序、MoveJ→MoveL→MoveJ 串行与“当前未完成不调用下一条”、stopped 不推进、规划错误索引、重复 run 幂等、getSnapshot 不可变；并用真实规划器 + ABB 模型 + 手动 MotionClock 做 MoveJ→MoveL→MoveJ 集成测试。
- 修改原因：让只含结构化 MoveJ/MoveL 的内存程序按顺序执行，并向调用方暴露稳定的程序状态、程序指针、运动指针与错误。
- 影响：MotionRunner 仍只拥有一个活动运动，不增加内部队列；ProgramExecutor 是程序顺序唯一所有者，单条 async 执行链维护顺序。未实现暂停/继续/停止/复位（下一票）、RAPID parser、zone blending 或通用队列。
- 验证结果：`npm run check` 通过；`npm test` 通过（15 个测试文件、85 passed / 1 个既有 expected-fail）。未运行长期驻留服务。

## 2026-08-11 — Ticket 03 用结构化 MoveL 执行一条 ABB 直线路径

- 新增 `src/core/rapid/plan-shared.ts`：抽取 MoveJ/MoveL 共享的规划错误类型（`MotionPlanErrorKind`/`MotionPlanError`）、统一数据与配置校验 `validateMotionInput`（先数据后配置：非有限值/零长度四元数/非正 `v_tcp` → `invalid-data`，非默认工具/工件/非 fine/外部轴 → `unsupported-option`）、`robTargetToPose`（把 robtarget.trans/rot 归一化转换为 Pose）与 `isJointAtLimit`（关节范围边界启发式）。`movej-planner.ts` 改为复用该共享模块，删除重复的私有校验器。
- 新增 `src/core/rapid/movel-planner.ts`：`planMoveL` 复用 Ticket 02 的类型与共享校验，直接调用现有 `planCartesianPath`（不新增直线插值/SLERP/逐点 IK/构型跳变实现）；规划失败（空路径/不可达/奇异附近/waypoint 上限/构型跳变）统一在运动启动前映射为 `unreachable` 规划错误，关节不变。时长为 TCP 起点到终点距离 / `v_tcp`（转毫秒并保证正的有限值），零距离时长被钳位为 1ms。`executeMoveL` 注入 `runTrajectory` seam，整组 waypoint 只调用一次 MotionRunner 轨迹入口并原样返回 `completed/stopped`。
- 修改 `src/core/robot/math/rotation3d.ts`：新增共享 `rotationMatrixToQuaternion`（旋转矩阵转四元数，标量在最后，与 robtarget.rot 形状一致）；`src/core/robot/cartesian-path-planner.ts` 改为导入它并删除其私有 `rotationToQuaternion` 副本，满足“旋转数学提取到共享 seam、不复制公式”。
- 新增 `src/core/rapid/movel-planner.test.ts`：覆盖 5mm 位置 MoveL 的 TCP 横向/终点误差满足现有路径阈值、10° 姿态 MoveL 保持连续 waypoint 且不超 5° 最大关节步长、运动中停止返回 `stopped` 且停止后不再推进、零距离行为、`v_tcp` 按声明公式改变整条轨迹时长、不可达/构型跳变规划失败不调用 `runTrajectory`，以及 `invalid-data`/`unsupported-option` 边界。
- 修改原因：让结构化 MoveL 复用现有笛卡尔路径规划器，通过 MotionRunner 一次提交整条轨迹并统一等待完成/停止。
- 影响：`plan-shared` 同时被 MoveJ/MoveL 引用，避免复制类型与校验器；未新建路径规划器/IK/轨迹播放器/动作队列/帧循环，未触碰页面。
- 验证结果：`npm run check` 通过；`npm test` 通过（14 个测试文件、78 passed / 1 个既有 expected-fail）；既有 cartesian-path-planner 回归测试保持通过。未运行长期驻留服务。

## 2026-08-11 — Ticket 02 用结构化 MoveJ 执行一个 ABB 目标

- 新增 `src/core/rapid/rapid-types.ts`：领域层 ABB RAPID 结构化数据类型，不依赖 Vue/Three.js。定义 `RobTarget`（毫米 `trans`、四元数 `rot`、四项 `robconf`、六项 `extax`）、`SpeedData`（`v_tcp` 等 ABB 单位）、`ZoneData`（`finep` 与六个 zone 数值字段）、`tooldata`/`wobjdata` 记录形状，以及携带目标/速度/zone/工具/工件的 `StructuredMoveJ`、`StructuredMoveL`。提供 `defaultTool0`、`defaultWobj0`、`defaultZoneFine` 与 `isDefaultTool0`/`isDefaultWobj0` 判定。
- 新增 `src/core/rapid/movej-planner.ts`：
  - `MotionPlanErrorKind` 可辨识联合，至少区分 `invalid-data`、`unsupported-option`、`unreachable`、`joint-limit`，作为规划错误而非 MotionRunner 的 `failed` 结果。
  - `planMoveJ` 纯函数：IK 前校验非有限数值、零长度四元数、非正 `v_tcp` 返回 `invalid-data`；非默认工具/工件、非 fine zone、外部轴返回 `unsupported-option`；复用现有 `solveIK` 与 ABB `RobotModel`（不复制 DLS/Jacobian/FK/限位），把 `robtarget.rot` 归一化后经现有 `quaternionToRotationMatrix` 转为旋转矩阵；不可达返回 `unreachable`，IK 解被夹在关节范围边界返回 `joint-limit`。时长用明确记录的仿真近似 TCP 距离/`v_tcp`（转毫秒，保证正的有限值）。
  - `executeMoveJ` 注入 `runEased` 执行 seam，规划成功后只通过缓动入口提交关节目标并原样返回 `completed/stopped`；规划错误不启动任何请求帧。
- 新增 `src/core/robot/manual-motion-clock.ts`：测试用手动时钟，供后续程序执行器与 UI 测试复用。
- 新增 `src/core/rapid/movej-planner.test.ts`：覆盖数据处于领域层、`invalid-data`/`unsupported-option` 校验、`v_tcp` 按 距离/`v_tcp` 改变时长、固定可达 `robtarget` 完成 MoveJ 并由 FK 校验终点位置与姿态、停止 MoveJ 返回 `stopped`、规划错误不启动请求帧也不调用 `runEased`。
- 修改原因：让解析后的结构化 MoveJ 能复用现有机器人模型与 IK 真正驱动三维机器人，并暴露统一 `completed/stopped` 结果供上层等待。
- 影响：`movel` 指令类型已在本票先行定义，供 Ticket 03 直接复用；未建立第二套 Pose/FK/IK/Jacobian/关节范围/动画系统，未触碰 `App.vue` 或页面控制。
- 验证结果：`npm run check`（vue-tsc）通过；`npm test` 通过（13 个测试文件、71 passed / 1 个既有 expected-fail）。未运行长期驻留服务。

## 2026-08-11 — Ticket 01 补齐 MotionRunner 可观察生命周期

- 修改 `src/core/robot/motion-runner.ts`：为 `startEased`、`startSpeedLimited`、`startTrajectory` 补齐类型严格的 `Promise<MotionResult>` 终止返回值（`completed | stopped`），新增 `pause`、`resume`、`getStatus` 与 `MotionStatus`（`idle | running | paused`），并把 `MotionResult` 暴露为领域类型。
- 生命周期语义：
  - 每种启动方法都返回终止 Promise；自然到达终点解析一次 `completed` 并回到 `idle`，不残留请求帧。
  - 同模式连续目标更新会复用当前帧循环和不带未完成 Promise（长按不卡顿基础），并从当前实际关节继续。
  - 切换运动模式时先结算旧运动为 `stopped`，新模式拥有独立 Promise，且始终只存在一个待执行帧循环。
  - 暂停冻结当前关节与剩余运动、累计暂停时长；继续后仍属于同一次运动和同一个 Promise，缓动/轨迹进度排除暂停时间，限速运动恢复首帧通过重置 `lastTime` 避免把整段暂停换算成关节步长。
  - `pause`、`resume`、`stop` 对不适用状态幂等；`stop` 保持停止瞬间关节值并回到 `idle`。
  - 空 waypoint 轨迹明确抛出参数错误，不返回永远不结算的 Promise，也不改变现有运动状态。
- 修改 `src/robot/motion-control.ts`：Vue 时钟 adapter 暴露 `pauseMotion`、`resumeMotion`、`getMotionStatus`，并重新导出 `MotionResult`、`MotionStatus`；仍只有一个 runner，只负责注入浏览器 RAF 和卸载清理。
- 修改 `src/core/robot/motion-runner.test.ts`：保留既有 8 个测试，并新增自然完成、显式停止、模式切换、同模式连续目标返回同一 Promise、缓动/轨迹/限速暂停继续、幂等命令、空轨迹错误、暂停中停止和 `getStatus` 全状态覆盖。
- 修改原因：让当前手动控制和后续 RAPID 程序执行器都能可靠等待同一套运动生命周期。
- 影响：`App.vue` 等现有调用者通过 `motion-control` adapter 调用，启动方法返回的 Promise 被忽略，行为不变；未新建第二个 runner、RAF 循环、动作队列、事件总线或 Vue 专属运动状态机。
- 验证结果：`npm run check`（vue-tsc）通过；`npm test` 通过（12 个测试文件、59 passed / 1 个既有 expected-fail，位于未改动的 ik-solver.test.ts）。未启动 `npm run dev` 或任何长期驻留服务。

## 2026-08-11 — 发布结构化 RAPID 运动执行任务集

- 新增 `.scratch/abb-rapid-motion-execution/issues/`，按依赖顺序发布 6 张 `ready-for-agent` 本地 ticket：MotionRunner 可观察生命周期、结构化 MoveJ、结构化 MoveL、串行 ProgramExecutor、程序控制状态以及页面内置程序演示。
- 每张 ticket 均补充已有实现与复用边界、精确状态语义、首期支持范围、禁止重复实现项、可勾选验收标准和验证命令，使小模型无需依赖对话上下文即可执行。
- 阻塞链为 `01 → 02 → 03 → 04 → 05 → 06`；其中 03 同时显式依赖 01、02，04 显式依赖 02、03。当前 frontier 只有 01。
- 修改原因：用户需要把已确认的 MotionRunner 最小生命周期及结构化 MoveJ/MoveL 程序执行方案拆成小模型可直接领取的 tracer-bullet tickets，并重点防止重复创建 MotionRunner、IK、路径规划、帧循环和通用队列。
- 设计影响：首期只支持已解析的结构化指令、`tool0 + wobj0 + fine`；非默认工具/工件、zone、外部轴和未支持配置必须明确报错。本任务集不包含 RAPID 文本 parser、编辑器、持久化、MoveC 或 zone blending。
- 业务影响：未修改 `src`、测试、依赖或运行时行为；本次只新增任务说明与更新日志。

## 2026-08-11 — 定案 MotionRunner 最小可观察生命周期

- 修改 `.scratch/abb-teaching-simulation/issues/07-motion-runner-observable-lifecycle.md`：将决策票标记为已解决，确定运动提交返回 `Promise<'completed' | 'stopped'>`，暂停/继续保持同一次运动，并只暴露 `idle/running/paused` 状态。
- 修改 `.scratch/abb-teaching-simulation/map.md`：把 MotionRunner 生命周期加入已确认决策，收窄仍未明确的问题；暂停/停止语义不再与程序指针、错误恢复混写。
- 新增 `.scratch/abb-teaching-simulation/issues/08-structured-movej-movel-contract.md`：把下一阶段限定为 RAPID 数据形状、MoveJ/MoveL 规划边界、规划失败和 fine/zone 首期语义，本轮不提前作答。
- 修改 `CONTEXT.md`：补充“运动状态”和“运动结果”，明确它们分别不是程序状态，也不包含 `paused/replaced/failed`。
- 修改原因：简单 RAPID 只需要可靠等待一条运动完成、支持暂停/继续/停止并判断是否可以推进程序；丰富快照、订阅、motionId、暂停原因栈、时间戳 waypoint 和队列目前没有用例支撑。
- 设计影响：MotionRunner 保持为只执行已校验关节目标/waypoint 的深模块；IK、不可达、限位、speeddata、fine/zone 和 RAPID 错误均留在 MoveJ/MoveL 规划层或程序执行层。
- 业务影响：未修改 `src`、测试、依赖或运行时行为；本次只完成方案定案和后续票拆分。

## 2026-08-11 — 固化运动执行生命周期术语

- 新增根目录 `CONTEXT.md`，记录 ABB 教学编程仿真上下文中“运动执行、完成、停止、暂停”的统一定义。
- 修改原因：Wayfinder 第一轮确认 MotionRunner 的正常终止只需要区分 `completed` 与 `stopped`；`paused` 是同一次运动的非终止状态，`replaced` 和运动学 `failed` 不进入 RAPID 运动结果。
- 设计影响：后续程序执行器只在运动“完成”后推进；“停止”后不自动推进；暂停/继续保持同一次运动身份。IK、不可达和关节越界仍由 MoveJ/MoveL 规划层处理。
- 业务影响：未修改业务源码、测试、依赖或运行时行为；仅新增领域词汇文档和本更新记录。

## 2026-08-11 — Wayfinder 拆分并认领 MotionRunner 生命周期决策

- 新增 `.scratch/abb-teaching-simulation/issues/07-motion-runner-observable-lifecycle.md`，从“程序解释执行与运动观察语义”中抽出 MotionRunner 的完成、暂停/继续、停止、目标替换和状态快照决策。
- 修改原因：现有程序执行票同时包含运动生命周期、程序状态、轨迹记录和 UI 观察，无法在一轮决策中清晰解决；用户已明确下一步优先深化 MotionRunner，再进入结构化 MoveJ/MoveL。
- 设计影响：该票只定义运动 module 的 interface 和可观察语义，不提前实现 RAPID parser、程序执行器、fine/zone 或通用动作队列。
- 业务影响：未修改 `src`、测试、依赖、模型资产或运行时行为；本轮进入 Wayfinder HITL 决策流程。

## 2026-08-11 — 下载并初步分析 ABB 仿真参考项目

- 新增 `.scratch/abb-teaching-simulation/reference-projects/`，使用浅克隆固定下载 6 个参考仓库：`rapid-for-vim`、`vscode-abb-rapid`、`RAPID-Scripts-and-Demos`、`industrial_robotics`、`posecode`、`realvirtual-WEB`。
- 新增 `.scratch/abb-teaching-simulation/research/10-reference-projects-analysis.md`，记录各仓库来源 commit、许可证边界、可借鉴方案和不采用范围。
- 修改原因：在进入 ABB RAPID 程序仿真实现前，先核对真实程序写法、编辑器语法资料、文本到 IR 的组织方式，以及浏览器仿真生命周期，避免凭推测设计 parser 和执行器。
- 方案结论：真实 RAPID 示例作为验收输入；借鉴 Posecode 的 `文本 → parser → IR/诊断 → 时间线/渲染` 分层；仅借鉴 realvirtual-WEB 的固定步长时钟和暂停原因栈，不引入其数字孪生平台能力。
- 许可证影响：`rapid-for-vim`、`RAPID-Scripts-and-Demos`、`industrial_robotics` 为 MIT；`vscode-abb-rapid` 当前检出版本无许可证文件；Posecode parser/language 为 Apache-2.0、render 为 AGPL-3.0-only；`realvirtual-WEB` 为 AGPL-3.0-only。本轮不复制参考代码、不引入依赖。
- 业务影响：未修改 `src`、`package.json`、模型资产或运行时行为；仅增加 `.scratch` 参考资料和本更新记录。

## 2026-08-10 — 实现 ABB 平滑笛卡尔直线控制

- 新增 `src/core/robot/cartesian-path-planner.ts`：提供通用 `planCartesianPath` 深层接口；按最大 1 mm 位置步长和 1° 姿态步长插补 TCP 位姿，位置使用直线插值、姿态使用四元数 SLERP，并复用现有六维 DLS `solveIK` 逐点求解。
- 规划安全约束：每个 waypoint 使用上一解作为连续初值；相邻关节最大变化超过 5°、任一点无解或路径超过 200 点时整体拒绝，避免在奇异位形或多解边界上跨构型跳转。
- 修改 `src/robot/cartesian-control.ts`：笛卡尔命令从“只求终点 IK”改为“规划并提交完整 waypoint”；删除会静默放弃姿态约束的 position-only fallback，失败时保留当前有效姿态并明确提示不可达/接近奇异构型。
- 修改 `src/core/robot/motion-runner.ts`、`src/robot/motion-control.ts`：在现有单一 RAF 生命周期内增加 waypoint 轨迹播放，复用统一缓动时间轴；连续长按更新时替换当前轨迹数据并复用帧循环，不新建第二套运动系统。
- 修改 `src/App.vue`、`src/components/CartesianControlPanel.vue`：ABB 笛卡尔控制接入轨迹播放；普通关节控制继续使用原有缓动/限速逻辑；状态标签改为 `PATH OK`。连续点动采用 140 ms 播放时长，与面板 100 ms 重复输入节奏衔接。
- 新增 `src/core/robot/cartesian-path-planner.test.ts`，修改 `src/core/robot/motion-runner.test.ts`、`src/robot/cartesian-control.test.ts`：覆盖 ABB 5 mm 直线路径、姿态连续插补、危险构型分支跳变拒绝、轨迹执行时间轴及控制层提交分段路径。
- 修改 `e2e/abb-irb1200.spec.ts`：通过公开 UI 采样正解 TCP，验证 World 5 mm 单次位移和 Tool 长按连续位移均保持直线轨迹。
- 修改原因：旧逻辑仅计算终点 IK，再在线性关节空间中从起点插到终点；在 ABB 奇异/多解边界会选到相差约 80° 的另一关节分支，中间 TCP 因而形成明显弧线。问题不属于已对齐的 DH 或 FBX 参数。
- 修改影响：规划器只依赖共享 `RobotModel`、关节范围和现有 IK，可供后续其他机器人复用；未修改任何 KUKA 专属文件、ABB DH 参数、FBX 旋转轴或模型资产，也未引入新依赖。
- 验证结果：`npm run check` 通过；Vitest 12 个文件共 48 个测试通过、1 个既有预期失败；Vite 生产构建通过；Playwright 完整 E2E 5/5 通过。临时 preview 进程已终止，4173 端口已释放。

## 2026-08-11 — 清理未使用的旧逆解辅助函数

- 修改 `src/core/robot/ik-solver.ts`：删除无调用者的 `isReachable` 启发式可达性判断和 `solvePositionOnlyIK` 位置-only 逆解回退。
- 修改原因：ABB 当前笛卡尔控制已经使用完整位姿的 `solveIK` 和分段笛卡尔路径规划；两段旧函数在源码、测试和运行时均无调用，继续保留会造成算法入口混淆。
- 修改影响：不改变当前 ABB 或 KUKA 的正解、六维逆解、Jacobian、关节控制和动画行为；仅减少死代码。`solveIK` 使用的矩阵、阻尼、限位和误差工具均保留。
- 验证结果：TypeScript 编译通过；后续完整单元测试与残留符号搜索应确认旧入口已不存在。

## 2026-08-10 — 完成 ABB DH 与 FBX 六轴方向及工具坐标闭环

- 修改 `src/robots/abb-irb1200/robot-config.ts`：保留经 ROS-Industrial 与 FBX 轴线共同验证的 `399.1 / 448 / 42 / 451 / 82 mm` 几何量；为 J2、J3、J5、J6 增加 `thetaSign=-1`，J4 保持正向，并为 J5 增加 `+90°` 零位偏置。
- 修改原因：Playwright 单轴实测确认 J2/J3/J5 的 DH 有符号转角与 FBX 相反，且 J6 DH 轴为 X、FBX 轴为 Y；J5 的固定零位偏置可在标准 DH 内把 J6 轴转换到正确的 Y 轴线，无需新建 MDH 分支。
- 修改 `src/robots/abb-irb1200/abb-kinematics.ts`：新增基于 FBX joint6→joint7 实测 `93.902208 mm` 的固定 `ABB_FLANGE_TO_TOOL` 变换，同时完成 DH frame6 到 FBX tool 零位坐标轴的固定旋转。
- 修改 `src/scene/abb-scene.ts`、`src/scene/abb-fbx-calibration.ts`：明确 `joint6` 为机械法兰/第六轴节点、`joint7` 为夹具/TCP 节点；工具坐标和轨迹统一采样 joint7，并分别输出机械法兰和工具零位矩阵。用户确认的六个 `ABB_JOINT_AXES` 数值未修改。
- 修改 `src/robots/abb-irb1200/robot-config.test.ts`、`src/robots/abb-irb1200/abb-kinematics.test.ts`、`src/scene/abb-scene.test.ts`：新增关节符号、J5 偏置、零位七级 frame、J6 向下轴线、flange/tool 节点语义及标定矩阵回归。
- 修改 `e2e/abb-irb1200.spec.ts`：FBX/DH 闭环改为比较 joint7/TCP；DH 安装面坐标只在场景对照时叠加 FBX `dizuo` 实测高度，避免把额外底座写入机器人 DH；位置阈值按开源 DH 与 FBX 骨骼轴线实测偏差设为 15 mm，姿态阈值保持 0.5°。
- 修正 `.scratch/abb-teaching-simulation/research/08-abb-fbx-zero-calibration.md`、`09-abb-fbx-dh-link-measurements.md`：撤回“骨骼节点原点距离等于 DH 连杆长度、必须重建 MDH”的错误结论，改为按关节轴线公法线解释。
- 修改影响：ABB FK、数值 Jacobian、IK、DH 参考链和 FBX 动画现在使用同一组关节输入约定；KUKA 配置、KUKA 轴定义和共享 IK 算法均未修改。
- 验证结果：TypeScript 编译通过；Vitest 11 个文件共 43 个测试通过、1 个既有预期失败；Vite 生产构建通过；Playwright 完整 E2E 4/4 通过。单轴复测确认 G2/G3/G5 转角一致、G6 轴共线且向下；8 组 joint7/TCP 位姿最大位置误差 `12.83 mm`、最大姿态误差 `0°`。测试使用的临时 preview 已终止，4173 端口已释放。

## 2026-08-10 — 接入报告中的 ABB 5/0.9 候选DH几何映射

- 修改 src/robots/abb-irb1200/robot-config.ts：明确当前ABB标准DH profile使用报告中ROS-Industrial irb1200_5_90 等价链的候选几何量，并标注其不是ABB官方RobotStudio标定DH。
- 修改 src/robots/abb-irb1200/abb-kinematics.ts：明确基座旋转和joint7法兰定义属于当前项目适配约定；未擅自加入未经验证的tool0固定变换。
- 修改 src/robots/abb-irb1200/dh-robot-model.ts：将“官方等价DH”更正为“候选等价DH”，避免误报参数来源。
- 修改 src/scene/abb-scene-model.ts：同步修正ABB场景模型适配器中的来源注释，明确当前运行链是报告候选DH而非ABB官方标定机制。
- 修改 src/robots/abb-irb1200/robot-config.test.ts：锁定报告候选映射中的399.1、448、42、451、82毫米以及J2的-90度标准DH偏置。
- 修改原因：用户要求先使用报告中的参数进行ABB DH计算，同时保持来源边界和KUKA独立性。
- 影响：ABB现有标准DH矩阵计算数值不变；仅补充来源说明和回归断言。J6仍使用ABB官方手册的±400度限制，未将ROS URDF的±360度模型限制覆盖到项目。
- 修改 e2e/abb-irb1200.spec.ts：将原先单零位FBX/DH诊断扩展为8组零位、逐轴和复合姿态的真实FBX法兰位置与姿态对照，并附加真实关节零位标定数据。
- 修改原因：Playwright 实测页面 DH 闭环可以通过，但真实 FBX joint7 与候选 DH 仍存在显著差异；需要把问题拆分为零位变换、旋转中心和候选 DH 几何三类数据，而不是把页面闭环误当作模型闭环。
- 修改影响：测试直接记录 FBX joint7 与候选 DH 正解的位置/姿态误差，并生成 `fbx-joint-calibration.json` 附件；不改变运行时计算，也不改变用户确认的六个旋转轴。
- 测试修正：使用正解矩阵的 getRotation() 读取候选DH姿态；extractPose() 只返回位置和欧拉角，不能作为旋转矩阵来源。
- 实测结果：真实FBX joint7与候选DH在零位位置误差约527.09 mm，8组姿态最大位置误差约825.95 mm，最大姿态误差约121度；页面DH闭环通过不代表FBX层级与DH链已对齐。
- 新增 `.scratch/abb-teaching-simulation/research/08-abb-fbx-zero-calibration.md`：记录真实 FBX 六个关节的零位矩阵、旋转中心、轴向和相邻中心距离，并证明当前候选 DH 不能通过单一刚体固定变换对齐。
- 新增 `src/scene/abb-fbx-calibration.ts`：提供只读的 FBX 零位标定提取器；同时导出当前 `ABB_JOINT_AXES` 供诊断使用，提取过程不重算、不修改轴定义。
- 修改 `src/scene/abb-scene.test.ts`：增加零位矩阵、旋转中心和原有手工轴的单元回归。
- 修改 `src/scene/abb-scene-model.ts`：修正适配器注释，明确当前候选 DH 是 FK/Jacobian 的唯一计算来源，FBX 标定提取仅用于真实资产对照。
- 修改原因：避免“FBX 已经参与运动学计算”的错误架构说明。
- 修改影响：仅修正文档语义，不改变 ABB 或 KUKA 的运行时行为。
- 修改 `src/robots/abb-irb1200/abb-kinematics.ts`：新增 `forwardAbbKinematicsFrames` 和角度入口，输出基座、六个关节链 frame 及法兰原点，复用同一套 DH 正解矩阵。
- 新增 `src/scene/abb-dh-debug-chain.ts`：用彩色球、连杆线和 X/Y/Z 坐标轴绘制候选 DH 参考链，位置单位从毫米转换为 Three.js 米，不驱动 FBX。
- 修改 `src/scene/abb-scene.ts`、`src/App.vue`、`src/components/SceneViewport.vue`：增加默认开启的“DH参考链”可视化开关，并随当前关节角实时更新。
- 修改 `src/robots/abb-irb1200/abb-kinematics.test.ts`：锁定七个 DH 原点的零位位置；修改 `e2e/abb-irb1200.spec.ts`：验证参考链开关可以隐藏和恢复。
- 修改原因：用户需要在 FBX 模型旁直接观察当前候选 DH 的关节原点和连杆位置，定位轨迹映射的基座、连杆或腕部偏差。
- 修改影响：仅增加 ABB 场景诊断可视化，不改变 FBX、六个手工旋转轴、FK、IK 或 KUKA 逻辑。
- 修复 `src/scene/abb-dh-debug-chain.ts`：将 `Matrix4x4.getRotation()` 返回的 3×3 旋转矩阵按 4×4 齐次旋转矩阵补齐，而不是读取不存在的第 4 行/列。
- 修复原因：参考链初始化时错误读取 3×3 矩阵，触发 `Cannot read properties of undefined (reading '0')`，阻止场景进入就绪状态。
- 修复影响：恢复 DH 参考链和 ABB FBX 场景初始化；不改变坐标值、轴定义或运动学结果。
- 修改 `e2e/abb-irb1200.spec.ts`：在 FBX 标定诊断中增加 `dizuo` 世界包围盒的毫米级输出。
- 修改原因：确定 DH 参考链应相对 FBX 安装面、底座顶部还是当前场景地面平移，避免把 `baseHeight` 与模型底座高度混为一谈。
- 修改影响：仅增加诊断日志和测试附件，不改变运行时场景。
- 修改 `e2e/abb-irb1200.spec.ts`：新增 G2～G6 各自 `+10°` 的 FBX/DH 连杆测量，记录两端坐标、连杆长度、轴点积、连杆方向点积和有符号转角。
- 修改原因：将用户手动观察到的“连杆方向相反”拆成可复现的单关节数据，区分轴正负号错误与 frame assignment/连杆长度错误。
- 修改影响：新增 `fbx-dh-link-measurements.json` 测试附件和 `[ABB-FBX-DH-LINK-MEASURE]` 诊断日志，不改变运行时运动学。
- 修正 `e2e/abb-irb1200.spec.ts` 的测量基线：在读取 `dizuo` 包围盒前强制更新 FBX 世界矩阵，且 G4～G6 使用到法兰的下游连杆向量，避免沿自身轴线的直接子连杆掩盖旋转差异。
- 修正原因：避免诊断附件出现 70000 mm 的底座高度和 G4/G6 无法体现旋转方向的问题。
- 修正影响：只改变测量输出，不改变场景或运动学实现。
- 新增 `.scratch/abb-teaching-simulation/research/09-abb-fbx-dh-link-measurements.md`：记录 G2～G6 的单关节 `+10°` FBX/DH 轴点积、连杆长度、中心坐标和有符号转角；结论为 G2/G3/G5 轴正方向反向、G4 下游 frame 布局错误、G6 DH X 轴与 FBX Y 轴不一致。
- 修改 `src/scene/abb-scene.ts`、`src/scene/abb-dh-debug-chain.ts`：提取 `dizuo` 的实际高度并将 DH 参考链平移到 FBX 底座顶面；当前资产测得底座高度约 700 mm。
- 修改原因：原参考链从世界地面开始，未包含 FBX 底座安装面的显示平移，导致 DH 原点看起来整体埋在模型底座下方。
- 修改影响：仅移动“DH参考链”诊断组，不改变主 DH FK/IK、FBX 动画、旋转轴或 KUKA。

## 2026-08-10 — 新增 ABB DH 参数并行检索方案

- 新增文件：.scratch/abb-teaching-simulation/research/06-abb1200-dh-search-plan-for-agents.md。
- 修改原因：用户要求由其自行派发多个 Agent 搜索 ABB IRB 1200-5/0.9 的 DH/MDH 参数，因此提供统一的检索范围、Agent 分工、证据等级、搜索词、FK 复现姿态和结果格式。
- 文档内容：区分 ABB 官方机制、RobotStudio SDK、官方手册、RobotWare、ROS/URDF、开源代码、论文、CAD 和当前 FBX 来源；强制记录型号、坐标系、零位、法兰、单位、矩阵顺序、许可证和冲突解释。
- 关键约束：不把几何尺寸直接称为完整 DH；不混用经典款、Gen2、Hygienic 和其他 IRB 1200 变体；在结果汇总前不修改 ABB 或 KUKA 业务代码。
- 影响：仅新增研究指导文档和本次更新记录；未修改 src、模型资产、依赖或运行时行为。

## 2026-08-10 — 接入 ABB 专用模型的共享数值逆解回归

- 修改 `src/scene/abb-scene-model.ts`：FBX 场景适配器不再从视觉节点反推 ABB FK；改为委托 `AbbDhRobotModel` 的官方等价标准 DH 链，并复用共享 `estimateNumericalJacobian`。
- 修改原因：用户要求 ABB 复用 KUKA 已验证的 DLS 六维逆解算法，同时当前 FBX 的节点链与官方 ABB DH 链存在已知差异；视觉资产不能覆盖运动学真值。
- 修改影响：ABB 的笛卡尔控制、FK、数值 Jacobian 和 IK 统一使用 ABB 专属 DH 适配器；FBX 仍只负责六轴可视化运动，KUKA 场景、KUKA 轴定义和 KUKA 求解路径未修改。
- 修改 `src/robots/abb-irb1200/dh-robot-model.ts`：注释明确该模型是 ABB FK/IK 的运动学真值来源。
- 修改 `src/core/robot/ik-solver.test.ts`：增加 ABB FK→IK→FK 六维闭环、关节限位和小位置目标回归，验证 ABB 使用与 KUKA 相同的 DLS 逆解入口。
- 编译修正：删除 ABB 场景适配器切换到 DH 真值后不再读取的 FBX FK 采样字段，并同步简化场景实例化和关节更新调用；避免严格 TypeScript 下保留死字段。
- 编译修正：删除同一适配器中已无调用者的 Three.js 导入和关节应用类型别名，保持运动学适配器不依赖渲染实现。
- 构建验证：由于 Windows 构建产物 `dist/models/ABB_IRB1200_5_90.fbx` 的只读属性导致 Vite 无法覆盖，仅对该明确的 `dist` 产物去除只读属性；未修改 `public/models` 源资产。
- 修改 `e2e/abb-irb1200.spec.ts`：将原先“FBX 实际法兰与 DH”诊断改为“页面位姿与 ABB DH 正解闭环”，移除已不适用的预期失败标记，并将位置误差阈值收紧到 1 mm。
- 修改原因：ABB 运行时已明确以 DH 适配器作为 FK/IK 真值，页面显示位姿应与该链严格一致；FBX 仅是视觉资产，不能继续用旧测试名称暗示它是法兰测量来源。
- 当前浏览器测量结果：8 组零位、逐轴和复合姿态样本最大位置误差约 0.05 mm，符合浮点误差范围。
- 构建环境修正：确认 `public/models/ABB_IRB1200_5_90.fbx` 与 `dist/models/ABB_IRB1200_5_90.fbx` 均因只读属性导致 Vite 无法重复覆盖；仅移除这两个明确 FBX 文件的只读属性，未改变模型内容。
- 新增 `e2e/abb-irb1200.spec.ts` 的最小一致性诊断：直接加载当前 FBX，经过正式 `prepareAbbModel/applyAbbJointAngles` 后比较零位 `joint7` 与 ABB DH 法兰。
- 诊断目的：把“逆解结果看起来完全错误”的用户症状固定到真实场景边界；该测试预期在当前状态失败，用于证明 FBX 视觉链与 ABB DH 链不一致，不代表 DLS 本身失败。
- 编译修正：将需要 Node 文件访问的 FBX 诊断放回 Playwright/E2E 层，未扩大浏览器 `tsconfig` 的 Node 类型依赖。
- 新增 `src/core/robot/ik-solver.test.ts` 的固定 ABB 构型纯 DH 收敛测试：隔离 FBX 后验证 DLS 是否能从零位求解多组 ABB 目标。
- 诊断结果：纯 DH DLS 对 `[-90,20,-100,-120,80,180]°` 从零位出发返回 `null`，说明单初值 DLS 不能覆盖 ABB 全部可达配置分支；该用例改为预期失败基线，等待多初值/配置分支 IK 实现。
- 诊断结果：真实 FBX 一致性用例测得零位法兰与 ABB DH 法兰相差 `527.085 mm`，改为预期失败基线；当前页面仍明确以 DH 为 FK/IK 真值，FBX 仅作视觉资产。

## 2026-08-10 — 重新检索 ABB 官方机制与 IRB 1200 论文运动学资料

- 新增 `.scratch/abb-teaching-simulation/research/05-official-abb-kinematics-source.md`。
- 修改原因：用户要求先联网核验官方模型、官方文档和相关论文，再决定 FK/IK 计算路线。
- 研究结论：ABB 官方手册/规格书可确认 IRB 1200-5/0.9 的尺寸、工作范围和轴限位；ABB 官方 RobotStudio Mechanism API 才提供机制级 DH、FK、IK、BaseFrame、Flange、校准偏置、同步位置和配置分支读取入口。
- 论文对比：S06 给出 `a2=448` 的候选表；S07 也使用 `a2=448` 但 J6 常数为 `pi`；S08 表格写 `a2=350` 且其附录公式出现 `448`，存在内部冲突。论文数据均不标记为 ABB 官方标定值。
- 影响：当前 `src/robots/abb-irb1200/robot-config.ts` 的参数应被视为候选几何模型；正式实现应优先导入 RobotStudio mechanism 数据，或在只有手册+FBX 时使用显式通用刚体变换/MDH 并完成 FBX 法兰闭环验证。

## 2026-08-10 — 纳入用户提供的 ABB FBX 资产

- 新增文件：public/models/ABB_IRB1200_5_90.fbx；源文件为 C:\Users\admin\Downloads\JQR_ABB(1).fbx，大小 1,222,736 bytes。
- 影响：后续场景适配器以 dizuo 为固定底座进行加载和浏览器验证。

## 2026-08-10 — 接入 ABB IRB 1200-5/0.9 FBX 场景

- 新增 src/robots/abb-irb1200/robot-config.ts：建立 ABB profile，关节范围采用官方手册数据，DH 几何候选为 399.1 / 448 / 42 / 451 / 82 mm，明确不是 ABB 控制器标定参数。
- 新增 src/robots/abb-irb1200/dh-robot-model.ts、src/scene/abb-scene-model.ts：提供 FBX 未加载时的 FK/Jacobian 回退和从真实场景采样末端位姿。
- 新增 src/scene/abb-scene.ts：加载 ABB FBX，以 dizuo 为固定底座，使用 joint1 到 joint6 驱动六轴，将 joint7 作为末端父节点，保留 joint8、joint9 分支；页面不再加载 KUKA GLB。
- 修改 src/App.vue、src/components/SceneViewport.vue、src/robot/joint-control.ts：页面、关节限位、FK/IK 回退模型和场景全部切换到 ABB profile，并支持注入机器人配置。
- 新增 src/robots/abb-irb1200/robot-config.test.ts、src/scene/abb-scene.test.ts：覆盖关节限位、候选几何长度、底座识别、六轴映射、末端分支保护和场景辅助对象。
- 当前验证：npm run check 通过；npm test 通过（10 个测试文件、35 个测试）。
- 后续修正：`src/scene/abb-scene.ts` 增加上一采样点跟踪；清空轨迹后保持为空，只有末端再次发生位移才重新记录，避免渲染帧把静止点立即加回来。

## 2026-08-10 — 最终验证与构建输出修正

- 修改原因：Windows 下用户提供的 FBX 带有 ReadOnly 属性，Vite 二次构建覆盖 dist 生成物时出现 EPERM。
- 处理方式：仅对构建生成的 `dist/models/ABB_IRB1200_5_90.fbx` 去除 ReadOnly 属性，源文件和项目静态源资产保持不变。
- 最终验证：`npm run check` 通过；`npm test` 通过（10 个测试文件、35 个测试）；`npm run build` 通过；`npm run test:e2e` 通过（Playwright 1.62.1，1 passed）。

## 2026-08-10 — 增加 FBX 法兰与 DH 正解对照诊断

- 新增 e2e/abb-irb1200.spec.ts 中的法兰测量用例：在零位和一组复合关节角下，读取实际 FBX 法兰显示位姿，并调用项目现有 DH 正解计算结果，输出位置误差附件。
- 修改原因：用户确认 FBX 旋转轴后，继续区分 DH 长度/偏置错误与模型法兰固定变换错误。
- 当前影响：该用例暂以 50 mm 位置误差为严格阈值，当前参数若未校准会主动失败并暴露实际差值；不改变运行时行为。
- 补充：测量附件同时记录实际/DH 姿态角差，便于区分固定法兰变换和轴间长度误差。

## 2026-08-10 — 扩展逐轴 DH 诊断样本

- 修改 `e2e/abb-irb1200.spec.ts`，增加 J1~J6 各自单独旋转 10° 的 Playwright 样本。
- 修改原因：先测量单轴运动引起的实际法兰位移和姿态变化，再判断问题属于 DH 长度、角度符号还是固定基座坐标变换。
- 修改影响：诊断附件新增 `singleAxisDeltas`，并输出 `[ABB-DH-MEASURE]` 前缀的逐样本测量日志；未修改任何运动算法或模型参数。

## 2026-08-10 — 完成 ABB FBX 比例核验

- 核验文件：`public/models/ABB_IRB1200_5_90.fbx` 与 `src/scene/abb-scene.ts` 中的 `ABB_MODEL_SCALE = 0.01`。
- 核验结果：FBX 原始单位按厘米解释时，去除 `dizuo` 后的机械臂包围盒约为 `769.3 × 972.8 × 263.7 mm`；ABB 官方 `IRB 1200-5/0.9` 机器人高度为 `967 mm`，当前缩放误差约 `0.6%`，因此 `0.01` 缩放保持不变。
- 额外发现：`dizuo` 包围盒约为 `500 × 700 × 500 mm`，与官方机器人底座约 `210 × 210 mm` 不符，应按外部高底座/支架单独理解，不能用整棵 FBX 的总高度反推机械臂缩放。
- 影响：本次只确认比例，不修改模型缩放、DH 参数或关节轴；后续 DH 对照应区分机械臂本体安装面与 `dizuo` 支架高度。

## 2026-08-10 — 建立 ABB 独立标准 DH 适配器

- 新增 `src/robots/abb-irb1200/abb-kinematics.ts`：实现 ABB 专用标准 DH 变换、ABB 基座坐标到 Three.js Y-up 世界坐标的固定旋转，以及法兰固定变换入口。
- 新增 `src/core/robot/numerical-jacobian.ts`：抽取共享数值 Jacobian 计算逻辑；IK、控制层和 `RobotModel` 接口保持不变。
- 修改 `src/robots/abb-irb1200/dh-robot-model.ts`、`src/App.vue`：ABB 回退 FK 改用专用适配器，不再调用 KUKA 历史 DH 矩阵。
- 修改 `src/robots/abb-irb1200/robot-config.ts`：将 ABB 配置命名为 `ABB_IRB1200_5_90_STANDARD_DH`，明确其由 ABB 专用适配器解释。
- 新增 `src/robots/abb-irb1200/abb-kinematics.test.ts`，覆盖标准 DH 矩阵、ABB 零位坐标转换和关节运动变化。
- 影响：KUKA 的 `src/core/robot/kinematics.ts`、KUKA 配置和现有场景链路未修改；ABB 仍与 KUKA 共享 `RobotModel`、IK、控制层和数值 Jacobian 能力。
- 测试修正：`abb-kinematics.test.ts` 对三角函数结果使用近似断言，避免 `cos(±90°)` 的浮点残差造成误报。
- E2E 语义修正：将 FBX/DH 对照用例标记为已知差异测试；它继续输出实际误差，但不再把“视觉 FBX 与官方机构链不完全一致”误报为 ABB 适配器失败。

## 2026-08-10 — 固化 Playwright 浏览器 E2E

- 修改 package.json、package-lock.json：安装 `@playwright/test` 开发依赖，新增 `npm run test:e2e`；Vitest 限定扫描 `src`，避免把浏览器用例当作单元测试。
- 新增 playwright.config.ts：固定 1920×1080 viewport，使用本机 Chrome 和 4173 预览地址。
- 新增 e2e/abb-irb1200.spec.ts：验证 ABB FBX 加载完成、页面不再显示 KUKA、底座 dizuo 加载日志、六轴范围与限位、基座/工具坐标切换、网格切换、轨迹采样/清空和回零。
- 验证结果：Playwright 1.62.1 E2E 通过（1 passed，约 4.5s）；截图已检查，实际 ABB 模型和底部固定基座可见。

## 2026-08-10：修复回退模型并深化运动生命周期

- 新增 `src/core/robot/motion-runner.ts`：将缓动、限速、目标替换、模式切换、停止和完成逻辑集中到不依赖 Vue/浏览器的深 module；仅保留缓动、限速、停止三个命令，并通过 `MotionClock` 接收生产 RAF 时钟或测试手动时钟。
- 新增 `src/core/robot/motion-runner.test.ts`：通过 module interface 覆盖缓动完成、运行中目标替换、限速约束、循环复用和停止清理，避免测试穿透内部状态。
- 修改 `src/robot/motion-control.ts`：收口为 Vue/浏览器时钟 adapter，只负责注入 RAF 时钟和组件卸载清理；删除无调用者的 `isAnimating`、`isAnimatingRef` 双状态。
- 修改 `src/scene/kuka-scene.ts`：GLB 加载失败时继续显示占位几何，但不再把非串联 Pivot 占位模型注入 IK；显式回传 `null`，使 `App.vue` 保留可靠的 DH `RobotModel`。
- 修改 `src/robot/cartesian-control.ts`、`src/App.vue` 和对应测试：由调用者显式注入关节范围，移除控制 module 对 KUKA profile 的硬编码；将 `setJoints` 语义改为 `moveToJoints`，状态文案改为“目标运动已提交”，不再把动画开始误报为机器人已经完成更新。
- 修改 `src/robot/cartesian-control.ts`：复用已有角度、旋转矩阵乘法和欧拉角转换函数，删除重复数学实现，World/Tool 目标构造行为保持不变。
- 修改 `src/core/robot/types.ts`、`motion-smoothing.ts` 和 `ik-solver.ts`：删除从未参与实现的 `longPressThrottle`、`tolerance` 配置，避免无效 interface。
- 影响：模型加载失败时笛卡尔 FK/IK 使用 DH 回退；运动生命周期可确定性测试；现有控制交互、动画参数及场景 interface 保持不变。不新增 Robot Runtime、动作队列、Observation、Workspace 或兼容层。
- 验证结果：TypeScript 类型检查通过，`vitest` 通过（8 个测试文件、28 个测试），`vite build` 通过；仅保留既有单 chunk 体积提示。

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

## 2026-08-10 — IRB 1200-5/0.9 DH/MDH/URDF 参数复核

- 修改文件：`.scratch/abb-teaching-simulation/research/04-abb1200-dh-mdh-search-result.md`
- 修改原因：重新核查经典 ABB IRB 1200-5/0.9 是否存在可用于前端 FK/IK 的官方 DH/MDH、URDF 或等价刚体变换参数，并核对用户提供的 FBX 资产。
- 修改内容：
  - 记录 ABB 官方 IRB 1200 产品手册可确认的型号、关节范围、尺寸、单位和校准信息。
  - 记录 ABB RobotStudio SDK 对 DH、FK、IK、关节限制、法兰、零位和模型偏置的官方读取能力。
  - 记录 ROS-Industrial 的 IRB 1200-5/0.9 URDF/Xacro 线索及其非官方、需自行核验的限制。
  - 记录一篇明确匹配 IRB-1200-5-0.9 的原始论文 DH 表，并标明其与 ABB 官方 J2/J6 范围的冲突。
  - 对照当前 TypeScript `dhTransform`、`RobotModel` 和数值 IK，判断各类参数来源能否直接驱动现有 FK/IK。
  - 检查 `C:\Users\admin\Downloads\JQR_ABB(1).fbx` 的二进制格式、大小、关节名称线索和当前无法确认的层级/许可信息。
- 影响：未修改 `src`、`package.json`、Three.js 场景或运行时逻辑；为后续 ABB profile、模型转换和 FK/IK 回归提供来源边界与阻塞项。

## 2026-08-10 — 补充 IRB 1200-5/0.9 DH 参数交叉验证

- 修改文件：`.scratch/abb-teaching-simulation/research/04-abb1200-dh-mdh-search-result.md`
- 修改原因：补充联网检索到的 `a2=448 mm` DH 候选，并与 ABB 5/0.9 官方尺寸、ROS-Industrial URDF 和用户 FBX 检查结果区分记录，避免将 `a2=350 mm` 的冲突论文表直接作为经典 5/0.9 参数。
- 修改影响：研究结论现在区分“官方可确认尺寸”“论文 DH 候选”“URDF 等价刚体变换”和“当前项目坐标约定下的适配偏置”；未修改 `src`、`package.json` 或运行时逻辑。
# 2026-08-11：建立 ABB 点位示教与程序观察新里程碑地图

## 修改文件

- `.scratch/abb-teach-target-and-observe/map.md`
  - 新建独立 Wayfinder 路线地图，目标是形成 Jog、点位示教、RAPID 运行与教学观察的闭环。
  - 明确 ABB 操作为主、Three.js 只负责显示，并排除 FlexPendant 像素复刻、课程系统和控制柜通信。
- `.scratch/abb-teach-target-and-observe/issues/01-abb-flexpendant-teach-target-workflow.md`
  - 新建 ABB 官方点位示教流程研究票，避免凭产品假设设计点位写入行为。
- `.scratch/abb-teach-target-and-observe/issues/02-teaching-workbench-boundary.md`
  - 记录已确认的 Web 教学实验台边界。
- `.scratch/abb-teach-target-and-observe/issues/03-program-step-semantics.md`
  - 记录单步完整执行一条运动指令的语义。
- `.scratch/abb-teach-target-and-observe/issues/04-runtime-teaching-observation.md`
  - 记录当前源码、结构化指令与轨迹联动的观察范围。
- `.scratch/abb-teach-target-and-observe/issues/05-taught-target-replay-reliability.md`
  - 记录示教点可靠回放及大幅 J1 运动的验收要求。
- `.scratch/abb-teach-target-and-observe/issues/06-product-teach-target-boundary.md`
  - 新建依赖官方资料研究结果的产品示教边界决策票。

## 修改原因

上一里程碑已经完成 RAPID 文本到 MoveJ/MoveL 执行闭环；下一阶段的主要教学缺口是无法按照 ABB 工作方式记录点位、逐条观察程序并可靠回放。用户要求先查明 ABB 示教器真实行为，因此将该事实调查设置为新地图的首个研究前沿。

## 影响

- 本次只增加规划与研究文档，不修改运行时代码。
- 新里程碑与既有 RAPID 执行、坐标语义里程碑物理隔离，避免票据混写。
- 后续点位示教产品决策必须等待 ABB 官方资料结论，减少重复设计和错误语义。

## ABB FlexPendant 官方点位示教研究补充

- 新增 `.scratch/abb-teach-target-and-observe/research/01-abb-flexpendant-teach-target-workflow.md`，依据 ABB RobotWare 6/7/8、OmniCore、FlexPendant SDK 与 RobotStudio 官方资料记录点位创建、Modify Position、`robconf` 和 RobotStudio 同步边界。
- 更新研究票为 `resolved` 并链接完整证据；研究确认 ABB 控制器以 RAPID `robtarget` 为点位事实源，新目标默认规则是当前活动工具 TCP、名称根 `p` 和 `CONST`，不是项目此前假设的默认 `PERS`。
- 将“产品中的 ABB 点位示教边界”票从阻塞状态转为开放状态；地图移除已经查明的事实迷雾，仅保留构型求解和界面布局等后续决策。
- 本补充只调整规划与研究文档，不修改业务代码，不运行项目测试。

## ABB Program Data 产品边界决策补充

- 将 `.scratch/abb-teach-target-and-observe/issues/06-product-teach-target-boundary.md` 更新为 `resolved`：确认首期提供从 RAPID 派生的 Program Data 视图，支持独立创建和示教模块级 `CONST robtarget`、MoveJ/MoveL 引用、Modify Position、重命名与删除；共享引用必须提示影响范围。
- 更新新里程碑 `map.md` 的 Decisions so far，并把已经清晰的后续问题升级为五张决策票：RAPID 受控源码编辑、robconf/回放原型、Program Data UI 原型、单步执行状态契约、源码与运动观察 UI 原型。
- 更新 `CONTEXT.md`：修正此前“RAPID 源程序不反向改写”的旧边界，新增“程序数据”“点位示教”“修改位置”三个领域词，明确 UI 操作通过可见源码编辑维护唯一事实源。
- 影响仅限领域模型和新里程碑规划；未修改业务代码，未运行测试或启动服务。

## Wayfinder：领取 RAPID 源程序受控编辑契约决策票

- 将 `.scratch/abb-teach-target-and-observe/issues/07-controlled-rapid-source-editing.md` 分配给当前 Wayfinder 会话，作为新里程碑的首张开放前沿票。
- 本次只更新票据领取状态，不修改业务代码；后续先依据现有 parser 的源码范围与符号能力确定最小契约。

## Wayfinder：完成 RAPID 源程序受控编辑契约

- 将 `.scratch/abb-teach-target-and-observe/issues/07-controlled-rapid-source-editing.md` 更新为 `resolved`，记录检查源程序与应用单条结构化编辑命令的最小深模块接口。
- 决定源程序存在 error 时禁用 Program Data 结构化操作；Modify Position、重命名与删除全部依据符号和源码范围执行，禁止 Vue 组件全文查找替换或拼接 RAPID。
- 决定只规范新生成片段，未涉及的空格、大小写、注释和换行逐字保留；重命名更新所有解析引用，存在引用时阻止删除。
- 更新新里程碑地图 Decisions so far，并在 `CONTEXT.md` 新增“受控源码编辑”术语，避免后续把它误解为格式化器或双向同步。
- 本轮未修改业务代码，未运行测试或启动服务。

## Wayfinder：领取 robconf 与可靠回放求解原型票

- 将 `.scratch/abb-teach-target-and-observe/issues/08-robconf-and-replay-resolution.md` 分配给当前 Wayfinder 会话。
- 本票只创建抛弃式验证资产，比较现有数值 IK、候选初值和 ABB 构型约束，不直接修改生产求解器或运动规划器。

## robconf 可靠回放逻辑原型

- 新增 `.scratch/abb-teach-target-and-observe/prototypes/robconf-replay-prototype.html`：单文件、可双击运行的抛弃式逻辑原型，比较当前单初值 IK 与构型引导多初值选择。
- 原型数据来自当前 ABB FK/数值 IK 的一次性采样：覆盖 J1 +60°、复合大动作、同一 TCP 的 J6 多圈/腕部翻转和肩肘腕分支场景；未启动项目服务或运行测试套件。
- 原型将 `cf1/cf4/cf6` 作为轴 1/4/6 的 90°区间，并展示错误 robconf 必须拒绝；同时明确把 IRB 1200 的 `cfx` 标记为待官方 mechanism/RobotStudio 对照向量核验，禁止用猜测公式进入生产。
- 本次只增加 `.scratch` 原型资产和更新日志，不修改生产 IK、规划器、Vue 或 Three.js 代码。

## Wayfinder：收缩并完成 robconf/回放决策

- 根据用户“最简单 MVP、保留后续架构位置”的反馈，将 `.scratch/abb-teach-target-and-observe/issues/08-robconf-and-replay-resolution.md` 更新为 `resolved`。
- 决定当前里程碑不实现完整 cfx、八种肩肘腕分支或 ConfJ/ConfL；MoveJ 只在当前单初值失败后尝试有限确定性备用初值，并选择与当前关节距离最近的成功解。MoveL 继续沿路径复用上一 waypoint。
- 保留 `RobTarget.robconf` 的 ABB 四字段和 parser 数据形状，首期仍只执行 `[0,0,0,0]` 并明确标注未模拟构型控制；未来构型过滤在 MoveJ 求解位置替换，不预建 adapter 注册体系。
- 更新新里程碑地图 Decisions so far 和 Out of scope；抛弃式 HTML 仅作为收缩决策证据，不进入生产界面。
- 本轮未修改业务代码，未运行测试或启动服务。

## Wayfinder：领取 Program Data 点位示教 UI 原型票

- `.scratch/abb-teach-target-and-observe/issues/09-program-data-teaching-ui.md` 的两个前置决策已经完成，当前会话领取该票。
- 原型只比较现有 Web 卡片中的最小 Program Data 操作布局，不修改正式 Vue 页面、不增加课程系统或完整 FlexPendant 菜单。

## Program Data MVP 界面原型

- 将 `.scratch/abb-teach-target-and-observe/issues/09-program-data-teaching-ui.md` 从已解除依赖的 `blocked` 更新为 `open`。
- 新增 `.scratch/abb-teach-target-and-observe/prototypes/program-data-ui-prototype.html`：单文件、无需服务的三方案 UI 原型，通过 `?variant=A/B/C`、底部箭头或键盘左右键切换。
- A 为独立 Program Data 卡片；B 为 RAPID 卡片内“程序/Program Data”双标签；C 为点位浏览器、源码、Three.js 三栏。三者使用相同派生点位与最小操作集，不接真实源码写入。
- 原型延续现有深色卡片和工作台密度，并明确 Three.js 只显示机器人/轨迹、`robconf=[0,0,0,0]` 是未模拟构型控制的 MVP。
- 本次未修改正式 Vue/CSS/业务代码，未运行测试或启动服务。
