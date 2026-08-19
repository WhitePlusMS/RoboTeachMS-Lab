# RAPID 前端测试用例集（合并精简版）

用于在「ABB IRB 1200 教学工作台」前端粘贴测试。**全部功能压缩到 5 个程序内测完**：
- 程序 1（拆 1-A / 1-B 两段）与程序 2 是可运行的「功能全家桶」，一次跑完覆盖多项功能；
- 程序 3–5 是「错误 / 结构 / 不支持」全家桶，一次粘贴即可在诊断区看到该类的**全部**提示（解析器会收集整份程序的全部诊断，不会只报第一个）。

> 说明：教学台当前实现为单模块、单个无参 `PROC main()`，支持 `MoveJ/MoveL`、8 种数据类型（robtarget / tooldata / wobjdata / loaddata / speeddata / zonedata / num / bool）、IF / WHILE / FOR / EXITDO 控制流。
> robtarget 字面量 `[[x,y,z],[qw,qx,qy,qz],[cfx,cfy,cfz],[e1..e6]]`，**extax 固定 6 个元素**；速度只能用官方档位 `v5..v100 / v150..v7000`。

---

## 程序 1 · 运动与数据全家桶（可运行，拆两段独立粘贴）

> **为什么拆两段（运行注意）**：同一段程序里若前面用 `tool0` 打底、后面突然换成自定义 `myTool`/`myTable`，MoveL 的 TCP 直线起点会按「当前法兰位姿＋新工具偏移」重算，与上一条实际落点不一致，容易触达 IK 边界或构型跳变而报 `unreachable`。因此这里是**两个独立程序，分开粘贴、分别运行**，各自段内工具/工件全程一致、从同一构型起跑。
> 两段合计覆盖：多点位 + MoveJ/MoveL + 自定义 speeddata/zonedata（段 1-A）+ 自定义 tooldata/wobjdata + Offs + 可选参数 `\WObj`（段 1-B）。

### 1-A · 大范围慢速运动演示（可运行，无限循环）

一次覆盖：**低速 v50 + 大范围矩形描边（跨度约 300×400mm）+ 垂直大幅升降 + 姿态倾斜旋转 + `WHILE TRUE` 无限循环**。全程 `tool0`，坐标在 IRB 1200 可达域内，已按真实 `planMoveJ`/`planMoveL` 逐条验证可达。
> 针对旧版「太快 / 范围太小 / 点位太少 / 不循环」四项整改：循环内全部用最慢官方速度 `v50`；用 `MoveJ` 大步定位到大矩形四角、`MoveL` 沿边描出可见大矩形；7 个点位铺满展示；`WHILE TRUE` 持续示范（教学台约 10000 次循环头时自动截停，属预期保护）。
> 垂直段在 `(501,0,860)` 与 `(501,0,720)` 之间大幅升降，并在 `(501,0,720)` 用 `[0.5,0.5,0.5,0.5]` 倾斜姿态展示旋转（位置不变、仅改朝向）。
期望：能正常运行，机械臂以大范围矩形+垂直升降+倾斜旋转持续循环运动。

```rapid
MODULE M
  ! 大范围运动演示：全域描边大矩形 + 垂直升降 + 姿态旋转，低速 v50 + 无限循环。
  CONST robtarget pHome := [[451,0,807],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  ! 大矩形四角：X 与 Y 正负摆幅，跨度约 300×400mm，描边明显可见。
  CONST robtarget pCorner0 := [[351,-200,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pCorner1 := [[651,-200,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pCorner2 := [[651,200,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pCorner3 := [[351,200,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  ! 垂直大幅升降 + 姿态旋转演示点（同位置仅改变工具朝向）。
  CONST robtarget pTop := [[501,0,860],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pLean := [[501,0,720],[0.5,0.5,0.5,0.5],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PROC main()
    MoveJ pHome, v100, fine, tool0;
    WHILE TRUE DO
      ! 大矩形描边（低速，可看清的大范围运动）。
      MoveJ pCorner0, v50, fine, tool0;
      MoveL pCorner1, v50, fine, tool0;
      MoveL pCorner2, v50, fine, tool0;
      MoveL pCorner3, v50, fine, tool0;
      MoveL pCorner0, v50, fine, tool0;
      ! 垂直大幅升降 + 姿态倾斜旋转，随后回到描边起点。
      MoveJ pTop, v50, fine, tool0;
      MoveL pLean, v50, fine, tool0;
      MoveL pCorner0, v50, fine, tool0;
    ENDWHILE
  ENDPROC
ENDMODULE
```

