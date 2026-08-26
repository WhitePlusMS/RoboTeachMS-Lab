import { quaternionToRotationMatrix, rotationMatrixToEulerZYX } from '@/robotics/math/rotation3d.ts'
import type { Pose } from '@/robotics/model/index.ts'
import type { RapidQuat, RobTarget } from './index.ts'

/**
 * RAPID 四元数 [q1,q2,q3,q4]（q1=w）与机器人核心数学格式 [x,y,z,w]
 * 之间的唯一转换接缝。RAPID 数据层负责顺序转换，数学模块不猜测厂家格式。
 */
export function rapidQuatToInternal(rot: RapidQuat): [number, number, number, number] {
  const [q1, q2, q3, q4] = rot
  return [q2, q3, q4, q1]
}

/** 机器人核心数学格式 [x,y,z,w] → RAPID 四元数 [q1,q2,q3,q4]。 */
export function internalQuatToRapid(quat: [number, number, number, number]): RapidQuat {
  const [x, y, z, w] = quat
  return [w, x, y, z]
}

/** 把 RAPID robtarget 转换成机器人内部 Pose；旋转矩阵是姿态误差的唯一来源。 */
export function robTargetToPose(target: RobTarget): Pose {
  const rotorLength = Math.hypot(...target.rot)
  const normalizedRapid = target.rot.map((value) => value / rotorLength) as RapidQuat
  const rotation = quaternionToRotationMatrix(rapidQuatToInternal(normalizedRapid))
  return {
    position: [...target.trans],
    euler: rotationMatrixToEulerZYX(rotation),
    rotation,
  }
}
