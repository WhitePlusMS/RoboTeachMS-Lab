import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const sourceRoot = join(process.cwd(), 'src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') || path.endsWith('.vue') ? [path] : []
  })
}

function productionSource(): Array<{ path: string; content: string }> {
  return sourceFiles(sourceRoot)
    .filter((path) => !path.endsWith('.test.ts'))
    .map((path) => ({ path: relative(sourceRoot, path).replaceAll('\\', '/'), content: readFileSync(path, 'utf8') }))
}

describe('静态架构门禁', () => {
  it('生产代码不存在被删除的双轨运动入口', () => {
    const files = productionSource()
    expect(files.some(({ content }) => /commitPlan\s*\(/.test(content))).toBe(false)
    expect(files.some(({ content }) => /corePlan\??\s*[:=]/.test(content))).toBe(false)
    expect(files.some(({ content }) => /planMove[ JLC]/.test(content))).toBe(false)
  })

  it('planMotion 生产调用只位于 Core 与 Worker adapter 边界', () => {
    const allowed = new Set([
      'robot-motion-core/planner.ts',
      'infrastructure/motion-worker/worker.ts',
      'infrastructure/motion-worker/adapter.ts',
    ])
    const calls = productionSource().filter(({ content }) => /\bplanMotion\s*\(/.test(content))
    expect(calls.every(({ path }) => allowed.has(path))).toBe(true)
  })

  it('Core 不反向依赖旧 Cartesian 业务入口，宿主不直接规划', () => {
    const files = productionSource()
    const coreFiles = files.filter(({ path }) => path.startsWith('robot-motion-core/'))
    expect(coreFiles.some(({ content }) => /robotics\/cartesian/.test(content))).toBe(false)
    expect(files.some(({ content }) => /motionPlanner\.plan\s*\(/.test(content))).toBe(false)
  })

  it('RAPID runtime 与 language 模块不依赖 Vue', () => {
    const files = productionSource().filter(({ path }) => path.startsWith('rapid/runtime/') || path.startsWith('rapid/language/'))
    expect(files.some(({ content }) => /from ['"]vue['"]/.test(content))).toBe(false)
  })

  it('RAPID parser 按真实语言职责委托到内部强类型模块', () => {
    const files = productionSource()
    const parser = files.find(({ path }) => path === 'rapid/language/parser/rapid-parser.ts')
    const paths = new Set(files.map(({ path }) => path))
    for (const path of [
      'rapid/language/parser/data-declaration.ts',
      'rapid/language/parser/target-expression.ts',
      'rapid/language/parser/motion-statement.ts',
      'rapid/language/parser/statement-parser.ts',
      'rapid/language/parser/control-flow-parser.ts',
    ]) {
      expect(paths.has(path)).toBe(true)
    }
    expect(parser?.content).toMatch(/parseDataDeclarationStatement/)
    expect(parser?.content).toMatch(/parseMotionStatement/)
    expect(parser?.content).toMatch(/parseStatementListStatement/)
    expect(parser?.content).toMatch(/parseConditionalStatement/)
    expect(parser?.content).not.toMatch(/parseFiniteNumber|parseDataValue/)
  })

  it('Core barrel 不暴露宿主 request helper 或内部规划函数', () => {
    const barrel = readFileSync(join(sourceRoot, 'robot-motion-core/index.ts'), 'utf8')
    expect(barrel).not.toMatch(/createCartesianTargetRequest|targetFlangePose|\bfromPose\b/)
    expect(barrel).not.toMatch(/solvePoseWaypoints|resolveJointSolution|planCartesianPath/)
  })

  it('连续 latest-only 与 Runner transport 只由 Coordinator 承担', () => {
    const files = productionSource()
    const coordinator = files.find(({ path }) => path === 'application/motion-coordinator.ts')
    const worker = files.find(({ path }) => path === 'infrastructure/motion-worker/adapter.ts')
    expect(coordinator?.content).toMatch(/continuous-begin/)
    expect(coordinator?.content).toMatch(/continuous-update/)
    expect(coordinator?.content).toMatch(/continuous-end/)
    expect(coordinator?.content).toMatch(/pendingContinuous/)
    expect(worker?.content).not.toMatch(/pending/)
    expect(files.filter(({ path, content }) => path !== 'robot-geometry/motion/runner.ts' && /\b(runEased|runTrajectory|appendTrajectory|runSpeedLimited)\s*\(/.test(content)).every(({ path }) => path === 'application/motion-coordinator.ts')).toBe(true)
  })
})
