import { describe, expect, it } from 'vitest'
import { parseRapidProgram } from '../language/index.ts'
import { createRapidRuntime } from './index.ts'

describe('RapidRuntime', () => {
  it('在无 Vue 环境执行表达式、条件和变量写入', async () => {
    const parsed = parseRapidProgram(`
MODULE RuntimeTest
    VAR num count := 0;
    PROC main()
        count := 1 + 2 * 3;
        IF count > 5 THEN
            count := count + 1;
        ELSE
            count := 0;
        ENDIF
    ENDPROC
ENDMODULE`)
    expect(parsed.canExecute).toBe(true)
    const runtime = createRapidRuntime({
      currentJoints: () => [0, 0, 0, 0, 30, 0],
      submit: async () => ({ ok: true, result: 'completed' }),
      stop: () => undefined,
    })
    const executor = runtime.load(parsed.program, 0, new Map([['count', { kind: 'num', value: 0 }]]))

    await expect(executor.run()).resolves.toBe('completed')
    expect(executor.getSnapshot().variables.get('count')).toEqual({ kind: 'num', value: 8 })
  })
})
