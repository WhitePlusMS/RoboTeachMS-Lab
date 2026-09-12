/// <reference types="node" />

import fs from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { forwardAbbKinematicsFramesDegrees } from '@/robot-models/abb-irb1200/index.ts'
import type { JointAngles } from '@/robot-geometry/robot-types.ts'
import { abbBaseFrameToSceneFrame } from './abb-scene-transform.ts'
import {
  ABB_ACTIVE_JOINT_NODE_NAMES,
  ABB_JOINT_AXES,
  ABB_TOOL_NODE_NAME,
  applyAbbJointAngles,
  findNode,
  prepareAbbModel,
} from './abb-scene.ts'

function loadPreparedAbbModel(): THREE.Group {
  const bytes = fs.readFileSync('public/models/ABB_IRB1200_5_90.fbx')
  const model = new FBXLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  )
  return prepareAbbModel(model)
}

function worldPosition(node: THREE.Object3D): THREE.Vector3 {
  return node.getWorldPosition(new THREE.Vector3())
}

function worldAxis(node: THREE.Object3D, localAxis: THREE.Vector3): THREE.Vector3 {
  return localAxis
    .clone()
    .applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()))
    .normalize()
}

function distanceToAxis(
  point: THREE.Vector3,
  axisOrigin: THREE.Vector3,
  axisDirection: THREE.Vector3,
): number {
  return point.clone().sub(axisOrigin).cross(axisDirection).length()
}

describe('ABB FBX 六轴面板关节运动', () => {
  it('六个 FBX 正向旋转轴逐一与 DH 关节轴同向', () => {
    const model = loadPreparedAbbModel()
    const zero: JointAngles = [0, 0, 0, 0, 0, 0]
    const dhFrames = forwardAbbKinematicsFramesDegrees(zero).map(abbBaseFrameToSceneFrame)

    ABB_ACTIVE_JOINT_NODE_NAMES.forEach((name, jointIndex) => {
      const joint = findNode(model, name)
      expect(joint).not.toBeNull()
      if (!joint) return

      applyAbbJointAngles(model, zero)
      model.updateMatrixWorld(true)
      const zeroPosition = worldPosition(joint)
      const zeroQuaternion = joint.getWorldQuaternion(new THREE.Quaternion())
      const fbxAxis = worldAxis(joint, ABB_JOINT_AXES[name])
      const dhRotation = dhFrames[jointIndex].getRotation()
      const dhAxis = new THREE.Vector3(
        dhRotation[0][2],
        dhRotation[1][2],
        dhRotation[2][2],
      ).normalize()

      // 轴线本身必须平行；点积为正还同时约束 ABB 面板正角与 DH 正角同向。
      expect(fbxAxis.dot(dhAxis), `${name} 的 FBX/DH 正轴`).toBeGreaterThan(0.999)

      const moved = [...zero] as JointAngles
      moved[jointIndex] = 5
      applyAbbJointAngles(model, moved)
      model.updateMatrixWorld(true)
      const movedPosition = worldPosition(joint)
      const movedQuaternion = joint.getWorldQuaternion(new THREE.Quaternion())
      const worldDelta = movedQuaternion.multiply(zeroQuaternion.invert()).normalize()
      const deltaAxis = new THREE.Vector3(worldDelta.x, worldDelta.y, worldDelta.z).normalize()

      // 单轴运动不能搬动自己的转轴中心，并且 +5° 的旋转向量必须沿 DH 正轴。
      expect(movedPosition.distanceTo(zeroPosition) * 1000, `${name} 的旋转中心`).toBeLessThan(0.01)
      expect(deltaAxis.dot(dhAxis), `${name} 的 +5° 方向`).toBeGreaterThan(0.999)
    })
  })

  it('J5 零位径向与 J4 轴同向，并围绕自身轴线带动末端', () => {
    const model = loadPreparedAbbModel()
    const joint4 = findNode(model, 'joint4')
    const joint5 = findNode(model, 'joint5')
    const tool = findNode(model, ABB_TOOL_NODE_NAME)
    expect(joint4).not.toBeNull()
    expect(joint5).not.toBeNull()
    expect(tool).not.toBeNull()
    if (!joint4 || !joint5 || !tool) return

    const zero: JointAngles = [0, 0, 0, 0, 0, 0]
    applyAbbJointAngles(model, zero)
    model.updateMatrixWorld(true)
    const joint4Origin = worldPosition(joint4)
    const joint5Origin = worldPosition(joint5)
    const joint4Axis = worldAxis(joint4, ABB_JOINT_AXES.joint4)
    const joint5Axis = worldAxis(joint5, ABB_JOINT_AXES.joint5)
    const zeroTool = worldPosition(tool)

    // 真实资产的建模误差应小于 1 mm；J5 轴线必须经过 J4 轴线的腕部交点。
    expect(distanceToAxis(joint5Origin, joint4Origin, joint4Axis) * 1000).toBeLessThan(1)
    const zeroRadial = zeroTool
      .clone()
      .sub(joint5Origin)
      .addScaledVector(joint5Axis, -zeroTool.clone().sub(joint5Origin).dot(joint5Axis))
      .normalize()
    // J5=0° 的轨迹缺口径向必须指向 J4 正轴；否则零位整体偏转 90°。
    expect(zeroRadial.dot(joint4Axis)).toBeGreaterThan(0.999)
    const zeroToolRadius = distanceToAxis(zeroTool, joint5Origin, joint5Axis)

    const moved: JointAngles = [0, 0, 0, 0, 5, 0]
    applyAbbJointAngles(model, moved)
    model.updateMatrixWorld(true)
    const movedJoint5Origin = worldPosition(joint5)
    const movedTool = worldPosition(tool)

    // 面板改 J5 只应改变姿态和末端位置，不应让旋转中心随动或改变半径。
    expect(movedJoint5Origin.distanceTo(joint5Origin) * 1000).toBeLessThan(0.01)
    expect(
      Math.abs(distanceToAxis(movedTool, movedJoint5Origin, joint5Axis) - zeroToolRadius) * 1000,
    ).toBeLessThan(0.01)
  })
})
