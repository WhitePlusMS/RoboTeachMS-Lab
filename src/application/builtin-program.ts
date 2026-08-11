/**
 * 页面默认 RAPID 源程序；它是示例程序的唯一事实源，运行时由 rapid-parser 解析。
 * 三个目标沿用已经验证可达的 ABB IRB 1200-5/0.9 TCP 位置（毫米）。
 */
export function createBuiltinRapidSource(): string {
  return `MODULE TeachingDemo
    CONST robtarget pApproach := [[551,613,60],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pWork := [[551,613,25],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pRest := [[451,713,120],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];

    PROC main()
        MoveJ pApproach,v200,fine,tool0;
        MoveL pWork,v50,fine,tool0\\WObj:=wobj0;
        MoveJ pRest,v200,fine,tool0;
    ENDPROC
ENDMODULE`
}
