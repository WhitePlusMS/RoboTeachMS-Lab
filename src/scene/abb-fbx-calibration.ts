import * as THREE from 'three'
import {
  ABB_ACTIVE_JOINT_NODE_NAMES,
  ABB_FLANGE_NODE_NAME,
  ABB_JOINT_AXES,
  ABB_TOOL_NODE_NAME,
  findNode,
} from './abb-scene.ts'

export type AbbJointNodeName = (typeof ABB_ACTIVE_JOINT_NODE_NAMES)[number]
export type AbbVector3Tuple = [number, number, number]
export type AbbQuaternionTuple = [number, number, number, number]
export type AbbMatrixRows = [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
]

export interface AbbFbxJointCalibration {
  name: AbbJointNodeName
  parentName: string | null
  configuredAxisLocal: AbbVector3Tuple
  axisWorldAtZero: AbbVector3Tuple
  localZeroTransform: AbbMatrixRows
  worldZeroTransform: AbbMatrixRows
  localPosition: AbbVector3Tuple
  rotationCenterMm: AbbVector3Tuple
  worldZeroQuaternion: AbbQuaternionTuple
}

export interface AbbFbxCalibration {
  modelName: string
  joints: AbbFbxJointCalibration[]
  mechanicalFlangeWorldZeroTransform: AbbMatrixRows | null
  toolWorldZeroTransform: AbbMatrixRows | null
}

function vectorToTuple(vector: THREE.Vector3): AbbVector3Tuple {
  return [vector.x, vector.y, vector.z]
}

function quaternionToTuple(quaternion: THREE.Quaternion): AbbQuaternionTuple {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
}

function matrixToRows(matrix: THREE.Matrix4): AbbMatrixRows {
  const e = matrix.elements
  return [
    [e[0], e[4], e[8], e[12]],
    [e[1], e[5], e[9], e[13]],
    [e[2], e[6], e[10], e[14]],
    [e[3], e[7], e[11], e[15]],
  ]
}

/**
 * 从已经经过 prepareAbbModel 的 FBX 根节点提取零位标定数据。
 *
 * 约定：调用方应在提取前把六个关节设置为 [0, 0, 0, 0, 0, 0]。
 * localZeroTransform 保留 FBX 原始局部单位；rotationCenterMm 使用项目世界坐标，
 * 便于和 DH 的毫米坐标直接比较。configuredAxisLocal 原样读取现有手工轴定义，绝不重算或改写。
 */
export function extractAbbFbxCalibration(root: THREE.Group): AbbFbxCalibration {
  root.updateMatrixWorld(true)

  const joints = ABB_ACTIVE_JOINT_NODE_NAMES.flatMap((name) => {
    const joint = findNode(root, name)
    if (!joint) return []

    const worldQuaternion = new THREE.Quaternion()
    const worldPosition = new THREE.Vector3()
    joint.getWorldQuaternion(worldQuaternion)
    joint.getWorldPosition(worldPosition)

    const configuredAxis = ABB_JOINT_AXES[name].clone().normalize()
    const axisWorld = configuredAxis.clone().applyQuaternion(worldQuaternion).normalize()

    return [
      {
        name,
        parentName: joint.parent?.name || null,
        configuredAxisLocal: vectorToTuple(configuredAxis),
        axisWorldAtZero: vectorToTuple(axisWorld),
        localZeroTransform: matrixToRows(joint.matrix),
        worldZeroTransform: matrixToRows(joint.matrixWorld),
        localPosition: vectorToTuple(joint.position),
        rotationCenterMm: [worldPosition.x * 1000, worldPosition.y * 1000, worldPosition.z * 1000],
        worldZeroQuaternion: quaternionToTuple(worldQuaternion),
      } satisfies AbbFbxJointCalibration,
    ]
  })

  const flange = findNode(root, ABB_FLANGE_NODE_NAME)
  const tool = findNode(root, ABB_TOOL_NODE_NAME)
  return {
    modelName: root.name,
    joints,
    mechanicalFlangeWorldZeroTransform: flange ? matrixToRows(flange.matrixWorld) : null,
    toolWorldZeroTransform: tool ? matrixToRows(tool.matrixWorld) : null,
  }
}
