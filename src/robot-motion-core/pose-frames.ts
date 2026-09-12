import type { Pose } from '@/robot-geometry/robot-types.ts'
import {
  quaternionToRotationMatrix,
  rotationMatrixToQuaternion,
} from '@/robot-geometry/math/rotation3d.ts'
import type {
  PositionMm,
  PoseData,
  RigidFrameData,
  PoseJointTargetIntent,
  LinearPathIntent,
  CircularPathIntent,
} from './contracts.ts'

/** 毫米/WXYZ 请求与刚体坐标的纯换算；工具与工件坐标组合顺序集中在此。 */

type RigidMatrix = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
]

function toPose(data: PoseData): Pose {
  const raw = [
    data.quaternionWxyz[1],
    data.quaternionWxyz[2],
    data.quaternionWxyz[3],
    data.quaternionWxyz[0],
  ] as [number, number, number, number]
  const length = Math.hypot(...raw)
  const rotation = quaternionToRotationMatrix(
    raw.map((value) => value / length) as [number, number, number, number],
  )
  return { position: [...data.positionMm] as Pose['position'], euler: [0, 0, 0], rotation }
}

export function frameMatrix(frame: RigidFrameData): RigidMatrix {
  const pose = toPose(frame)
  return [
    [pose.rotation[0][0], pose.rotation[0][1], pose.rotation[0][2], pose.position[0]],
    [pose.rotation[1][0], pose.rotation[1][1], pose.rotation[1][2], pose.position[1]],
    [pose.rotation[2][0], pose.rotation[2][1], pose.rotation[2][2], pose.position[2]],
    [0, 0, 0, 1],
  ]
}

export function multiplyRigid(left: RigidMatrix, right: RigidMatrix): RigidMatrix {
  return Array.from({ length: 4 }, (_, row) =>
    Array.from(
      { length: 4 },
      (_, column) =>
        left[row][0] * right[0][column] +
        left[row][1] * right[1][column] +
        left[row][2] * right[2][column] +
        left[row][3] * right[3][column],
    ),
  ) as unknown as RigidMatrix
}

export function inverseRigid(matrix: RigidMatrix): RigidMatrix {
  const rotation = [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ]
  const translation = [matrix[0][3], matrix[1][3], matrix[2][3]]
  const inverseTranslation = [
    -(
      rotation[0][0] * translation[0] +
      rotation[1][0] * translation[1] +
      rotation[2][0] * translation[2]
    ),
    -(
      rotation[0][1] * translation[0] +
      rotation[1][1] * translation[1] +
      rotation[2][1] * translation[2]
    ),
    -(
      rotation[0][2] * translation[0] +
      rotation[1][2] * translation[1] +
      rotation[2][2] * translation[2]
    ),
  ]
  return [
    [rotation[0][0], rotation[1][0], rotation[2][0], inverseTranslation[0]],
    [rotation[0][1], rotation[1][1], rotation[2][1], inverseTranslation[1]],
    [rotation[0][2], rotation[1][2], rotation[2][2], inverseTranslation[2]],
    [0, 0, 0, 1],
  ]
}

export function poseFromMatrix(matrix: RigidMatrix): Pose {
  return {
    position: [matrix[0][3], matrix[1][3], matrix[2][3]],
    euler: [0, 0, 0],
    rotation: [
      [matrix[0][0], matrix[0][1], matrix[0][2]],
      [matrix[1][0], matrix[1][1], matrix[1][2]],
      [matrix[2][0], matrix[2][1], matrix[2][2]],
    ],
  }
}

export function targetFlangePose(
  intent: PoseJointTargetIntent | LinearPathIntent,
  target: PoseData,
): Pose {
  const targetMatrix = multiplyRigid(
    multiplyRigid(
      frameMatrix(intent.workObject.userFrame),
      frameMatrix(intent.workObject.objectFrame),
    ),
    frameMatrix(target),
  )
  return poseFromMatrix(
    multiplyRigid(targetMatrix, inverseRigid(frameMatrix(intent.tool.tcpInFlange))),
  )
}

export function targetWorldPose(
  intent: PoseJointTargetIntent | LinearPathIntent | CircularPathIntent,
  target: PoseData,
): Pose {
  return poseFromMatrix(
    multiplyRigid(
      multiplyRigid(
        frameMatrix(intent.workObject.userFrame),
        frameMatrix(intent.workObject.objectFrame),
      ),
      frameMatrix(target),
    ),
  )
}

export function poseToFrameData(pose: Pose): PoseData {
  const q = rotationMatrixToQuaternion(pose.rotation)
  return { positionMm: [...pose.position] as PositionMm, quaternionWxyz: [q[3], q[0], q[1], q[2]] }
}
