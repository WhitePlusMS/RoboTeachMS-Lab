import {
  ABB_IRB1200_MODEL_ID,
  ABB_IRB1200_MODEL_REVISION,
  type MotionPlanningRequest,
  type PoseData,
  type JointVector6,
} from '@/robot-motion-core/index.ts'
import type { JointAngles, Pose } from '@/robotics/model/index.ts'
import { rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'

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
): MotionPlanningRequest {
  return {
    schemaVersion: 1,
    robot: { modelId: ABB_IRB1200_MODEL_ID, modelRevision: ABB_IRB1200_MODEL_REVISION },
    state: { jointsDeg: [...currentJoints] as JointVector6 },
    intent: { kind: 'joint-target', targetJointsDeg: [...targetJoints] as JointVector6 },
  }
}

export function createCartesianTargetRequest(
  targetPose: Pose,
  currentJoints: JointAngles,
): MotionPlanningRequest {
  return {
    schemaVersion: 1,
    robot: { modelId: ABB_IRB1200_MODEL_ID, modelRevision: ABB_IRB1200_MODEL_REVISION },
    state: { jointsDeg: [...currentJoints] as JointVector6 },
    intent: {
      kind: 'cartesian-target',
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