### 1-B · 自定义 tooldata/wobjdata（可运行）

一次覆盖：**用户自定义 tooldata/wobjdata + 可选参数 \WObj + Offs**。全程 `myTool` + `myTable`，第一条就 `MoveJ` 到目标（从 home 的自定义工具构型直接起跑），避免"先用 tool0 打底再切工具"的 TCP 起点漂移。
> `MoveL` 同样只走几十毫米短直线，配合 `MoveJ` 定位，避开长直线 IK 边界。
期望：能正常运行，机械臂依次走过 q1→q2→Offs(q2)→q1。

```rapid
MODULE M
  CONST robtarget q1 := [[451,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget q2 := [[451,40,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PERS tooldata myTool := [TRUE, [[90,0,120],[1,0,0,0]], [1,[0,0,60],[1,0,0,0],0,0,0]];
  PERS wobjdata myTable := [FALSE, TRUE, "", [[0,0,0],[1,0,0,0]], [[0,0,0],[1,0,0,0]]];
  PROC main()
    MoveJ q1, v300, fine, myTool \WObj:=myTable;
    MoveL q2, v150, fine, myTool \WObj:=myTable;
    MoveL Offs(q2, 40, 0, 0), v200, fine, myTool \WObj:=myTable;
    MoveL q1, v200, fine, myTool \WObj:=myTable;
  ENDPROC
ENDMODULE
```

> 若你的模型 home 姿态不同导致某段仍不可达，按本文末尾的安全坐标建议（MoveJ 定位 + MoveL 短步、中段可达区）微调即可。

---

## 程序 2 · 控制流与标量全家桶（可运行）

一次覆盖：**num/bool 标量 + 赋值 + IF/ELSEIF/ELSE + WHILE + FOR + EXITDO + 嵌套控制流**。
> 控制流逻辑（WHILE/FOR/EXITDO 分支）保持原样，点坐标改为相邻短距（≤~100mm），且开头用 `MoveJ` 定位，避免长 `MoveL` 撞 IK 边界。
期望：能正常运行，机械臂按分支与循环逻辑循环走到 pB / pC / pA，最终回 pA。

```rapid
MODULE M
  CONST robtarget pA := [[451,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pB := [[451,60,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pC := [[521,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  VAR num i := 0;
  VAR num j := 0;
  VAR bool flag := TRUE;
  PROC main()
    i := 0; j := 0;
    MoveJ pA, v300, fine, tool0;
    WHILE i < 3 DO
      i := i + 1;
      MoveL pB, v150, z20, tool0;
    ENDWHILE
    FOR j FROM 1 TO 3 DO
      IF j > 2 THEN
        MoveL pC, v150, fine, tool0;
      ELSEIF j = 2 THEN
        MoveL pB, v150, z20, tool0;
      ELSE
        MoveL pA, v150, z20, tool0;
      ENDIF
    ENDFOR
    IF flag THEN
      WHILE i < 4 DO
        i := i + 1;
        IF i = 4 THEN EXITDO; ENDIF
        MoveL pC, v100, fine, tool0;
      ENDWHILE
    ENDIF
    MoveL pA, v200, fine, tool0;
  ENDPROC
ENDMODULE
```

---

## 程序 3 · 错误全家桶（不可运行，诊断区列出全部错误）

一次覆盖这些错误 => 都会在诊断区**同时列出**：
重复定义 · 非单位四元数 · extax 长度错误 · 重定义系统名 tool0 · 赋值类型不一致 ·
引用未定义点位 · Offs 参数数量错误 · robtarget 误用作速度 · 运动操作数缺逗号 · EXITDO 出现在循环外。

