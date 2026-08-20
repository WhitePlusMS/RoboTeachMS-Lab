/**
 * 页面默认 RAPID 源程序；它是示例程序的唯一事实源，运行时由 rapid-parser 解析。
 * 三个 robtarget 均为 ABB 基座/机械法兰坐标（毫米、ABB [w,x,y,z] 四元数），
 * 不与 Three.js/FBX 的 joint7 视觉偏移挂钩：pApproach 由非奇异关节姿态
 * [0,-20,20,0,30,0] 正解得到，pWork 沿 ABB 基座 Z 轴向下 50 mm，
 * pRest 由 [0,-15,10,0,25,0] 正解得到。
 */
export function createBuiltinRapidSource(): string {
  return `MODULE TeachingDemo
    CONST robtarget pApproach := [[368.789,0,821.082],[0,0.866025,0,0.5],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pWork := [[368.789,0,771.082],[0,0.866025,0,0.5],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pRest := [[406.727,0,884.937],[0,0.819152,0,0.573576],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];

    PROC main()
        MoveJ pApproach,v200,fine,tool0;
        MoveL pWork,v50,fine,tool0\\WObj:=wobj0;
        MoveJ pRest,v200,fine,tool0;
    ENDPROC
ENDMODULE`
}
