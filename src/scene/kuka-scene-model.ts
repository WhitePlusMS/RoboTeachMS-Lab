import * as THREE from 'three'
import { orientationError, quaternionToRotationMatrix, rotationMatrixToEulerZYX } from '../robotics/math/rotation3d.ts'
import type { RobotModel } from '../robotics/robot-model.ts'
import type { JointAngles, Pose } from '../robotics/types.ts'

type ApplyJointAngles = (root: THREE.Group, joints: JointAngles) => void

/**
 * 直接从独立场景中的 KUKA GLB Pivot 采样 FK/Jacobian。
 * 这对应原项目的 GLBRobotModel，避免 DH 链与实际 GLB 轴向产生分叉。
 */
export class KukaSceneRobotModel implements RobotModel {
  private currentJoints: JointAngles
  private readonly root: THREE.Group
  private readonly applyJoints: ApplyJointAngles

  constructor(
    root: THREE.Group,
    applyJoints: ApplyJointAngles,
    initialJoints: JointAngles,
  ) {
    this.root = root
    this.applyJoints = applyJoints
    this.currentJoints = [...initialJoints]
  }

  isAvailable(): boolean {
    return true
  }

  setCurrentJoints(joints: JointAngles): void {
    this.currentJoints = [...joints]
  }

  forwardKinematics(jointsDeg: JointAngles): Pose | null {
    const restoreJoints = [...this.currentJoints] as JointAngles
    this.applyJoints(this.root, jointsDeg)
    this.root.updateMatrixWorld(true)
    const flange = this.root.getObjectByName('Pivot_快拆机器人端口') ?? this.root.getObjectByName('快拆机器人端口')
    if (!flange) {
      this.applyJoints(this.root, restoreJoints)
      this.root.updateMatrixWorld(true)
      return null
    }

    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    flange.matrixWorld.decompose(position, quaternion, scale)
    const rotation = quaternionToRotationMatrix([
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
    ])
    const pose: Pose = {
      position: [position.x * 1000, position.y * 1000, position.z * 1000],
      euler: rotationMatrixToEulerZYX(rotation),
      rotation,
    }

    this.applyJoints(this.root, restoreJoints)
    this.root.updateMatrixWorld(true)
    return pose
  }

  estimateJacobian(jointsDeg: JointAngles, stepDeg = 0.2): number[][] | null {
    const basePose = this.forwardKinematics(jointsDeg)
    if (!basePose) return null
    const jacobian = Array.from({ length: 6 }, () => Array<number>(6).fill(0))

    for (let jointIndex = 0; jointIndex < 6; jointIndex += 1) {
      const offsetJoints = [...jointsDeg] as JointAngles
      offsetJoints[jointIndex] += stepDeg
      const offsetPose = this.forwardKinematics(offsetJoints)
      if (!offsetPose) return null
      for (let axis = 0; axis < 3; axis += 1) {
        jacobian[axis][jointIndex] =
          (offsetPose.position[axis] - basePose.position[axis]) / stepDeg
      }
      const orientationDelta = orientationError(offsetPose.rotation, basePose.rotation)
      for (let axis = 0; axis < 3; axis += 1) {
        jacobian[axis + 3][jointIndex] = orientationDelta[axis] / stepDeg
      }
    }
    return jacobian
  }
}