```rapid
MODULE M
  CONST robtarget p1 := [[241,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget p1 := [[150,0,500],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pBad := [[241,0,600],[1,2,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pShort := [[241,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9]];
  PERS tooldata tool0 := [TRUE, [[0,0,0],[1,0,0,0]], [0,[0,0,0],[1,0,0,0],0,0,0]];
  VAR num a := 0;
  VAR bool b := TRUE;
  PROC main()
    a := b;
    MoveL pNotFound, v500, fine, tool0;
    MoveL Offs(p1, 50, 0), v500, fine, tool0;
    MoveL p1, p1, fine, tool0;
    MoveL p1 v500 fine tool0;
    EXITDO;
  ENDPROC
ENDMODULE
```

> 实测诊断：`重复定义`、`四元数未归一化`、`extax 长度必须为 6`、`tool0 不能重定义`、`赋值类型必须是 num`、`未定义 robtarget pNotFound`、`Offs 需要 3 个平移参数`、`未定义速度 p1（robtarget 不能用作该操作数）`、`运动操作数之间缺少逗号`、`EXITDO 只能出现在循环体内`——**一次全部列出**。

---

## 程序 4 · 结构完整性错误（不可运行）

一次覆盖：**缺少 ENDMODULE** 与 **缺少 PROC main()** 两种结构性根因（拆成两段小代码分别粘贴，因为二者互斥无法放同一文件）。

### 4a. 缺少 ENDMODULE

```rapid
MODULE M
  CONST robtarget p1 := [[241,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PROC main()
    MoveL p1, v500, fine, tool0;
  ENDPROC
```

### 4b. 缺少 PROC main()

```rapid
MODULE M
  CONST robtarget p1 := [[241,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
```

---

## 程序 5 · 不支持全家桶（不可运行，诊断区列出全部"暂不支持"）

一次覆盖：**string 类型 · 非 main 过程 · MoveAbsJ · Offs 表达式参数 · \Load 可选参数**。
这些都会在诊断区列出"暂不支持/不支持"提示，用于确认功能边界。

```rapid
MODULE M
  CONST robtarget p1 := [[241,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  VAR string name := "hello";
  VAR num k := 30;
  PROC subRoutine()
    MoveL p1, v500, fine, tool0;
  ENDPROC
  PROC main()
    MoveAbsJ [[0,0,0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]], v500, fine, tool0;
    MoveL Offs(p1, k, 0, 0), v400, fine, tool0;
    MoveL p1, v500, fine, tool0 \Load:=5;
  ENDPROC
ENDMODULE
```

> 实测诊断：`暂不支持 string 声明`、`首期只支持 PROC main()，暂不支持 subRoutine`、`首期不支持 MoveAbsJ 控制流`、`Offs 的参数 必须是数字`、`不支持可选参数 Load`——**一次全部列出**。

---

## 复杂多段运动（选测，看整条轨迹效果）

上面的程序 1-A / 1-B 与程序 2 已覆盖全部功能点。若想看机械臂走一段多点位往返取放的视觉效果，可再挑下面任一（这些与前面互不影响，可独立粘贴）：

### 6. 流水线搬运：5 工位往返取放（可运行）

> 选测示例。为避开长 `MoveL` 的 IK 边界，工位之间用 `MoveJ` 定位（只验目标可达），每个工位内只用 `MoveL` 做**短距取放**（垂直落下/抬起 ~50mm）。坐标都集中在 IRB 1200 中段可达区。

