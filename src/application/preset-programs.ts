/**
 * RAPID 预设程序库：教学台 RAPID 标签页可一键加载的默认模板。
 * 六个预设按「运行能力维度」各代表一类：1 大范围慢速循环、2 自定义工具/工件+Offs、
 * 3 控制流与标量、4 流水线多点位往返取放、5 锯齿高低起伏路径、6 液晶数字 0–9 循环书写。
 * 均以「MoveJ 定位 + MoveL 短直线」的安全坐标编写，已用真实 planMoveJ/planMoveL 逐条验证可达。
 * 表单项只读：六类运动数据、num/bool 标量、IF/WHILE/FOR/EXITDO 控制流等能力全部覆盖。
 * 源码是模板的唯一事实源，运行时由 rapid-parser 解析。
 */

export interface RapidPresetProgram {
  id: string
  /** 展示名（文档程序编号 + 简短说明）。 */
  name: string
  /** 一句话用途描述，放入下拉提示与确认文案。 */
  description: string
  /** 完整 RAPID 源程序。 */
  source: string
}

const PRESET_PROGRAM_1 = `MODULE M
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
ENDMODULE`

const PRESET_PROGRAM_2 = `MODULE M
  ! 自定义工具/工件坐标 + Offs 偏移取放：三站点往返取放，跨度约 330×240mm。
  CONST robtarget pHome := [[451,0,660],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pA := [[531,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pB := [[371,120,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pC := [[371,-120,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PERS tooldata myTool := [TRUE, [[90,0,120],[1,0,0,0]], [1,[0,0,60],[1,0,0,0],0,0,0]];
  PERS wobjdata myTable := [FALSE, TRUE, "", [[0,0,0],[1,0,0,0]], [[0,0,0],[1,0,0,0]]];
  PROC main()
    MoveJ pHome, v300, fine, myTool \\WObj:=myTable;
    ! 站 A：MoveJ 定位，Offs 垂直下降取放。
    MoveJ pA, v200, fine, myTool \\WObj:=myTable;
    MoveL Offs(pA, 0, 0, -70), v80, fine, myTool \\WObj:=myTable;
    MoveL Offs(pA, 0, 0, 0), v80, fine, myTool \\WObj:=myTable;
    ! 站 B：左移后再次 Offs 取放。
    MoveJ pB, v200, fine, myTool \\WObj:=myTable;
    MoveL Offs(pB, 0, 0, -70), v80, fine, myTool \\WObj:=myTable;
    MoveL Offs(pB, 0, 0, 0), v80, fine, myTool \\WObj:=myTable;
    ! 站 C：下移后 Offs 取放。
    MoveJ pC, v200, fine, myTool \\WObj:=myTable;
    MoveL Offs(pC, 0, 0, -70), v80, fine, myTool \\WObj:=myTable;
    MoveL Offs(pC, 0, 0, 0), v80, fine, myTool \\WObj:=myTable;
    MoveJ pHome, v300, fine, myTool \\WObj:=myTable;
  ENDPROC
ENDMODULE`

const PRESET_PROGRAM_3 = `MODULE M
  ! 控制流与标量：IF/ELSEIF/ELSE + WHILE + FOR + EXITDO，用 i/j 在五角间跳转。
  CONST robtarget pA := [[451,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pR := [[581,0,560],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pL := [[361,0,620],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pLD := [[541,-150,540],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pRU := [[541,150,540],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  VAR num i := 0;
  VAR num j := 0;
  VAR bool flag := TRUE;
  PROC main()
    i := 0; j := 0;
    MoveJ pA, v300, fine, tool0;
    ! WHILE ×3：i 每轮按 IF 分支跳到右/左/上角，再回中；跨度约 220×150mm。
    WHILE i < 3 DO
      i := i + 1;
      IF i = 1 THEN
        MoveJ pR, v200, fine, tool0;
      ELSEIF i = 2 THEN
        MoveJ pL, v200, fine, tool0;
      ELSE
        MoveJ pRU, v200, fine, tool0;
      ENDIF
      MoveJ pA, v200, fine, tool0;
    ENDWHILE
    ! FOR ×3：依次访问左下、右上、左角。
    FOR j FROM 1 TO 3 DO
      IF j = 1 THEN
        MoveJ pLD, v200, fine, tool0;
      ELSEIF j = 2 THEN
        MoveJ pRU, v200, fine, tool0;
      ELSE
        MoveJ pL, v200, fine, tool0;
      ENDIF
    ENDFOR
    ! IF + EXITDO：不断前进到右角，i=5 时 EXITDO 退出。
    IF flag THEN
      WHILE i < 6 DO
        i := i + 1;
        IF i = 5 THEN EXITDO; ENDIF
        MoveJ pR, v200, fine, tool0;
        MoveJ pA, v200, fine, tool0;
      ENDWHILE
    ENDIF
    MoveJ pA, v200, fine, tool0;
  ENDPROC
ENDMODULE`

