# 程序数据 / 点位工作流重构实施方案

> 状态：已完成代码事实核验与二次方案审查，可直接进入实施。
>
> 本文档是本次重构的唯一实施依据。实施中若代码事实与本文冲突，先停止修改并更新本文，再继续开发；不得通过兼容分支绕过冲突。

## 1. 目的地与验收结果

本次重构完成后，用户应能在同一套 RAPID 源码事实源上完成以下闭环：

1. 在「程序数据」中连续浏览各类数据，选中条目后原地查看完整字段；robtarget 可示教、编辑 X/Y/Z、重命名、删除和查看引用。
2. 在「RAPID」中添加 MoveJ/MoveL，可选择已有 robtarget，或选择「当前位置 `*`」一次性自动创建 p10/p20…点位并插入运动指令。
3. 停止态编辑后，原 PP 能按既有受控编辑规则稳定保留；无法证明可映射时仍要求 PP to Main。
4. 在程序数据中选中的 robtarget 会在 3D 场景中高亮；不建立第二份点位数据，也不支持场景反向点选。
5. TypeScript、ESLint、Stylelint、单元测试与相关 E2E 全部通过。

## 2. ABB 事实与项目边界

### 2.1 已确认的 ABB 交互事实

- FlexPendant 将 Program Editor、Program Data、Jogging 作为独立功能；本项目现有 RAPID / 数据 / Jog 顶层结构无需调整。
- robtarget 在 Program Data 中管理，可执行 Change Value、Change Declaration、Delete、Copy、Modify Position 等操作。
- Modify Position 使用当前活动机械单元的 TCP 更新 robtarget；真实控制器还会受当前 Tool、WorkObject 与外部轴状态影响。
- ABB 的指令参数规则可为新 robtarget 使用当前 TCP，并以 `p` 为默认名前缀、按 10 递增；本项目采用 p10、p20、p30…。

主要依据：

