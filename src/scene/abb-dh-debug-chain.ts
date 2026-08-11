import * as THREE from 'three'
import type { JointAngles } from '../core/robot/types'
import { forwardAbbKinematicsFramesDegrees } from '../robots/abb-irb1200/abb-kinematics'

const DH_FRAME_NAMES = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'FLANGE'] as const
const DH_FRAME_COLORS = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x00c7be, 0x007aff, 0xaf52de]
const DH_SCENE_UNIT = 0.001
const DH_MARKER_RADIUS = 0.035
const DH_AXIS_LENGTH = 0.16

export interface AbbDhDebugChain {
  group: THREE.Group
  update: (joints: JointAngles) => void
  setBaseHeightMm: (heightMm: number) => void
}

function matrixToThreeMatrix(matrix: number[][]): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    matrix[0][0], matrix[0][1], matrix[0][2], 0,
    matrix[1][0], matrix[1][1], matrix[1][2], 0,
    matrix[2][0], matrix[2][1], matrix[2][2], 0,
    0, 0, 0, 1,
  )
}

function createMarker(name: string, color: number): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(DH_MARKER_RADIUS, 16, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false, toneMapped: false }),
  )
  marker.name = `ABB_DH_${name}_Origin`
  marker.renderOrder = 1001
  return marker
}

/** 创建可视化当前候选 DH 原点和连杆的参考链，不参与 FBX 运动。 */
export function createAbbDhDebugChain(): AbbDhDebugChain {
  const group = new THREE.Group()
  group.name = 'ABB_DH_Debug_Chain'
  group.renderOrder = 1000

  const setBaseHeightMm = (heightMm: number): void => {
    group.position.y = Math.max(0, heightMm) * DH_SCENE_UNIT
  }

  const markers = DH_FRAME_NAMES.map((name, index) => {
    const marker = createMarker(name, DH_FRAME_COLORS[index])
    group.add(marker)
    return marker
  })

  const axes = DH_FRAME_NAMES.map((name) => {
    const helper = new THREE.AxesHelper(DH_AXIS_LENGTH)
    helper.name = `ABB_DH_${name}_Axes`
    helper.renderOrder = 1000
    group.add(helper)
    return helper
  })

  const linePositions = new Float32Array(DH_FRAME_NAMES.length * 3)
  const lineGeometry = new THREE.BufferGeometry()
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))
  const line = new THREE.Line(
    lineGeometry,
    new THREE.LineBasicMaterial({ color: 0xff4d4f, depthTest: false, toneMapped: false }),
  )
  line.name = 'ABB_DH_Debug_Links'
  line.renderOrder = 1000
  group.add(line)

  const update = (joints: JointAngles): void => {
    const frames = forwardAbbKinematicsFramesDegrees(joints)
    frames.forEach((frame, index) => {
      const position = frame.getPosition()
      const rotation = matrixToThreeMatrix(frame.getRotation())
      const scenePosition = new THREE.Vector3(
        position[0] * DH_SCENE_UNIT,
        position[1] * DH_SCENE_UNIT,
        position[2] * DH_SCENE_UNIT,
      )

      markers[index].position.copy(scenePosition)
      axes[index].position.copy(scenePosition)
      axes[index].setRotationFromMatrix(rotation)
      linePositions[index * 3] = scenePosition.x
      linePositions[index * 3 + 1] = scenePosition.y
      linePositions[index * 3 + 2] = scenePosition.z
    })
    lineGeometry.attributes.position.needsUpdate = true
    lineGeometry.computeBoundingSphere()
  }

  return { group, update, setBaseHeightMm }
}
