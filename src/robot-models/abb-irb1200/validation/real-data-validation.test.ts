import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { AbbRobotModelAdapter } from '@/robot-models/abb-irb1200/index.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/index.ts'
import { solveIK } from '@/robot-geometry/numerical-ik/numerical-ik.ts'
import { rotationDistanceRad } from '@/robot-geometry/math/rotation3d.ts'
import type { JointAngles, Pose } from '@/robot-geometry/model/index.ts'

interface RpiPoseRecord {
  q_rad: number[]
  p_flange_mm: number[]
  r_flange: number[][]
  p_tcp_mm: number[]
  r_tcp: number[][]
  source?: string
}

const DATA_PATH = join(
  process.cwd(),
  '.scratch/abb-real-trajectory-data/test-data/rpi_real_poses.json',
)

interface RpiCurveRecord {
  source: string
  joints_deg: number[][]
  p_flange_mm: number[][]
  r_flange: number[][][]
}

const CURVE_PATH = join(
  process.cwd(),
  '.scratch/abb-real-trajectory-data/test-data/rpi_curve_js2_exe_poses.json',
)

const CURVE_PLANNED_PATH = join(
  process.cwd(),
  '.scratch/abb-real-trajectory-data/test-data/rpi_curve_js2_planned_subsampled_poses.json',
)

const REAL_DATA_PATHS = [DATA_PATH, CURVE_PATH, CURVE_PLANNED_PATH] as const
const hasRealData = REAL_DATA_PATHS.every((path) => existsSync(path))

function loadJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as T) : fallback
}

const records = loadJson<RpiPoseRecord[]>(DATA_PATH, [])
const emptyCurveRecord: RpiCurveRecord = {
  source: '',
  joints_deg: [],
  p_flange_mm: [],
  r_flange: [],
}
const curveRecord = loadJson<RpiCurveRecord>(CURVE_PATH, emptyCurveRecord)
const plannedRecord = loadJson<RpiCurveRecord>(CURVE_PLANNED_PATH, emptyCurveRecord)

const model = new AbbRobotModelAdapter()

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

function rpiToProjectJoints(qRad: number[]): JointAngles {
  return qRad.map(radToDeg) as JointAngles
}