const PRESET_PROGRAM_4 = `MODULE M
  ! 流水线搬运：六工位往返取放，跨度约 300×380mm，全程 tool0。
  CONST robtarget pHome := [[451,0,640],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pA1 := [[451,190,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pA2 := [[451,190,510],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pB1 := [[601,120,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pB2 := [[601,120,510],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pC1 := [[601,-120,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pD1 := [[451,-190,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pD2 := [[451,-190,510],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pE1 := [[301,-120,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pE2 := [[301,-120,510],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pF1 := [[301,120,580],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PROC main()
    MoveJ pHome, v300, fine, tool0;
    MoveJ pA1, v200, fine, tool0;  MoveL pA2, v80, fine, tool0;  MoveL pA1, v80, fine, tool0;
    MoveJ pB1, v200, fine, tool0;  MoveL pB2, v80, fine, tool0;  MoveL pB1, v80, fine, tool0;
    MoveJ pC1, v200, fine, tool0;
    MoveJ pD1, v200, fine, tool0;  MoveL pD2, v80, fine, tool0;  MoveL pD1, v80, fine, tool0;
    MoveJ pE1, v200, fine, tool0;  MoveL pE2, v80, fine, tool0;  MoveL pE1, v80, fine, tool0;
    MoveJ pF1, v200, fine, tool0;
    MoveJ pHome, v300, fine, tool0;
  ENDPROC
ENDMODULE`

const PRESET_PROGRAM_5 = `MODULE M
  ! 锯齿高低路径：左右交替 + 大幅高低起伏，绕回字形一圈，跨度约 260×360mm。
  CONST robtarget pHome := [[451,0,640],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w1  := [[451,180,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w2  := [[451,180,520],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w3  := [[581,110,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w4  := [[581,110,520],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w5  := [[581,-110,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w6  := [[581,-110,520],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w7  := [[451,-180,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w8  := [[451,-180,520],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w9  := [[321,-110,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w10 := [[321,-110,520],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w11 := [[321,110,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget w12 := [[321,110,520],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PROC main()
    MoveJ pHome, v300, fine, tool0;
    MoveJ w1, v200, fine, tool0;  MoveL w2, v80, fine, tool0;
    MoveJ w3, v200, fine, tool0;  MoveL w4, v80, fine, tool0;
    MoveJ w5, v200, fine, tool0;  MoveL w6, v80, fine, tool0;
    MoveJ w7, v200, fine, tool0;  MoveL w8, v80, fine, tool0;
    MoveJ w9, v200, fine, tool0;  MoveL w10, v80, fine, tool0;
    MoveJ w11, v200, fine, tool0; MoveL w12, v80, fine, tool0;
    MoveJ pHome, v300, fine, tool0;
  ENDPROC
ENDMODULE`

const PRESET_PROGRAM_6 = `MODULE M
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
ENDMODULE`

/** 页面可直接加载的全部预设程序：六个预设各代表一个运行能力维度。 */
export const RAPID_PRESET_PROGRAMS: ReadonlyArray<RapidPresetProgram> = [
  {
    id: 'preset-1',
    name: '1 · 大范围慢速运动演示（无限循环）',
    description: '低速 v50 + 大范围矩形描边（300×400mm）+ 垂直升降 + 姿态旋转，WHILE TRUE 无限循环',
    source: PRESET_PROGRAM_1,
  },
  {
    id: 'preset-2',
    name: '2 · 自定义工具/工件 + Offs 偏移取放',
    description: '自定义 tooldata/wobjdata + 可选参数 \\WObj + Offs，三站点往返取放（跨度约 330×240mm）',
    source: PRESET_PROGRAM_2,
  },
  {
    id: 'preset-3',
    name: '3 · 控制流与标量（五角跳转）',
    description: 'num/bool 标量 + IF/ELSEIF/ELSE + WHILE + FOR + EXITDO，控制流驱动五角移动（跨度约 220×150mm）',
    source: PRESET_PROGRAM_3,
  },
  {
    id: 'preset-4',
    name: '4 · 流水线搬运（六工位往返取放）',
    description: 'MoveJ 定位 + MoveL 短距取放，六工位大范围往返（跨度约 300×380mm）',
    source: PRESET_PROGRAM_4,
  },
  {
    id: 'preset-5',
    name: '5 · 锯齿高低路径（左右交替 + 大幅起伏）',
    description: 'MoveJ 定位 + MoveL 短步，绕回字形大幅高低起伏轨迹（跨度约 260×360mm）',
    source: PRESET_PROGRAM_5,
  },
  {
    id: 'preset-6',
    name: '6 · 液晶数字 0–9 循环书写（绕 J1 一圈）',
    description: '无限循环写数字；约 10000 次防死循环上限时自动截停',
    source: PRESET_PROGRAM_6,
  },
]

/** 按 id 取预设；不存在返回 undefined。 */
export function findRapidPreset(id: string): RapidPresetProgram | undefined {
  return RAPID_PRESET_PROGRAMS.find((preset) => preset.id === id)
}
