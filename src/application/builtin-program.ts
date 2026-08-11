/**
 * 页面默认 RAPID 源程序；它是示例程序的唯一事实源，运行时由 rapid-parser 解析。
 * 三个 robtarget 均为 ABB 基座/机械法兰坐标（毫米、ABB [w,x,y,z] 四元数），
 * 不与 Three.js/FBX 的 joint7 视觉偏移挂钩：pApproach 为前向接近点，
 * pWork 沿 ABB 基座 Z 轴向下 50mm，pRest 回到近零位休止点。
 */
export function createBuiltinRapidSource(): string {
  return `MODULE TeachingDemo
    CONST robtarget pApproach := [[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pWork := [[451,150,630],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pRest := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];

    PROC main()
        MoveJ pApproach,v200,fine,tool0;
        MoveL pWork,v50,fine,tool0\\WObj:=wobj0;
        MoveJ pRest,v200,fine,tool0;
    ENDPROC
ENDMODULE`
}
