import type { RobotProfile } from '@/robot-geometry/robot-types.ts'
import { DEFAULT_ROBOT, robotIdentity } from '@/robot-models/registry.ts'
import {
  type MotionPlanningRequest,
  type PoseData,
  type JointVector6,
} from '@/robot-motion-core/index.ts'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import { rotationMatrixToQuaternion } from '@/robot-geometry/math/rotation3d.ts'

const IDENTITY_FRAME: PoseData = {
  positionMm: [0, 0, 0],
  quaternionWxyz: [1, 0, 0, 0],
}

function poseDataFromPose(pose: Pose): PoseData {
  const quaternion = rotationMatrixToQuaternion(pose.rotation)
  return {
    positionMm: [...pose.position] as PoseData['positionMm'],
    quaternionWxyz: [quaternion[3], quaternion[0], quaternion[1], quaternion[2]],
  }
}

export function createJointTargetRequest(
  currentJoints: JointAngles,
  targetJoints: JointAngles,
  profile: RobotProfile = DEFAULT_ROBOT,
): MotionPlanningRequest {
  return {
    schemaVersion: 1,
    robot: robotIdentity(profile),
    state: { jointsDeg: [...currentJoints] as JointVector6 },
    intent: { kind: 'joint-target', targetJointsDeg: [...targetJoints] as JointVector6 },
  }
}

export function createCartesianTargetRequest(
  targetPose: Pose,
  currentJoints: JointAngles,
  profile: RobotProfile = DEFAULT_ROBOT,
): MotionPlanningRequest {
  return {
    schemaVersion: 1,
    robot: robotIdentity(profile),
    state: { jointsDeg: [...currentJoints] as JointVector6 },
    intent: {
      kind: 'linear-path',
      speedMmPerSec: 50,
      speedOriDegPerSec: 30,
      targetTcpPose: poseDataFromPose(targetPose),
      tool: { robhold: true, tcpInFlange: IDENTITY_FRAME },
      workObject: {
        robhold: false,
        userFrame: IDENTITY_FRAME,
        objectFrame: IDENTITY_FRAME,
        ufprog: true,
        ufmec: '',
      },
      configurationPolicy: { kind: 'nearest-valid' },
      singularityPolicy: 'strict',
      zone: 'fine',
    },
  }
}
