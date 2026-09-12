import type { RobotProfile } from '@/robot-geometry/robot-types.ts'
import { resolveRobotProfile } from '@/robot-models/registry.ts'
import {
  buildIKCandidateCatalog,
  selectBestIKCandidate,
} from '@/robot-geometry/ik/candidate-catalog.ts'
import type { WaypointSolveResult } from './cartesian/waypoint-types.ts'
import { planCartesianPath } from './cartesian/linear-path-planner.ts'
import { solvePoseWaypoints } from './cartesian/pose-path-solver.ts'
import { arcLengthMm, sampleArcPoses } from './arc-geometry.ts'
import type { JointAngles } from '@/robot-geometry/robot-types.ts'
import { rotationMatrixToQuaternion } from '@/robot-geometry/math/rotation3d.ts'
import type {
  JointVector6,
  ABBConfigurationData,
  ConfigurationPolicy,
  JointTargetIntent,
  PoseJointTargetIntent,
  LinearPathIntent,
  CircularPathIntent,
  MotionPlanningRequest,
  MotionErrorCode,
  MotionPlanningResultError,
  MotionPlanningResult,
} from './contracts.ts'
import { frameMatrix, multiplyRigid, poseFromMatrix, poseToFrameData } from './pose-frames.ts'
import { targetFlangePose, targetWorldPose, inverseRigid } from './pose-frames.ts'
import { validateRequest } from './request-validation.ts'
import { createPlanOutput } from './plan-output.ts'

/** 纯规划入口：可注入实际机型做独立验证，缺省由同一机型表解析身份。 */
export function planMotion(
  request: MotionPlanningRequest,
  suppliedProfile?: RobotProfile,
): MotionPlanningResult {
  const error = validateRequest(request)
  if (error) return error
  const profile = suppliedProfile ?? resolveRobotProfile(request.robot)
  if (
    !profile ||
    profile.id !== request.robot.modelId ||
    profile.revision !== request.robot.modelRevision
  )
    return {
      ok: false,
      error: {
        code: 'unsupported-model',
        category: 'unsupported-model',
        details: { ...request.robot },
      },
    }
  return planForProfile(request, profile)
}

