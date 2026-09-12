import { Matrix4x4 } from '@/robot-geometry/math/transform-matrix.ts'
import {
  quaternionToRotationMatrix,
  rotationMatrixToEulerZYX,
} from '@/robot-geometry/math/rotation3d.ts'
import type { Pose } from '@/robot-geometry/robot-types.ts'
import type { RapidPose, RobTarget, WobjData } from './records.ts'
import { rapidQuatToInternal } from './rapid-pose-conversion.ts'

/** RAPID 工件坐标下的目标转换到世界 TCP：uframe · oframe · robtarget。
 * 仅负责数据空间换算；运动规划中的工具/法兰转换由 Core 统一完成。 */

/** 由 RotTarget 转出的 Pose（视为 Object 坐标系内的 TCP 位姿）转成 4x4。 */
function poseToMatrix(pose: Pose): Matrix4x4 {
  const r = pose.rotation
  return new Matrix4x4([
    [r[0][0], r[0][1], r[0][2], pose.position[0]],
    [r[1][0], r[1][1], r[1][2], pose.position[1]],
    [r[2][0], r[2][1], r[2][2], pose.position[2]],
    [0, 0, 0, 1],
  ])
}

/** 由 4x4 提取出 Pose（位置 + 旋转矩阵 + 欧拉角）。 */
function matrixToPose(matrix: Matrix4x4): Pose {
  const rotation = matrix.getRotation()
  return {
    position: matrix.getPosition(),
    euler: rotationMatrixToEulerZYX(rotation),
    rotation,
  }
}

/** 由 ABB 位姿(frame：trans + RAPID 顺序四元数) 构造 4x4。四元数会先归一化。 */
function frameMatrix(frame: RapidPose): Matrix4x4 {
  const length = Math.hypot(...frame.rot)
  const rot = quaternionToRotationMatrix(
    rapidQuatToInternal(frame.rot.map((value) => value / length) as RapidPose['rot']),
  )
  return new Matrix4x4([
    [rot[0][0], rot[0][1], rot[0][2], frame.trans[0]],
    [rot[1][0], rot[1][1], rot[1][2], frame.trans[1]],
    [rot[2][0], rot[2][1], rot[2][2], frame.trans[2]],
    [0, 0, 0, 1],
  ])
}

/** robtarget（Object 坐标系内 TCP）→ 世界/基座 TCP 位姿：`uframe · oframe · robtarget`。 */
export function robTargetToWorldPose(target: RobTarget, wobj: WobjData): Pose {
  const object = poseToMatrix({
    position: [...target.trans],
    euler: [0, 0, 0],
    rotation: (() => {
      const length = Math.hypot(...target.rot)
      return quaternionToRotationMatrix(
        rapidQuatToInternal(target.rot.map((value) => value / length) as RapidPose['rot']),
      )
    })(),
  })
  const world = frameMatrix(wobj.uframe).multiply(frameMatrix(wobj.oframe)).multiply(object)
  return matrixToPose(world)
}
