import { Matrix4x4 } from '../robotics/matrix4x4.ts'
import {
  mat3Transpose,
  quaternionToRotationMatrix,
  rotationMatrixToEulerZYX,
} from '../robotics/math/rotation3d.ts'
import type { Pose } from '../robotics/types.ts'
import type { RapidPose, RobTarget, ToolData, WobjData } from './rapid-types.ts'
import { rapidQuatToInternal } from './plan-shared.ts'

/**
 * ABB RAPID 坐标变换 seam（票据 02）。
 *
 * 按 ABB 官方顺序：robtarget 表达在工件目标(Object)坐标系；TCP 的世界/基座位姿由
 * `uframe · oframe` 复合得到；机械法兰(wrist)位姿再由 `逆(tool.tframe)` 复合得到：
 *
 *   p_worldTCP = uframe · oframe · robtarget
 *   p_flange   = PoseInv(tool.tframe) · p_worldTCP          (即 base = M(tool) · flange)
 *
 * 本模块只做 4x4 刚体复合与逆；不依赖 Vue/Three.js，也不在场景 adapter 中求 RAPID 坐标。
 */

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

/** 刚体变换的逆：R^-1 = R^T，t^-1 = -R^T·t。 */
function inverseRigid(matrix: Matrix4x4): Matrix4x4 {
  const r = matrix.getRotation()
  const rt = mat3Transpose(r)
  const t = matrix.getPosition()
  const tinv = Matrix4x4.mat3Vec3Mul(rt, t).map((value) => -value)
  return new Matrix4x4([
    [rt[0][0], rt[0][1], rt[0][2], tinv[0]],
    [rt[1][0], rt[1][1], rt[1][2], tinv[1]],
    [rt[2][0], rt[2][1], rt[2][2], tinv[2]],
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
  const world = frameMatrix(wobj.uframe)
    .multiply(frameMatrix(wobj.oframe))
    .multiply(object)
  return matrixToPose(world)
}

/** 世界 TCP 位姿 → 机械法兰位姿：`TCP · PoseInv(tool.tframe)`（base = flange · tframe 的右乘逆）。 */
export function worldTcpToFlangePose(worldTcp: Pose, tool: ToolData): Pose {
  return matrixToPose(poseToMatrix(worldTcp).multiply(inverseRigid(frameMatrix(tool.tframe))))
}

/** 当前法兰位姿 → 世界 TCP 位姿：`flange · tool.tframe`（MoveL 直线路径起点）。 */
export function flangeToWorldTcpPose(flange: Pose, tool: ToolData): Pose {
  return matrixToPose(poseToMatrix(flange).multiply(frameMatrix(tool.tframe)))
}

/** robtarget → 机械法兰位姿（MoveJ 的 IK 目标）。 */
export function robTargetToFlangePose(target: RobTarget, wobj: WobjData, tool: ToolData): Pose {
  return worldTcpToFlangePose(robTargetToWorldPose(target, wobj), tool)
}
