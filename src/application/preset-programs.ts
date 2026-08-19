/**
 * RAPID 预设程序库：教学台 RAPID 标签页可一键加载的默认模板。
 * 内容取自 docs/rapid-frontend-test-cases.md 的可运行示例（1-A / 1-B / 2 / 6 / 7 / 8），
 * 均为「MoveJ 定位 + MoveL 短直线」的安全坐标，可直接运行。
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

const PRESET_PROGRAM_1A = `MODULE M
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

const PRESET_PROGRAM_1B = `MODULE M
  CONST robtarget q1 := [[451,0,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget q2 := [[451,40,600],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PERS tooldata myTool := [TRUE, [[90,0,120],[1,0,0,0]], [1,[0,0,60],[1,0,0,0],0,0,0]];
  PERS wobjdata myTable := [FALSE, TRUE, "", [[0,0,0],[1,0,0,0]], [[0,0,0],[1,0,0,0]]];
  PROC main()
    MoveJ q1, v300, fine, myTool \\WObj:=myTable;
    MoveL q2, v150, fine, myTool \\WObj:=myTable;
    MoveL Offs(q2, 40, 0, 0), v200, fine, myTool \\WObj:=myTable;
    MoveL q1, v200, fine, myTool \\WObj:=myTable;
  ENDPROC
ENDMODULE`

const PRESET_PROGRAM_2 = `MODULE M
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
ENDMODULE`

const PRESET_PROGRAM_6 = `MODULE ComplexDemo
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
ENDMODULE`

const PRESET_PROGRAM_7 = `MODULE ComplexDemo
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
ENDMODULE`

const PRESET_PROGRAM_8 = `MODULE M
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

/** 页面可直接加载的全部预设程序（取自测试用例文档的可运行示例）。 */
export const RAPID_PRESET_PROGRAMS: ReadonlyArray<RapidPresetProgram> = [
  {
    id: 'preset-1a',
    name: '1-A · 大范围慢速运动演示（无限循环）',
    description: '低速 v50 + 大范围矩形描边（300×400mm）+ 垂直升降 + 姿态旋转，WHILE TRUE 无限循环',
    source: PRESET_PROGRAM_1A,
  },
  {
    id: 'preset-1b',
    name: '1-B · 自定义 tool/wobj 全家桶',
    description: '用户自定义 tooldata/wobjdata + 可选参数 \\WObj + Offs',
    source: PRESET_PROGRAM_1B,
  },
  {
    id: 'preset-2',
    name: '2 · 控制流与标量全家桶',
    description: 'num/bool 标量 + IF/ELSEIF/ELSE + WHILE + FOR + EXITDO + 嵌套控制流',
    source: PRESET_PROGRAM_2,
  },
  {
    id: 'preset-6',
    name: '6 · 流水线搬运（5 工位往返取放）',
    description: 'MoveJ 定位 + MoveL 短距取放，多点位往返取放的视觉效果',
    source: PRESET_PROGRAM_6,
  },
  {
    id: 'preset-7',
    name: '7 · 锯齿高低路径（左右交替 + 高低起伏）',
    description: 'MoveJ 定位 + MoveL 短步，展示高低起伏轨迹',
    source: PRESET_PROGRAM_7,
  },
  {
    id: 'preset-8',
    name: '8 · 液晶数字 0–9 循环书写（绕 J1 一圈）',
    description: '无限循环写数字；约 10000 次防死循环上限时自动截停',
    source: PRESET_PROGRAM_8,
  },
]

/** 按 id 取预设；不存在返回 undefined。 */
export function findRapidPreset(id: string): RapidPresetProgram | undefined {
  return RAPID_PRESET_PROGRAMS.find((preset) => preset.id === id)
}