function positionErrorMm(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

// 真实数据属于本地研究资料，不进入 Git；在 clone/CI 缺少数据时跳过整组验证，
// 避免模块收集阶段因同步读取不存在文件而直接崩溃。
describe.skipIf(!hasRealData)('ABB IRB 1200 真实数据验证', () => {
  beforeAll(() => {
    expect(records.length).toBeGreaterThan(0)
    expect(curveRecord.joints_deg.length).toBeGreaterThan(0)
    expect(curveRecord.joints_deg.length).toBe(curveRecord.p_flange_mm.length)
    expect(curveRecord.joints_deg.length).toBe(curveRecord.r_flange.length)
    expect(plannedRecord.joints_deg.length).toBeGreaterThan(0)
    expect(plannedRecord.joints_deg.length).toBe(plannedRecord.p_flange_mm.length)
    expect(plannedRecord.joints_deg.length).toBe(plannedRecord.r_flange.length)
  })

  it('项目 FK 与 RPI 真实数据法兰位姿一致', () => {
    let maxPosErr = 0
    let maxOriErr = 0
    let maxErrIndex = -1

    records.forEach((record, index) => {
      const jointsDeg = rpiToProjectJoints(record.q_rad)
      const projectPose = model.forwardKinematics(jointsDeg)
      if (!projectPose) throw new Error('project FK returned null')

      const posErr = positionErrorMm(projectPose.position, record.p_flange_mm)
      const oriErr = rotationDistanceRad(record.r_flange, projectPose.rotation)
      if (posErr > maxPosErr) {
        maxPosErr = posErr
        maxErrIndex = index
      }
      maxOriErr = Math.max(maxOriErr, oriErr)
    })

    console.log(
      `FK consistency: max position error = ${maxPosErr.toFixed(4)} mm (index ${maxErrIndex})`,
    )
    console.log(`FK consistency: max orientation error = ${maxOriErr.toFixed(6)} rad`)

    expect(maxPosErr).toBeLessThan(1e-6)
    expect(maxOriErr).toBeLessThan(1e-7)
  })

  it('项目 IK 能从 RPI 真实法兰位姿解回真实关节角', () => {
    const maxPositionErrorMm: number[] = []
    const maxOrientationErrorRad: number[] = []
    const maxJointErrorDeg: number[] = []
    let failures = 0

    records.forEach((record, index) => {
      const targetPose: Pose = {
        position: [record.p_flange_mm[0], record.p_flange_mm[1], record.p_flange_mm[2]],
        euler: [0, 0, 0],
        rotation: record.r_flange,
      }
      const reference = rpiToProjectJoints(record.q_rad)
      const result = solveIK(targetPose, reference, model, {}, ABB_JOINT_RANGES)

      if (!result) {
        failures += 1
        console.warn(`IK failed at index ${index}`)
        return
      }

      const solvedPose = model.forwardKinematics(result)
      if (!solvedPose) {
        failures += 1
        console.warn(`FK failed after IK at index ${index}`)
        return
      }

      const posErr = positionErrorMm(solvedPose.position, targetPose.position)
      const oriErr = rotationDistanceRad(targetPose.rotation, solvedPose.rotation)
      const jointErr = Math.max(...result.map((value, i) => Math.abs(value - reference[i])))

      maxPositionErrorMm.push(posErr)
      maxOrientationErrorRad.push(oriErr)
      maxJointErrorDeg.push(jointErr)
    })

    const passRate = ((records.length - failures) / records.length) * 100
    const meanPosErr =
      maxPositionErrorMm.reduce((a, b) => a + b, 0) / Math.max(1, maxPositionErrorMm.length)
    const meanOriErr =
      maxOrientationErrorRad.reduce((a, b) => a + b, 0) / Math.max(1, maxOrientationErrorRad.length)
    const meanJointErr =
      maxJointErrorDeg.reduce((a, b) => a + b, 0) / Math.max(1, maxJointErrorDeg.length)

    console.log(`IK validation: pass rate = ${passRate.toFixed(1)}%`)
    console.log(`IK validation: mean position error = ${meanPosErr.toFixed(4)} mm`)
    console.log(`IK validation: mean orientation error = ${meanOriErr.toFixed(6)} rad`)
    console.log(`IK validation: mean max joint error = ${meanJointErr.toFixed(4)} deg`)

    expect(failures).toBe(0)
    expect(Math.max(...maxPositionErrorMm)).toBeLessThan(1e-6)
    expect(Math.max(...maxOrientationErrorRad)).toBeLessThan(1e-7)
    expect(Math.max(...maxJointErrorDeg)).toBeLessThan(1e-6)
  })

  it('项目 FK 与 RPI 真实执行轨迹（466 点）法兰位姿一致', () => {
    let maxPosErr = 0
    let maxOriErr = 0

    curveRecord.joints_deg.forEach((jointsDeg, index) => {
      const projectPose = model.forwardKinematics(jointsDeg as JointAngles)
      if (!projectPose) throw new Error(`project FK returned null at index ${index}`)

      const posErr = positionErrorMm(projectPose.position, curveRecord.p_flange_mm[index])
      const oriErr = rotationDistanceRad(curveRecord.r_flange[index], projectPose.rotation)
      maxPosErr = Math.max(maxPosErr, posErr)
      maxOriErr = Math.max(maxOriErr, oriErr)
    })

    console.log(`FK trajectory consistency: max position error = ${maxPosErr.toFixed(4)} mm`)
    console.log(`FK trajectory consistency: max orientation error = ${maxOriErr.toFixed(6)} rad`)

    expect(maxPosErr).toBeLessThan(1e-6)
    expect(maxOriErr).toBeLessThan(1e-7)
  })

  it('项目 IK 能从 RPI 真实执行轨迹（466 点）逐点解回真实关节角', () => {
    const positionErrors: number[] = []
    const orientationErrors: number[] = []
    const jointErrors: number[] = []
    let failures = 0
    let previousJoints: JointAngles | undefined

    curveRecord.joints_deg.forEach((jointsDeg, index) => {
      const targetPose: Pose = {
        position: [...curveRecord.p_flange_mm[index]] as Pose['position'],
        euler: [0, 0, 0],
        rotation: curveRecord.r_flange[index] as Pose['rotation'],
      }
      const reference = previousJoints ?? (jointsDeg as JointAngles)
      // 外部 RPI 轨迹本身包含 cf1 象限切换；此测试验证几何跟踪连续性，
      // 构型保持语义由默认严格路径和 candidate-catalog 单测单独验证。
      const result = solveIK(
        targetPose,
        reference,
        model,
        { preserveConfiguration: false },
        ABB_JOINT_RANGES,
      )

      if (!result) {
        failures += 1
        console.warn(`IK failed at trajectory index ${index}`)
        previousJoints = jointsDeg as JointAngles
        return
      }

      const solvedPose = model.forwardKinematics(result)
      if (!solvedPose) {
        failures += 1
        console.warn(`FK failed after IK at trajectory index ${index}`)
        previousJoints = jointsDeg as JointAngles
        return
      }

      positionErrors.push(positionErrorMm(solvedPose.position, targetPose.position))
      orientationErrors.push(rotationDistanceRad(targetPose.rotation, solvedPose.rotation))
      jointErrors.push(Math.max(...result.map((value, i) => Math.abs(value - jointsDeg[i]))))
      previousJoints = result
    })

    const passRate =
      ((curveRecord.joints_deg.length - failures) / curveRecord.joints_deg.length) * 100
    const meanPosErr =
      positionErrors.reduce((a, b) => a + b, 0) / Math.max(1, positionErrors.length)
    const meanOriErr =
      orientationErrors.reduce((a, b) => a + b, 0) / Math.max(1, orientationErrors.length)
    const meanJointErr = jointErrors.reduce((a, b) => a + b, 0) / Math.max(1, jointErrors.length)
    const maxJointErr = jointErrors.length > 0 ? Math.max(...jointErrors) : Number.POSITIVE_INFINITY

    console.log(`IK trajectory validation: pass rate = ${passRate.toFixed(1)}%`)
    console.log(`IK trajectory validation: mean position error = ${meanPosErr.toFixed(4)} mm`)
    console.log(`IK trajectory validation: mean orientation error = ${meanOriErr.toFixed(6)} rad`)
    console.log(`IK trajectory validation: mean max joint error = ${meanJointErr.toFixed(4)} deg`)
    console.log(`IK trajectory validation: max joint error = ${maxJointErr.toFixed(4)} deg`)

    expect(failures).toBe(0)
    expect(Math.max(...positionErrors)).toBeLessThan(1e-6)
    expect(Math.max(...orientationErrors)).toBeLessThan(1e-7)
    expect(maxJointErr).toBeLessThan(1e-6)
  })

  it('项目 IK 在真实执行轨迹上保持分支连续性（相邻点步长不跳变）', () => {
    let previousJoints: JointAngles | undefined
    const maxSteps: number[] = []

    curveRecord.joints_deg.forEach((jointsDeg, index) => {
      if (previousJoints === undefined) {
        previousJoints = jointsDeg as JointAngles
        return
      }
      const targetPose: Pose = {
        position: [...curveRecord.p_flange_mm[index]] as Pose['position'],
        euler: [0, 0, 0],
        rotation: curveRecord.r_flange[index] as Pose['rotation'],
      }
      // 外部 RPI 轨迹本身包含 cf1 象限切换；此测试验证几何跟踪连续性，
      // 构型保持语义由默认严格路径和 candidate-catalog 单测单独验证。
      const result = solveIK(
        targetPose,
        previousJoints,
        model,
        { preserveConfiguration: false },
        ABB_JOINT_RANGES,
      )
      if (!result) {
        throw new Error(`IK failed at trajectory index ${index} during continuity test`)
      }
      const step = Math.max(...result.map((value, i) => Math.abs(value - previousJoints![i])))
      maxSteps.push(step)
      previousJoints = result
    })

    const maxStep = Math.max(...maxSteps)
    const meanStep = maxSteps.reduce((a, b) => a + b, 0) / maxSteps.length
    console.log(
      `IK continuity on real trajectory: max step = ${maxStep.toFixed(4)} deg, mean = ${meanStep.toFixed(4)} deg`,
    )

    expect(maxStep).toBeLessThan(5)
  })

  it('项目 FK 与 RPI 计划参考轨迹（1000 点子采样）法兰位姿一致', () => {
    let maxPosErr = 0
    let maxOriErr = 0

    plannedRecord.joints_deg.forEach((jointsDeg, index) => {
      const projectPose = model.forwardKinematics(jointsDeg as JointAngles)
      if (!projectPose) throw new Error(`project FK returned null at planned index ${index}`)

      const posErr = positionErrorMm(projectPose.position, plannedRecord.p_flange_mm[index])
      const oriErr = rotationDistanceRad(plannedRecord.r_flange[index], projectPose.rotation)
      maxPosErr = Math.max(maxPosErr, posErr)
      maxOriErr = Math.max(maxOriErr, oriErr)
    })

    console.log(
      `FK planned trajectory consistency: max position error = ${maxPosErr.toFixed(4)} mm`,
    )
    console.log(
      `FK planned trajectory consistency: max orientation error = ${maxOriErr.toFixed(6)} rad`,
    )

    expect(maxPosErr).toBeLessThan(1e-6)
    expect(maxOriErr).toBeLessThan(1e-7)
  })
})