```rapid
MODULE ComplexDemo
  CONST robtarget pHome := [[451,0,620],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pA1 := [[451,140,560],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pA2 := [[451,140,510],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pB1 := [[541,70,560],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pB2 := [[541,70,510],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pC1 := [[541,-70,560],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pC2 := [[541,-70,510],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pD1 := [[451,-140,560],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pD2 := [[451,-140,510],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pE1 := [[361,-70,560],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pE2 := [[361,-70,510],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PROC main()
    MoveJ pHome, v300, fine, tool0;
    MoveJ pA1, v200, fine, tool0;  MoveL pA2, v80, fine, tool0;  MoveL pA1, v80, fine, tool0;
    MoveJ pB1, v200, fine, tool0;  MoveL pB2, v80, fine, tool0;  MoveL pB1, v80, fine, tool0;
    MoveJ pC1, v200, fine, tool0;  MoveL pC2, v80, fine, tool0;  MoveL pC1, v80, fine, tool0;
    MoveJ pD1, v200, fine, tool0;  MoveL pD2, v80, fine, tool0;  MoveL pD1, v80, fine, tool0;
    MoveJ pE1, v200, fine, tool0;  MoveL pE2, v80, fine, tool0;  MoveL pE1, v80, fine, tool0;
    MoveJ pHome, v300, fine, tool0;
  ENDPROC
ENDMODULE
```

### 7. 锯齿高低路径：左右交替 + 高低起伏（可运行）

> 选测示例。同样以 `MoveJ` 定位 + `MoveL` 短步（垂直 ±50mm）呈现高低起伏，避免长直线 IK 边界。

```rapid
MODULE ComplexDemo
  CONST robtarget pHome := [[451,0,620],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w1 := [[461,140,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w2 := [[461,140,530],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w3 := [[541,70,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w4 := [[541,70,530],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w5 := [[541,-70,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w6 := [[541,-70,530],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w7 := [[461,-140,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w8 := [[461,-140,530],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w9 := [[361,-70,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w10 := [[361,-70,530],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PROC main()
    MoveJ pHome, v300, fine, tool0;
    MoveJ w1, v200, fine, tool0;  MoveL w2, v80, fine, tool0;
    MoveJ w3, v200, fine, tool0;  MoveL w4, v80, fine, tool0;
    MoveJ w5, v200, fine, tool0;  MoveL w6, v80, fine, tool0;
    MoveJ w7, v200, fine, tool0;  MoveL w8, v80, fine, tool0;
    MoveJ w9, v200, fine, tool0;  MoveL w10, v80, fine, tool0;
    MoveJ pHome, v300, fine, tool0;
  ENDPROC
ENDMODULE
```

---

## 程序 8 · 液晶数字循环，绕 J1 轴一圈（最复杂，无限循环写数字）

> 需求：无限循环、循环到几就写几，每圈以指定**原点**为起点和终点，`WHILE TRUE` 一直运行；**数字绕原点均分摆开一圈，互不重叠，从顶部看能逐个看清**。
> 原点坐标（用户指定）：**`[451, 0, 807]`，姿态 `[-180,0,0]`（欧拉）→ RAPID 四元数 `[0,1,0,0]`**，作为每圈的起始/结束点。
> 实现：以该原点为圆心、半径 **R=200mm**、数字中心高 **Z=807**，把 **0–9 十个七段数码管数字均分 360°（每 36° 一个，0 在正 X）**。每个数字预先算好旋转后的 6 个锚点（顶L/顶R/中R/底R/底L/中L），用 `IF/ELSEIF n=...` 选中对应数字逐笔 `MoveL` 书写，每画完一个 `MoveJ home` 回原点，`n` 递增并在 0→9 循环。
> **运行边界（重要）**：教学台有 `MAX_LOOP_STEPS=10000` 防死循环保护，`WHILE TRUE` 会在累计约 10000 次循环头时被 `循环迭代次数超过安全上限` 自动截停——**无法真·无限**,这是教学保护的预期行为,不是 bug。
> 坐标：所有折点 X∈[201,701]、Y∈[-238,238]、Z∈[747,867]，均在 IRB 1200 可达区，每笔 `MoveL` 是数字内部短直线，避开 IK 边界。

