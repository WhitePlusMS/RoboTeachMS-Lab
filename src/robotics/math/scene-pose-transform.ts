import type { Pose } from '@/robotics/model/index.ts'
import { rotationMatrixToEulerZYX } from '@/robotics/math/rotation3d.ts'
import {
  quaternionToRotationMatrix,
  rotationMatrixToQuaternion,
} from '@/robotics/math/rotation3d.ts'

/**
 * Three.js 场景坐标(frame，米、Y 上)与 ABB 机器人基座坐标(frame，毫米、Z 上)的纯函数互转。
 *
 * 唯一场景显示转换 `ABB_BASE_TO_SCENE`（见 scene/abb-scene-transform.ts）负责展示适配，本模块
 * 只做它的数学逆像，供「末端拖拽操作轴」把 gizmo 的世界位姿换算成 DH 逆解器可用的 ABB Pose。
 * 基座高度 `baseHeightMm`（FBX 底座/支架抬升量）不在运动学真值内，只在显示时叠加，因此换算时
 * 必须把场景 Y 减去 baseHeight 再乘以 1000；旋转矩阵的基变换同理。
 *
 * 注意：下方两个 3x3 常量是 `ABB_BASE_TO_SCENE`（scene/abb-scene-transform.ts，单一真源）左上
 * 3x3 的手工副本。本模块位于纯数学层，故意不 import 场景显示层以避免反向依赖；一致性由测试
 * `scene-pose-transform.test.ts` 的「与 ABB_BASE_TO_SCENE 一致」断言锁定。若改真源须同步这里。
 */

/** ABB → 场景的 3x3 旋转矩阵（同一 M，见 ABB_BASE_TO_SCENE 左上 3x3）。 */
const ABB_TO_SCENE_ROTATION: readonly (readonly number[])[] = [
  [1, 0, 0],
  [0, 0, 1],
  [0, -1, 0],
]

/** 场景 → ABB 的 3x3 旋转矩阵（M 的转置）。 */
const SCENE_TO_ABB_ROTATION: readonly (readonly number[])[] = [
  [1, 0, 0],
  [0, 0, -1],
  [0, 1, 0],
]

function multiply3x3(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[],
): number[][] {
  return Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) =>
      left[row].reduce((sum, value, index) => sum + value * right[index][column], 0),
    ),
  )
}

/**
 * 把场景旋转矩阵变换到 ABB 基，即 R_abb = M^T · R_scene · M。
 * 这是基变换（similarity transform），保证「同一物理旋转」在两个坐标系下表达一致。
 */
export function sceneRotationToAbbRotation(
  sceneRotation: readonly (readonly number[])[],
): number[][] {
  return multiply3x3(SCENE_TO_ABB_ROTATION, multiply3x3(sceneRotation, ABB_TO_SCENE_ROTATION))
}

/** sceneRotationToAbbRotation 的逆：R_scene = M · R_abb · M^T。 */
export function abbRotationToSceneRotation(
  abbRotation: readonly (readonly number[])[],
): number[][] {
  return multiply3x3(ABB_TO_SCENE_ROTATION, multiply3x3(abbRotation, SCENE_TO_ABB_ROTATION))
}

/**
 * 把场景位置（米）换算为 ABB 基座位置（毫米）。
 * 场景 Y 需先减去 baseHeightMm（米），因为我们只对运动学真值做换算，而不含显示层抬升。
 */
export function scenePositionToAbbMm(
  position: readonly [number, number, number],
  baseHeightMm: number,
): [number, number, number] {
  const sceneHeightOffset = Math.max(0, baseHeightMm) / 1000
  return [position[0] * 1000, -position[2] * 1000, (position[1] - sceneHeightOffset) * 1000]
}

/** 场景位置（米）回换算为 ABB 基座位置（毫米）：与 scenePositionToAbbMm 互为逆。 */
export function abbPositionToSceneM(
  abbPosition: readonly [number, number, number],
  baseHeightMm: number,
): [number, number, number] {
  const sceneHeightOffset = Math.max(0, baseHeightMm) / 1000
  return [abbPosition[0] / 1000, abbPosition[2] / 1000 + sceneHeightOffset, -abbPosition[1] / 1000]
}

/**
 * ABB 机械法兰 Pose（毫米 + 旋转矩阵）→ Three.js 场景位姿（米 + 四元数）。
 *
 * 操作轴必须以 DH FK 的机械法兰为唯一跟随基准，不能直接把 FBX 骨骼原点当作
 * IK 目标；FBX 与候选 DH 存在约 12 mm 的视觉建模偏差。该逆变换与
 * `sceneTransformToAbbPose` 成对使用，避免旋转拖拽从视觉偏差姿态开始求解。
 */
export function abbPoseToSceneTransform(
  pose: Pose,
  baseHeightMm: number,
): {
  position: [number, number, number]
  quaternion: [number, number, number, number]
} {
  return {
    position: abbPositionToSceneM(pose.position, baseHeightMm),
    quaternion: rotationMatrixToQuaternion(abbRotationToSceneRotation(pose.rotation)),
  }
}

/**
 * 场景 gizmo 世界位姿（位置米 + 四元数）→ ABB 逆解器可用的 Pose（毫米 + 旋转矩阵 + euler）。
 * 供 TransformControls 拖拽回调读取 dummy 后构造 IK 目标。
 */
export function sceneTransformToAbbPose(
  scenePosition: readonly [number, number, number],
  sceneQuaternion: readonly [number, number, number, number],
  baseHeightMm: number,
): Pose {
  const rotation = sceneRotationToAbbRotation(quaternionToRotationMatrix([...sceneQuaternion]))
  return {
    position: scenePositionToAbbMm(scenePosition, baseHeightMm),
    euler: rotationMatrixToEulerZYX(rotation),
    rotation,
  }
}