- [ABB FlexPendant SDK：ModifyPosition](https://developercenter.robotstudio.com/api/fpsdk/html/332780b8-bed3-4569-88a5-56647a432c8b.htm)
- [ABB FlexPendant SDK：Program Data](https://developercenter.robotstudio.com/api/fpsdk/html/0a1de37e-e04b-49c9-98a0-ae08d4f9fd2d.htm)
- [ABB RobotWare Add-ins：robtarget 默认值与命名规则](https://library.e.abb.com/public/f85277a8972446cfa947cbef902ebc58/3HAC070207%20AM%20RobotWare%20Add-Ins%20RW%207-en.pdf)
- ABB《Operating manual - IRC5 with FlexPendant》3HAC050941，章节 Program Data / Editing data instances / Modifying position。

### 2.2 本项目主动收窄的能力

- 非 robtarget 数据本期只读。这是产品范围，不是 ABB 能力限制。
- robtarget 手工数值编辑只开放 trans 的 X/Y/Z；rot、robconf、extax 只读。这是当前运动规划器仅支持 `robconf=[0,0,0,0]` 且不支持外部轴的项目边界，不应写成“ABB 禁止编辑”。
- Modify Position 仍用当前 TCP 的完整 trans + rot，并按现有教学模型生成零 robconf 与未使用 extax。
- 新运动固定使用 `v100,fine,tool0`，本期不增加 Speed、Zone、Tool、WObj 选择。

## 3. 不可破坏的实现约束

1. `parseRapidProgram(source)` 仍是 program、Program Data、诊断和插入锚点的唯一事实源。
2. 所有结构化源码修改只经过 `applyRapidEdit`；组件不得自行拼接 RAPID 源码或计算字符 offset。
3. 一次 `insert-motion` 是原子操作：自动建点和插入指令必须同时成功或同时失败，不允许产生只声明未插指令的中间结果。
4. 不做旧命令兼容。直接修改 `RapidEditCommand` 及所有调用方和测试，让遗漏在 TypeScript 编译阶段暴露。
5. Program Data 的点位选中态只存一份，由 App 持有；ProgramDataPanel 是受控组件。
6. 不修改 WorkbenchLayout 的 `rapid | data | jog` 枚举，也不新增全局 store。
7. 每完成一个实施阶段立即执行 `npm run check`，先修复编译错误，再继续下一阶段。

## 4. 已核实的现状资产

- `src/rapid/controlled-rapid-edit.ts` 已有 `create-target / modify-position / rename-target / delete-target / insert-motion` 五类命令，以及最小文本替换与 `programIndexShift`。
- `src/rapid/rapid-parser.ts` 已暴露 `dataInsertOffset` 和 `motionInsertionPoints`；锚点 `index` 表示该源码 offset 之前的可执行指令数。
- `src/application/program-control.ts` 已通过 `pendingEdit.programIndexShift` 保留停止态 PP。
- `src/components/ProgramDataPanel.vue` 已有 Pose → RobTarget 的 `taughtRobTarget` 桥接。
- `src/App.vue` 的 robtargets computed 与 `SceneViewport -> setRobTargets -> rebuildRobTargets` 已形成自动重建链路。
- `src/application/use-program-panel-controller.ts` 已提供 RAPID / Program Data 工作区所需的共享控制器切片。

## 5. 详细实施规格

### 阶段 A：收紧受控编辑命令并支持“当前位置 `*`”

修改：

- `src/rapid/controlled-rapid-edit.ts`
- `src/rapid/controlled-rapid-edit.test.ts`
- `src/application/program-control.test.ts`

#### A1. 使用判别联合表达目标来源

将现有 `insert-motion` 命令破坏性改为：

```ts
type MotionTargetSelection =
  { source: 'existing'; name: string } | { source: 'current'; target: RobTarget }

type InsertMotionCommand = {
  type: 'insert-motion'
  kind: 'movej' | 'movel'
  insertionIndex: number
  target: MotionTargetSelection
}
```

不得保留旧的顶层 `name`，也不得使用 `teach?`。判别联合必须让以下非法状态无法通过编译：

- “当前位置”却没有 RobTarget；
- “已有点位”同时又携带示教 RobTarget；
- 同一命令中存在两个可能被运动指令引用的名称。

#### A2. 统一名称空间校验

- 将 `validateNewName` 的查重输入从 `robtargetSymbols(parsed)` 扩展为 `parsed.data` 中的全部名称，包含用户 num/bool/tooldata/wobjdata/speeddata/zonedata/loaddata 和系统预定义数据。
- `create-target`、`rename-target`、自动命名三条路径必须共用同一套大小写不敏感查重逻辑。
- 重名错误消息改为通用的“RAPID 名称 xxx 已存在”，不得继续误报成“robtarget xxx 已存在”。
- 查找被修改、重命名、删除或引用的现有目标时仍使用 robtarget 专用查找，不能把“名称查重”和“目标解析”混成一个职责。

#### A3. 自动命名

- 仅 `target.source === 'current'` 时自动命名。
- 从 p10 开始，每次加 10，选择第一个在全名称空间中未占用的名称。
- 比较大小写不敏感；例如 `P10`、`VAR num p20` 均会占用相应候选。
- 已有点位路径严格使用用户选择的名称，不自动重命名。

#### A4. 原子文本替换

1. 先基于同一次 parse 结果验证源程序、目标选择和 insertionIndex。
2. 已有点位路径只生成运动指令替换。
3. 当前位置路径同时生成：
   - `dataInsertOffset` 处的 `CONST robtarget <自动名称> := ...;`
   - 运动锚点 offset 处的 `MoveJ/MoveL <自动名称>,v100,fine,tool0;`
4. 所有替换按 offset 从大到小应用。当前结构中运动 offset 位于 main 内，大于 main 之前的声明 offset，因此实际顺序是先插运动、再插声明。
5. 新片段沿用源文件换行符：包含 CRLF 时用 `\r\n`，否则用 `\n`。`create-target` 同步复用该换行检测，避免混合换行。
6. 任一预检失败直接返回错误，source 逐字不变。

`programIndexShift` 继续返回 `{ at: insertionIndex, delta: 1 }`。新增声明不进入可执行 program，因此不额外增加 delta。

#### A5. 必测场景

- 选择已有点位插入 MoveJ / MoveL。
- 选择当前位置后，在同一次结果中同时出现新声明和引用该声明的运动指令。
- 空名称空间得到 p10；p10/p20 被 robtarget 占用时得到 p30。
- p10 被 `VAR num P10` 占用时跳过；create-target 和 rename-target 也拒绝跨类型重名。
- 自动声明 offset 小于运动 offset 时，最终源码仍可解析且两段位置正确。
- CRLF 源码插入后不引入裸 LF。
- 停止态在 PP 之前插入时旧 PP 右移 1；在 PP 之后插入时旧 PP 不变。
- 无效 insertionIndex、缺失已有目标、源程序有诊断、运行中编辑均失败且源码不变。

#### A6. 复用 Pose → RobTarget 转换

- 在 `controlled-rapid-edit.ts` 现有 `makeEmptyTaughtTarget` 附近增加 `makeTaughtTargetFromPose(pose: Pose): RobTarget`，内部统一完成 rotation matrix → internal quaternion → RAPID quaternion 转换。
- ProgramDataPanel 的 Modify Position / 新建点位和 MotionInstructionToolbar 的“当前位置 `*`”都调用该函数。
- 删除 ProgramDataPanel 中重复的 `rotationMatrixToQuaternion + internalQuatToRapid` 拼装代码；不得在新工具栏再复制一份。
- 为单位旋转和一个非单位旋转各增加转换测试，确认 trans、RAPID 四元数顺序、零 robconf 和未使用 extax。

### 阶段 B：在 RAPID 工作区增加独立的“添加指令”工具栏

新增 / 修改：

- 新增 `src/components/MotionInstructionToolbar.vue`
- 新增 `src/components/MotionInstructionToolbar.test.ts`
- 修改 `src/components/ProgramWorkspace.vue`
- 修改 `src/components/ProgramWorkspace.test.ts`

#### B1. 组件边界

工具栏作为 RAPID tabpanel 内、`ProgramControlPanel display="content"` 之前的同级组件。不要把 `applyEdit / insertionPoints / pose / data` 变成 ProgramControlPanel 的可选 props：顶栏 transport 不需要这些依赖，强塞可选字段会削弱严格类型并混合职责。

`MotionInstructionToolbar` 使用必填 props：

```ts
interface Props {
  snapshot: ProgramControllerSnapshot
  data: readonly RapidProgramData[]
  insertionPoints: readonly RapidMotionInsertionPoint[]
  pose: Pose | null
  applyEdit: (command: RapidEditCommand) => RapidEditResult
}
```

ProgramWorkspace 直接从既有 `ProgramPanelController` 透传；App 顶栏的 ProgramControlPanel 无需改线。

#### B2. UI 与默认值

工具栏顺序固定为：

`目标点选择` → `插入位置` → `添加 MoveJ` → `添加 MoveL`

- 目标点第一项固定为「当前位置 `*`」，并作为初始默认值。
- 后续项只列 `data` 中的 robtarget，显示原始名称。
- 插入位置列出 `motionInsertionPoints` 的全部合法锚点；末项显示「程序末尾」，其余显示“第 N 条之前 · 指令类型 · 行 N”。
- 默认插入点为第一个 `point.index > snapshot.programPointer` 的锚点；不存在时使用最后一个“程序末尾”锚点。
- 当 PP 或锚点列表变化时：当前选择仍合法则保留；失效时才回到上述默认值，避免覆盖用户的手工选择。

#### B3. 按钮状态与错误反馈

按钮仅在以下条件全部满足时可用：

- `snapshot.state !== 'running'`；
- `snapshot.diagnostics.length === 0`；
- 至少有一个 insertionPoint；
- 选择已有点位时，该点位仍存在；
- 选择当前位置时，`pose !== null`。

点击后只构造判别联合命令并调用 `applyEdit`。失败消息在工具栏内显示；成功后清空错误，但保留当前目标和插入点选择，方便连续教学。

#### B4. 插入位置的明确边界

- 当前算法按 parser 暴露的合法锚点工作，不自行解析源码。
- 锚点可能位于 IF/FOR/WHILE 内部；选择该锚点即表示把新运动插入同一源码块。这是本期允许的既有能力，不把嵌套锚点偷偷提升到 main 顶层。
- “当前 PP 之后”只用于计算默认锚点，不作为新的 parser 概念，也不修改 `RapidMotionInsertionPoint`。

#### B5. 必测场景

- 顶栏 transport 不出现添加指令工具栏；RAPID content 出现且 Program Data 不出现。
- 默认目标为当前位置，默认锚点遵守 `index > PP`，没有更后锚点时回退程序末尾。
- 可切换已有点位并生成 `source:'existing'` 命令。
- 当前位置生成 `source:'current'` 命令，target 来自当前 Pose。
- running、有 diagnostics、pose 为空或锚点为空时按钮正确禁用。
- `applyEdit` 拒绝时显示结构化错误。

### 阶段 C：Program Data 改为统一原地展开

修改：

- `src/components/ProgramDataPanel.vue`
- `src/components/ProgramDataPanel.test.ts`
- `src/components/ProgramWorkspace.vue`

#### C1. 删除旧路径

- 删除 `panelView: 'list' | 'detail'`、`openDetails()`、返回列表按钮和 robtarget detail 二级页面。
- 删除 ProgramDataPanel 的 `insertionPoints` prop、`insertionIndex`、`selectedInsertionIndex`、`insertionSelection`、`insertMotion()`、`insertionLabel()`。
- 删除数据页中的“插入位置”“插入 MoveJ”“插入 MoveL”控件及样式。
- ProgramWorkspace 不再向 ProgramDataPanel 传 `insertionPoints`；该数据只传给 MotionInstructionToolbar。

#### C2. 统一列表内容

保留七个 Tab：robtarget、tooldata、wobjdata、speeddata、zonedata、num、bool。

每行常显：

- 公共：名称、存储类别、系统只读标记、引用数。
- robtarget：`x, y, z`。
- tooldata：`tframe.trans`。
- wobjdata：`uframe.trans`。
- speeddata：`v_tcp`。
- zonedata：fine 或 `pzone_tcp`。
- num/bool：声明初值与运行当前值。

点击一行后，在该 `<li>` 内部紧接行按钮原地展开完整字段和引用链接。不同数据类型共用一个展开容器和字段表样式，不再在列表尾部维护独立 detail 区。

再次点击当前已选中的同一行时折叠：robtarget 发出 `select-target(null)`，其他只读类型把本地选择设为 null。该行为是用户主动取消 3D 高亮的唯一面板入口。

#### C3. robtarget 操作

robtarget 展开区依次提供：

1. Modify Position：用当前 `taughtRobTarget` 完整覆盖 trans/rot/robconf/extax，保持现有教学语义。
2. 编辑位置：二级展开 X/Y/Z 三个 number 输入。
3. 重命名。
4. 删除：保留现有三秒二次确认。
5. 查看引用。

“编辑位置”提交规则：

- 打开时从当前选中 target.trans 初始化草稿。
- 三项都必须是非空、有限数字；非法时只显示错误，不调用 applyEdit。
- 提交 `modify-position`，target 为 `{ trans: 新值, rot: 原值, robconf: 原值, extax: 原值 }`。
- 提交成功后收起编辑位置；取消则丢弃草稿。
- 不新增 `update-target` 命令。

#### C4. 480px 宽度策略

- 默认只显示字段表和操作按钮；X/Y/Z 输入仅在“编辑位置”展开后出现。
- 使用 hairline 分隔，不添加嵌套卡片边框。
- 橙色仅表示选中态；当前执行指令使用的条目继续使用现有黄色 active 语义，两者可以同时存在。
- 文本允许换行但名称和状态徽章不竖排。

#### C5. 必测场景

- 七类数据点击后都在自身列表项内展开，不存在“返回列表”。
- 切换选中项时只展开一项。
- 再次点击同一项会折叠；robtarget 同时清空共享选中态。
- robtarget 数值编辑仅改变 trans，rot/robconf/extax 逐项保持。
- 空值、NaN、Infinity 不提交。
- Modify Position 仍提交当前 TCP 的完整姿态。
- 插入运动相关 UI 和命令断言全部从 ProgramDataPanel 测试移除。
- 删除拒绝后当前行仍展开并显示错误；删除成功导致数据消失时清空选择。

### 阶段 D：点位选中态与 3D 高亮

修改：

- `src/application/use-program-panel-controller.ts`
- `src/App.vue`
- `src/components/ProgramWorkspace.vue`
- `src/components/ProgramDataPanel.vue`
- `src/components/ProgramWorkspace.test.ts`
- `src/components/ProgramDataPanel.test.ts`
- `src/scene/abb-scene.ts`
- `src/scene/abb-scene.test.ts`

#### D1. 单一选中态

扩展 `ProgramPanelController`：

```ts
selectedTargetName: ReadonlyRef<string | null>
selectTarget(name: string | null): void
```

- App 持有唯一的 `ref<string | null>(null)`，provide 只读引用和更新方法。
- ProgramWorkspace 向 ProgramDataPanel 传 `selectedTargetName`，并把面板的 `select-target` 事件交给 `controller.selectTarget`。
- ProgramDataPanel 删除本地 `selectedName` ref；`selectedTarget` 完全由 prop 计算，禁止本地/外部双状态。
- 独立挂载 ProgramWorkspace 时，fallback controller 也提供本地 selected ref 和 selectTarget，实现与真实应用一致的受控行为。

清空规则：

- 选中目标从 data 中消失；
- 筛选条件把选中目标排除；
- 从 robtarget Tab 切换到其他数据类型。

在 RAPID / Program Data 顶层视图切换时不主动清空，返回数据页后保留最近选中点位。

#### D2. 场景标记

`AbbRobTargetMarker` 增加 `selected: boolean`，使用必填字段而不是可选字段，避免调用方遗漏状态。

App 的 robtargets computed 对名称做大小写不敏感比较，给每个标记写入 selected。`SceneViewport` 现有 deep watch 继续把完整数组传给 `setRobTargets`，不新增第二条命令通道。

`rebuildRobTargets` 的样式固定为：

- 普通点：半径 `0.02`、emissiveIntensity `0.55`。
- 选中点：半径 `0.03`、emissiveIntensity `1.4`。
- 标签位置使用实际半径计算 gap，避免选中球体放大后与标签重叠。

不增加 raycast、点击事件、动画脉冲或新渲染循环。

#### D3. 必测场景

- ProgramDataPanel 选中 / 清空时发出正确事件，自身不保存第二份名称。
- 重命名成功后共享选中名立即更新为新名称，高亮不闪失；重命名失败时仍保持旧名称。
- ProgramWorkspace fallback 与 provide 两种路径都能更新选中态。
- 场景重建时普通 / 选中半径与 emissiveIntensity 使用上述固定值。

若 `createAbbScene` 的闭包难以直接测试，只允许提取一个返回 `{ radius, emissiveIntensity }` 的纯样式函数供 `abb-scene.test.ts` 验证；不得为了测试暴露整个 Three.js 场景内部结构。

### 阶段 E：E2E、文档与最终门禁

修改：

- `e2e/abb-program.spec.ts`
- `README.md`（如包含旧工作流）
- `CONTEXT.md`（如包含旧工作流）
- `UPDATE_LOG.md`

#### E1. E2E 主闭环

将现有“新建点位→数据页插入 MoveJ”用例改成真正覆盖本次核心路径：

1. 进入 RAPID。
2. 工具栏目标保持默认「当前位置 `*`」。
3. 点击“添加 MoveJ”。
4. 断言源码同时新增 `CONST robtarget p10` 与 `MoveJ p10,v100,fine,tool0;`。
5. 进入 Program Data，断言 p10 存在；选中 p10，切到 RAPID 再返回 Program Data，断言 p10 仍保持选中。Three.js 高亮参数由 D3 的纯样式函数单测验证，E2E 不添加测试专用 DOM 或业务接口。
6. 单步、继续运行至完成，断言总指令数增加 1。
7. Jog 后对 p10 执行 Modify Position，PP to Main 后再次运行成功。

另保留一个选择已有点位添加 MoveL 的组件或 E2E 用例，确保两条判别联合分支都被覆盖。

#### E2. 每阶段验证顺序

每完成 A、B、C、D 中任一阶段，立即执行：

```powershell
npm run check
```

全部完成后依次执行：

```powershell
npm run check
npm run lint
npm run lint:style
npm test
npm run test:e2e
```

不启动 `npm run dev`。E2E 使用项目既有 Playwright webServer 配置；若环境中的前端服务已由用户运行，不另起长期服务。任务结束前只终止本次任务自行启动的进程，不终止用户原有服务。

#### E3. 完成判定

只有同时满足以下条件才能把本文状态改为“已实施”：

- A～E 的文件修改全部完成，旧命令形状和旧数据页插入入口已无引用。
- `rg` 搜索确认不存在 `teach?`、旧 `insert-motion.name` 调用、ProgramDataPanel 的 insertionPoints/panelView 死代码。
- TypeScript、lint、stylelint、单元测试全部通过。
- 核心 E2E 通过；若因外部 WebGL/浏览器环境无法运行，必须在 UPDATE_LOG 中记录具体阻塞和已完成的替代验证，不得写成“视环境运行”。
- README / CONTEXT 与实际交互一致。
- UPDATE_LOG 记录每个阶段的修改文件、原因、影响和验证结果。

## 6. 明确不做

- 非 robtarget 类型的创建、编辑、重命名或删除。
- robtarget 的 rot、robconf、extax 手工数值输入。
- 3D 场景 raycast 反向选择点位。
- Jog 页“存点”按钮。
- Speed、Zone、Tool、WObj 参数选择。
- MoveC、MoveAbsJ 或其他新 RAPID 指令。
- 多任务、多模块、多 routine 插入策略扩展。
- 旧 `insert-motion` 命令形状的兼容适配。

## 7. 实施顺序与提交边界

严格按 A → B → C → D → E 实施：

1. A 先锁定领域命令和原子编辑，避免 UI 建在含糊接口上。
2. B 只迁入添加指令入口，不同时重写数据列表。
3. C 删除旧入口并完成 Program Data 原地展开。
4. D 最后接通跨组件选中态和场景视觉，避免与 C 的局部状态重构交叉。
5. E 统一收口 E2E、文档和门禁。

每个阶段都应能独立通过 `npm run check`。连续两个补丁仍无法通过时，停止叠加补丁，回到本阶段接口重新审视，不进入下一阶段。

## 8. 二次评审结论

本版已修复原方案中的四类关键问题：

- 用判别联合替代含糊的 `name + teach?`，锁定自动建点命令不变量。
- 用独立 MotionInstructionToolbar 替代 ProgramControlPanel 的四个可选 props，保持严格类型和单一职责。
- 明确选中态只有 App 一份，补齐清空规则和 fallback 行为。
- 更正“ABB 禁止编辑 robconf”的错误归因，并补齐高亮、跨类型重名、按钮禁用、CRLF、组件、场景和核心 E2E 测试。

截至本版，没有剩余会改变实现路线的未决策项；实施者可按阶段直接修改业务代码。
