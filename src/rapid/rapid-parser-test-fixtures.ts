/** 诊断测试共用的最小 robtarget 字面量。 */
export const VALID_ROBTARGET_LITERAL = '[[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]'

/** 已包含 main 声明时使用的模块闭合片段。 */
export const MAIN_MODULE_SUFFIX = '\n    PROC main()\n    ENDPROC\nENDMODULE\n'

/** 需要自行拼接 main 声明时使用的模块闭合片段。 */
export const MAIN_MODULE_CLOSING = '\n    ENDPROC\nENDMODULE\n'

/** 含一个有效 p1 和 main 入口的运动诊断前缀。 */
export const MODULE_WITH_P1_MAIN_PREFIX = `MODULE TestModule\n    CONST robtarget p1 := ${VALID_ROBTARGET_LITERAL};\n    PROC main()\n`