function planForProfile(
  request: MotionPlanningRequest,
  profile: RobotProfile,
): MotionPlanningResult {
  const { configurationData, makePlan, retimeByTcpPathLength } = createPlanOutput(profile)

  function withinRanges(joints: JointVector6): number | null {
    const index = joints.findIndex(
      (value, axis) => value < profile.jointRanges[axis][0] || value > profile.jointRanges[axis][1],
    )
    return index >= 0 ? index : null
  }
  function configurationMatches(
    configuration: ABBConfigurationData | undefined,
    policy: ConfigurationPolicy,
  ): boolean {
    const expected =
      policy.kind === 'required'
        ? policy.target
        : policy.kind === 'current-main'
          ? policy.currentMain
          : undefined
    return (
      expected === undefined ||
      Boolean(
        configuration &&
        configuration.cf1 === expected.cf1 &&
        configuration.cf4 === expected.cf4 &&
        configuration.cf6 === expected.cf6 &&
        configuration.cfx === expected.cfx,
      )
    )
  }
  /**
   * 构型策略（configurationPolicy）从运动意图翻译成底层求解选项；三个笛卡尔规划入口共用同一份派生，
   * 避免新增运动意图类型时遗漏某一处（对应 b9f3b47 修复过的这一类隐藏规则遗漏风险）。
   */
  function deriveConfigurationOptions(policy: ConfigurationPolicy): {
    readonly preserveConfiguration: boolean
    readonly requiredConfiguration: readonly number[] | undefined
    readonly maxJointStepDeg: null | undefined
  } {
    return {
      preserveConfiguration: policy.kind === 'current-main',
      requiredConfiguration:
        policy.kind === 'required'
          ? [policy.target.cf1, policy.target.cf4, policy.target.cf6, policy.target.cfx]
          : undefined,
      maxJointStepDeg: undefined,
    }
  }
  /** 规划得到的终点关节必须仍满足入参的构型策略；否则即使 IK/步长都通过，也判定为构型不可达。 */
  function verifyConfigurationReached(
    end: JointAngles | undefined,
    policy: ConfigurationPolicy,
  ): MotionPlanningResultError | null {
    return !end || !configurationMatches(configurationData(end), policy)
      ? {
          ok: false,
          error: {
            code: 'configuration-unreachable',
            category: 'planning-failure',
            details: { policy: policy.kind },
          },
        }
      : null
  }
  function mapPathFailure(
    result: Extract<WaypointSolveResult, { ok: false }>,
  ): MotionPlanningResultError {
    const { failure, diagnostic } = result
    const details: Record<string, string | number | boolean | null> = { failure }
    if (diagnostic) {
      for (const [key, value] of Object.entries(diagnostic))
        if (typeof value === 'number') details[key] = value
      if (diagnostic.limitRangeDeg) {
        details.limitMinDeg = diagnostic.limitRangeDeg[0]
        details.limitMaxDeg = diagnostic.limitRangeDeg[1]
      }
    }
    const code: MotionErrorCode =
      failure === 'joint-limit'
        ? 'joint-limit'
        : failure === 'joint-step' || failure === 'wrist-reconfiguration'
          ? 'path-discontinuity'
          : failure === 'wrist-singularity'
            ? 'wrist-singularity'
            : 'unreachable'
    return { ok: false, error: { code, category: 'planning-failure', details } }
  }

  function planJointTarget(state: JointVector6, intent: JointTargetIntent): MotionPlanningResult {
    const axisIndex = withinRanges(intent.targetJointsDeg)
    return axisIndex === null
      ? makePlan([intent.targetJointsDeg as JointAngles], state)
      : {
          ok: false,
          error: { code: 'joint-limit', category: 'planning-failure', details: { axisIndex } },
        }
  }
  function planPoseJointTarget(
    state: JointVector6,
    intent: PoseJointTargetIntent,
  ): MotionPlanningResult {
    const target = targetFlangePose(intent, intent.targetTcpPose)
    const catalog = buildIKCandidateCatalog(
      target,
      state as JointAngles,
      profile.model,
      profile.jointRanges,
    )
    const policy = intent.configurationPolicy
    const expected =
      policy.kind === 'required'
        ? policy.target
        : policy.kind === 'current-main'
          ? policy.currentMain
          : undefined
    const candidate = selectBestIKCandidate(catalog, {
      positionTolerance: 0.05,
      orientationTolerance: 0.001,
      referenceConfiguration: expected
        ? [expected.cf1, expected.cf4, expected.cf6, expected.cfx]
        : undefined,
    })
    if (!candidate?.normalizedJoints) {
      const geometric = catalog.some(
        (c) => c.positionErrorMm <= 0.05 && c.orientationErrorRad <= 0.001,
      )
      const legal = catalog.some(
        (c) => c.withinJointRanges && c.positionErrorMm <= 0.05 && c.orientationErrorRad <= 0.001,
      )
      const code: MotionErrorCode =
        expected && legal
          ? 'configuration-unreachable'
          : geometric && !legal
            ? 'joint-limit'
            : 'unreachable'
      return {
        ok: false,
        error: { code, category: 'planning-failure', details: { policy: policy.kind } },
      }
    }
    const end = candidate.normalizedJoints
    // 关节空间线性插值；TCP 路径不受直线约束。用采样的 TCP 长度估计教学速度时间。
    const segments = Math.max(
      1,
      Math.ceil(Math.max(...end.map((v, i) => Math.abs(v - state[i]))) / 2),
    )
    const joints = Array.from(
      { length: segments },
      (_, i) => state.map((v, axis) => v + ((end[axis] - v) * (i + 1)) / segments) as JointAngles,
    )
    const worldTarget = targetWorldPose(intent, intent.targetTcpPose)
    const plan = makePlan(joints, state, worldTarget, undefined, intent.tool)
    return retimeByTcpPathLength(
      plan,
      state,
      intent.tool,
      undefined,
      intent.speedMmPerSec ?? 100,
      intent.speedOriDegPerSec ?? 90,
    )
  }
  function planLinearPath(state: JointVector6, intent: LinearPathIntent): MotionPlanningResult {
    const target = targetWorldPose(intent, intent.targetTcpPose)
    const startFlange = profile.model.forwardKinematics(state as JointAngles)
    if (!startFlange)
      return {
        ok: false,
        error: {
          code: 'unreachable',
          category: 'planning-failure',
          details: { reason: 'start-forward-kinematics' },
        },
      }
    const startTcp = poseFromMatrix(
      multiplyRigid(
        frameMatrix(poseToFrameData(startFlange)),
        frameMatrix(intent.tool.tcpInFlange),
      ),
    )
    const result = planCartesianPath(
      target,
      state as JointAngles,
      profile.model,
      profile.jointRanges,
      {
        tcpStart: startTcp,
        toFlange: (tcp) =>
          poseFromMatrix(
            multiplyRigid(
              frameMatrix(poseToFrameData(tcp)),
              inverseRigid(frameMatrix(intent.tool.tcpInFlange)),
            ),
          ),
        allowWristFallback: intent.singularityPolicy === 'wrist-interpolation',
        ...deriveConfigurationOptions(intent.configurationPolicy),
      },
    )
    if (!result.ok) return mapPathFailure(result)
    const end = result.waypoints.at(-1)
    const configurationError = verifyConfigurationReached(end, intent.configurationPolicy)
    if (configurationError) return configurationError
    const plan = makePlan(
      result.waypoints,
      state,
      target,
      result.appliedSingularityMode ? ['orientation'] : undefined,
      intent.tool,
    )
    const distance = Math.hypot(
      ...target.position.map((value, axis) => value - startTcp.position[axis]),
    )
    return retimeByTcpPathLength(
      plan,
      state,
      intent.tool,
      distance,
      intent.speedMmPerSec,
      intent.speedOriDegPerSec,
    )
  }
  function planCircularPath(state: JointVector6, intent: CircularPathIntent): MotionPlanningResult {
    const via = targetWorldPose(intent, intent.viaTcpPose)
    const target = targetWorldPose(intent, intent.targetTcpPose)
    const startFlange = profile.model.forwardKinematics(state as JointAngles)
    if (!startFlange)
      return {
        ok: false,
        error: {
          code: 'unreachable',
          category: 'planning-failure',
          details: { reason: 'start-forward-kinematics' },
        },
      }
    const startTcp = poseFromMatrix(
      multiplyRigid(
        frameMatrix(poseToFrameData(startFlange)),
        frameMatrix(intent.tool.tcpInFlange),
      ),
    )
    const q0 = rotationMatrixToQuaternion(startTcp.rotation)
    const q2 = rotationMatrixToQuaternion(target.rotation)
    const distance = Math.hypot(
      ...target.position.map((value, axis) => value - startTcp.position[axis]),
    )
    const poses = sampleArcPoses(
      startTcp.position,
      via.position,
      target.position,
      q0,
      q2,
      Math.min(64, Math.max(8, Math.ceil(distance / 4))),
    )
    if (!poses)
      return {
        ok: false,
        error: {
          code: 'unreachable',
          category: 'planning-failure',
          details: { reason: 'degenerate-arc' },
        },
      }
    const { preserveConfiguration, requiredConfiguration, maxJointStepDeg } =
      deriveConfigurationOptions(intent.configurationPolicy)
    const result = solvePoseWaypoints(
      poses,
      state as JointAngles,
      profile.model,
      profile.jointRanges,
      (pose) =>
        poseFromMatrix(
          multiplyRigid(
            frameMatrix(poseToFrameData(pose)),
            inverseRigid(frameMatrix(intent.tool.tcpInFlange)),
          ),
        ),
      { preserveConfiguration },
      {
        allowWristFallback: intent.singularityPolicy === 'wrist-interpolation',
        requiredConfiguration,
        maxJointStepDeg,
      },
    )
    if (!result.ok) return mapPathFailure(result)
    const end = result.waypoints.at(-1)
    const configurationError = verifyConfigurationReached(end, intent.configurationPolicy)
    if (configurationError) return configurationError
    const plan = makePlan(
      result.waypoints,
      state,
      target,
      result.appliedSingularityMode ? ['orientation'] : undefined,
      intent.tool,
    )
    const length = arcLengthMm(startTcp.position, via.position, target.position)
    if (length === null)
      return {
        ok: false,
        error: {
          code: 'unreachable',
          category: 'planning-failure',
          details: { reason: 'degenerate-arc' },
        },
      }
    return retimeByTcpPathLength(
      plan,
      state,
      intent.tool,
      length,
      intent.speedMmPerSec,
      intent.speedOriDegPerSec,
    )
  }
  switch (request.intent.kind) {
    case 'joint-target':
      return planJointTarget(request.state.jointsDeg, request.intent)
    case 'pose-joint-target':
      return planPoseJointTarget(request.state.jointsDeg, request.intent)
    case 'linear-path':
      return planLinearPath(request.state.jointsDeg, request.intent)
    case 'circular-path':
      return planCircularPath(request.state.jointsDeg, request.intent)
  }
}
