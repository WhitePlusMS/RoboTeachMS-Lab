import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const sourceRoot = join(process.cwd(), 'src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : path.endsWith('.ts') || path.endsWith('.vue')
        ? [path]
        : []
  })
}

function productionSource(): Array<{ path: string; content: string }> {
  return sourceFiles(sourceRoot)
    .filter((path) => !path.endsWith('.test.ts'))
    .map((path) => ({
      path: relative(sourceRoot, path).replaceAll('\\', '/'),
      content: readFileSync(path, 'utf8'),
    }))
}

describe('静态架构门禁', () => {
  it('几何层只依赖自身和数学库，核心不依赖 RAPID 或 Web 宿主', () => {
    for (const file of productionSource()) {
      if (!/^(robot-geometry|robot-motion-core)\//.test(file.path)) continue
      for (const match of file.content.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)) {
        const specifier = match[1]!
        const target = specifier.startsWith('@/')
          ? specifier.slice(2)
          : specifier.startsWith('.')
            ? relative(sourceRoot, resolve(sourceRoot, dirname(file.path), specifier)).replaceAll(
                '\\',
                '/',
              )
            : specifier
        const forbidden = file.path.startsWith('robot-geometry/')
          ? /^(robot-motion-core|robot-models|rapid|application|scene|infrastructure|components)\//
          : /^(rapid|application|scene|infrastructure|components)\//
        expect(target, `${file.path} -> ${target}`).not.toMatch(forbidden)
      }
    }
  })

  it('Web 只在生命周期适配器创建 Runner，唯一关节写入位于状态模块', () => {
    const files = productionSource()
    const creators = files.filter(({ content }) => /\bcreateMotionRunner\s*\(/.test(content))
    expect(creators.map(({ path }) => path).sort()).toEqual([
      'application/motion/use-motion-runner.ts',
      'robot-motion-core/playback/runner.ts',
    ])
    const writers = files.filter(({ content }) => /\bjoints\.value\s*=/.test(content))
    expect(writers.map(({ path }) => path)).toEqual(['application/motion/use-robot-state.ts'])
  })

  it('核心与几何层不依赖宿主框架，RAPID 不直接依赖某个 ABB 机型', () => {
    const files = productionSource()
    const core = files.filter(
      ({ path }) => path.startsWith('robot-motion-core/') || path.startsWith('robot-geometry/'),
    )
    expect(
      core.some(({ content }) =>
        /from ['"](?:vue|three|@\/application|@\/scene|@\/infrastructure)/.test(content),
      ),
    ).toBe(false)
    const rapid = files.filter(({ path }) => path.startsWith('rapid/'))
    expect(rapid.some(({ content }) => /robot-models\/abb-irb1200/.test(content))).toBe(false)
  })

  it('生产代码不存在被删除的双轨运动入口', () => {
    const files = productionSource()
    expect(files.some(({ content }) => /commitPlan\s*\(/.test(content))).toBe(false)
    expect(files.some(({ content }) => /corePlan\??\s*[:=]/.test(content))).toBe(false)
    expect(files.some(({ content }) => /planMove[ JLC]/.test(content))).toBe(false)
  })

  it('planMotion 生产调用只位于 Core 与 Worker adapter 边界', () => {
    const allowed = new Set([
      'robot-motion-core/motion-planner.ts',
      'infrastructure/motion-worker/worker.ts',
      'infrastructure/motion-worker/motion-planner-client.ts',
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
    const files = productionSource().filter(
      ({ path }) => path.startsWith('rapid/runtime/') || path.startsWith('rapid/language/'),
    )
    expect(files.some(({ content }) => /from ['"]vue['"]/.test(content))).toBe(false)
  })

  it('RAPID parser 按真实语言职责委托到内部强类型模块', () => {
    const files = productionSource()
    const parser = files.find(({ path }) => path === 'rapid/language/parser/rapid-parser.ts')
    const paths = new Set(files.map(({ path }) => path))
    for (const path of [
      'rapid/language/parser/data-declaration.ts',
      'rapid/language/parser/target-operand-parser.ts',
      'rapid/language/parser/motion-parser.ts',
      'rapid/language/parser/statement-parser.ts',
      'rapid/language/parser/control-flow-parser.ts',
      'rapid/language/parser/control-flow-lowering.ts',
      'rapid/language/parser/mode-parser.ts',
      'rapid/language/parser/assignment-parser.ts',
      'rapid/runtime/scalar-evaluation.ts',
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
    const coordinator = files.find(
      ({ path }) => path === 'application/motion/motion-coordinator.ts',
    )
    const worker = files.find(
      ({ path }) => path === 'infrastructure/motion-worker/motion-planner-client.ts',
    )
    expect(coordinator?.content).toMatch(/continuous-begin/)
    expect(coordinator?.content).toMatch(/continuous-update/)
    expect(coordinator?.content).toMatch(/continuous-end/)
    expect(coordinator?.content).toMatch(/pendingContinuous/)
    expect(worker?.content).not.toMatch(/pending/)
    expect(
      files
        .filter(
          ({ path, content }) =>
            path !== 'robot-motion-core/playback/runner.ts' &&
            /\b(runEased|runTrajectory|appendTrajectory|runSpeedLimited)\s*\(/.test(content),
        )
        .every(({ path }) => path === 'application/motion/motion-coordinator.ts'),
    ).toBe(true)
  })
})