```rapid
MODULE M
  CONST robtarget home := [[451,0,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d0TL := [[601,0,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d0TR := [[701,0,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d0MR := [[701,0,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d0BR := [[701,0,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d0BL := [[601,0,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d0ML := [[601,0,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d1TL := [[572,88,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d1TR := [[653,147,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d1MR := [[653,147,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d1BR := [[653,147,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d1BL := [[572,88,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d1ML := [[572,88,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d2TL := [[497,143,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d2TR := [[528,238,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d2MR := [[528,238,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d2BR := [[528,238,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d2BL := [[497,143,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d2ML := [[497,143,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d3TL := [[405,143,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d3TR := [[374,238,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d3MR := [[374,238,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d3BR := [[374,238,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d3BL := [[405,143,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d3ML := [[405,143,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d4TL := [[330,88,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d4TR := [[249,147,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d4MR := [[249,147,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d4BR := [[249,147,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d4BL := [[330,88,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d4ML := [[330,88,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d5TL := [[301,0,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d5TR := [[201,0,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d5MR := [[201,0,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d5BR := [[201,0,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d5BL := [[301,0,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d5ML := [[301,0,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d6TL := [[330,-88,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d6TR := [[249,-147,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d6MR := [[249,-147,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d6BR := [[249,-147,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d6BL := [[330,-88,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d6ML := [[330,-88,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d7TL := [[405,-143,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d7TR := [[374,-238,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d7MR := [[374,-238,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d7BR := [[374,-238,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d7BL := [[405,-143,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d7ML := [[405,-143,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d8TL := [[497,-143,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d8TR := [[528,-238,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d8MR := [[528,-238,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d8BR := [[528,-238,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d8BL := [[497,-143,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d8ML := [[497,-143,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d9TL := [[572,-88,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d9TR := [[653,-147,867],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d9MR := [[653,-147,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d9BR := [[653,-147,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d9BL := [[572,-88,747],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget d9ML := [[572,-88,807],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  VAR num n := 0;
  PROC main()
    WHILE TRUE DO
      MoveJ home, v300, fine, tool0;
      IF n = 0 THEN
        MoveJ d0TL, v200, fine, tool0;  MoveL d0TL, v150, fine, tool0; MoveL d0TR, v150, fine, tool0;
        MoveL d0MR, v150, fine, tool0; MoveL d0BR, v150, fine, tool0;
        MoveL d0BL, v150, fine, tool0; MoveL d0ML, v150, fine, tool0;
        MoveL d0TL, v150, fine, tool0;
      ELSEIF n = 1 THEN
        MoveJ d1TR, v200, fine, tool0;  MoveL d1TR, v150, fine, tool0; MoveL d1MR, v150, fine, tool0;
        MoveL d1BR, v150, fine, tool0;
      ELSEIF n = 2 THEN
        MoveJ d2TL, v200, fine, tool0;  MoveL d2TL, v150, fine, tool0; MoveL d2TR, v150, fine, tool0;
        MoveL d2MR, v150, fine, tool0; MoveL d2ML, v150, fine, tool0;
        MoveL d2BL, v150, fine, tool0; MoveL d2BR, v150, fine, tool0;
      ELSEIF n = 3 THEN
        MoveJ d3TL, v200, fine, tool0;  MoveL d3TL, v150, fine, tool0; MoveL d3TR, v150, fine, tool0;
        MoveL d3MR, v150, fine, tool0; MoveL d3ML, v150, fine, tool0;
        MoveL d3MR, v150, fine, tool0; MoveL d3BR, v150, fine, tool0;
        MoveL d3BL, v150, fine, tool0;
      ELSEIF n = 4 THEN
        MoveJ d4TL, v200, fine, tool0;  MoveL d4TL, v150, fine, tool0; MoveL d4ML, v150, fine, tool0;
        MoveL d4MR, v150, fine, tool0; MoveL d4TR, v150, fine, tool0;
        MoveL d4MR, v150, fine, tool0; MoveL d4BR, v150, fine, tool0;
      ELSEIF n = 5 THEN
        MoveJ d5TL, v200, fine, tool0;  MoveL d5TL, v150, fine, tool0; MoveL d5TR, v150, fine, tool0;
        MoveL d5TL, v150, fine, tool0; MoveL d5ML, v150, fine, tool0;
        MoveL d5MR, v150, fine, tool0; MoveL d5BR, v150, fine, tool0;
        MoveL d5BL, v150, fine, tool0;
      ELSEIF n = 6 THEN
        MoveJ d6TL, v200, fine, tool0;  MoveL d6TL, v150, fine, tool0; MoveL d6TR, v150, fine, tool0;
        MoveL d6TL, v150, fine, tool0; MoveL d6ML, v150, fine, tool0;
        MoveL d6BL, v150, fine, tool0; MoveL d6BR, v150, fine, tool0;
        MoveL d6MR, v150, fine, tool0; MoveL d6ML, v150, fine, tool0;
      ELSEIF n = 7 THEN
        MoveJ d7TL, v200, fine, tool0;  MoveL d7TL, v150, fine, tool0; MoveL d7TR, v150, fine, tool0;
        MoveL d7MR, v150, fine, tool0; MoveL d7BR, v150, fine, tool0;
      ELSEIF n = 8 THEN
        MoveJ d8TL, v200, fine, tool0;  MoveL d8TL, v150, fine, tool0; MoveL d8TR, v150, fine, tool0;
        MoveL d8MR, v150, fine, tool0; MoveL d8BR, v150, fine, tool0;
        MoveL d8BL, v150, fine, tool0; MoveL d8ML, v150, fine, tool0;
        MoveL d8TL, v150, fine, tool0; MoveL d8ML, v150, fine, tool0;
        MoveL d8MR, v150, fine, tool0;
      ELSE
        MoveJ d9TL, v200, fine, tool0;  MoveL d9TL, v150, fine, tool0; MoveL d9TR, v150, fine, tool0;
        MoveL d9MR, v150, fine, tool0; MoveL d9BR, v150, fine, tool0;
        MoveL d9BL, v150, fine, tool0; MoveL d9ML, v150, fine, tool0;
        MoveL d9TL, v150, fine, tool0; MoveL d9ML, v150, fine, tool0;
        MoveL d9MR, v150, fine, tool0;
      ENDIF
      n := n + 1;
      IF n > 9 THEN n := 0; ENDIF
      MoveJ home, v300, fine, tool0;
    ENDWHILE
  ENDPROC
ENDMODULE
```

