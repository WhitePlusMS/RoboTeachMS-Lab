import { Matrix4x4 } from '../robotics/matrix4x4.ts'
import {
  mat3Mul,
  quaternionToRotationMatrix,
  rotationMatrixToQuaternion,
} from '../robotics/math/rotation3d.ts'
import { degToRad } from '../robotics/math/angle.ts'
import type { RobTarget } from './rapid-types.ts'
import { internalQuatToRapid, rapidQuatToInternal } from './plan-shared.ts'

/**
 * ABB 目标位置函数求值（票据 03）：
 * - Offs(Point, X, Y, Z)：把 Point 沿工件目标(Object)坐标系的 X/Y/Z 平移。
 * - RelTool(Point, Dx, Dy, Dz [, Rx, Ry, Rz])：把 Point 沿活动工具坐标系的 Dx/Dy/Dz 平移，
 *   并提供可选绕工具轴的旋转（先绕 x、再新 y、最后新 z）。
 * 两者都返回新的 robtarget；基准 Point 必须是一个已解析 robtarget（名称）。
 */

/** 绕工具坐标系的 X/Y/Z 轴（先绕 x、再新 y、最后新 z）组合旋转；角度单位为度。 */
function toolEulerRotation(rxDeg: number, ryDeg: number, rzDeg: number): number[][] {
  const rx = degToRad(rxDeg)
  const ry = degToRad(ryDeg)
  const rz = degToRad(rzDeg)
  const rxM: number[][] = [
    [1, 0, 0],
    [0, Math.cos(rx), -Math.sin(rx)],
    [0, Math.sin(rx), Math.cos(rx)],
  ]
  const ryM: number[][] = [
    [Math.cos(ry), 0, Math.sin(ry)],
    [0, 1, 0],
    [-Math.sin(ry), 0, Math.cos(ry)],
  ]
  const rzM: number[][] = [
    [Math.cos(rz), -Math.sin(rz), 0],
    [Math.sin(rz), Math.cos(rz), 0],
    [0, 0, 1],
  ]
  // 依次绕新轴旋转 ⇒ 后乘：R = Rx·Ry·Rz。
  return mat3Mul(rxM, mat3Mul(ryM, rzM))
}

/** Offs：沿 Object 坐标系的 X/Y/Z 平移。 */
export function offsRobTarget(target: RobTarget, x: number, y: number, z: number): RobTarget {
  return {
    ...target,
    trans: [target.trans[0] + x, target.trans[1] + y, target.trans[2] + z],
  }
}

/** RelTool：沿工具坐标系的 Dx/Dy/Dz 平移，并可选绕工具轴旋转（仅当三个旋转参数都给定时）。 */
export function relToolRobTarget(
  target: RobTarget,
  dx: number,
  dy: number,
  dz: number,
  rx?: number,
  ry?: number,
  rz?: number,
): RobTarget {
  const r0 = quaternionToRotationMatrix(rapidQuatToInternal(target.rot))
  // 位移沿输入点定义的当前工具坐标系（其 x/y/z 轴即 r0 的列）。
  const trans = Matrix4x4.mat3Vec3Mul(r0, [dx, dy, dz])
  const position = [target.trans[0] + trans[0], target.trans[1] + trans[1], target.trans[2] + trans[2]] as RobTarget['trans']

  if (rx === undefined || ry === undefined || rz === undefined) {
    return { ...target, trans: position }
  }
  // 先绕 x、再新 y、最后新 z：R = r0 · Rx·Ry·Rz。
  const rotation = mat3Mul(r0, toolEulerRotation(rx, ry, rz))
  const quat = rotationMatrixToQuaternion(rotation)
  return { ...target, trans: position, rot: internalQuatToRapid(quat) }
}