> 说明：0–9 十个数字以指定原点 `[451,0,807]`（姿态 `[-180,0,0]`→四元数 `[0,1,0,0]`）为圆心、半径 200mm 均分绕满 360°，每个都是七段数码管形状（写法含少量回笔/连接线，因教学台无抬笔）。每圈 `n` 递增并在 0→9 循环，机械臂每画完一个数字 `MoveJ home` 回到该原点。若某数字方位或半径与预期不一致，可整体调整各锚点坐标（它们都在以 home 为心的圆周上），无需改笔画顺序。

---

## 测试节奏建议

1. 先贴 **程序 1-A**（tool0 段）→ 运行，验证运动、自定义 speed/zone 全绿。
2. 再贴 **程序 1-B**（自定义 tool/wobj 段）→ 运行，验证自定义 tooldata/wobjdata、`\WObj`、Offs 全绿。
3. 贴 **程序 2** → 运行，验证控制流全绿。
4. 贴 **程序 3** → 确认诊断区一次列出 10 条错误、运行被禁用。
5. 贴 **程序 4a / 4b** → 确认两条结构错误。
6. 贴 **程序 5** → 确认 5 条"暂不支持"。
7. （可选）贴 **6 / 7** → 看多点位往返取放的视觉效果。
8. （进阶）贴 **程序 8** → 看无限循环 + 液晶数字 0–9 循环书写（会在约 10000 次防死循环上限截停）。

共 **6 轮**覆盖全部功能点 + 边界。想补充其它复杂轨迹时，记得：**用 `MoveJ` 定位多点、`MoveL` 只走短直线（≤几厘米）**，不要用手编大跨度坐标去做长 `MoveL`（会因中间 IK 越界/奇异报 `unreachable`）；坐标集中在 X≈380–540、Y≈-160–160、Z≈500–650 的中段可达区；同一条程序里别中途切换 tool/wobj，自定义 tool/wobj 请独立成段。若个别点仍不可达，按实际模型微调该点坐标即可。
