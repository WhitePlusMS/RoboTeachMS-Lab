import { describe, expect, it } from 'vitest'
import {
  abbPositionToSceneM,
  abbRotationToSceneRotation,
  scenePositionToAbbMm,
  sceneRotationToAbbRotation,
  sceneTransformToAbbPose,
} from './scene-pose-transform.ts'
import { rotationMatrixToEulerZYX, rotationMatrixToQuaternion } from './rotation3d.ts'
import { eulerZYXToMatrix } from '@/robotics/matrix4x4.ts'
import { AbbDhRobotModel } from '@/robot-models/abb-irb1200/dh-robot-model.ts'
import { ABB_BASE_TO_SCENE } from '@/scene/abb-scene-transform.ts'

describe('scene-pose-transform 场景 frame ↔ ABB 基座 frame', () => {
  const BASE_HEIGHT_MM = 400

  it('位置互转按 ABB_BASE_TO_SCENE 语义往返一致', () => {
    const abb: [number, number, number] = [100, 200, 300]
    const scene = abbPositionToSceneM(abb, BASE_HEIGHT_MM)
    expect(scene[0]).toBeCloseTo(0.1)
    // abb Z(300) → scene +Y，叠加 baseHeight
    expect(scene[1]).toBeCloseTo((300 + BASE_HEIGHT_MM) / 1000)
    // abb Y(200) → scene -Z
    expect(scene[2]).toBeCloseTo(-0.2)

    const back = scenePositionToAbbMm(scene, BASE_HEIGHT_MM)
    expect(back[0]).toBeCloseTo(100)
    expect(back[1]).toBeCloseTo(200)
    expect(back[2]).toBeCloseTo(300)
  })

  it('zero baseHeight 时不抬升场景 Y', () => {
    const abb: [number, number, number] = [0, 0, 500]
    const scene = abbPositionToSceneM(abb, 0)
    expect(scene[1]).toBeCloseTo(0.5)
  })

  it('旋转基变换：单位矩阵保持单位', () => {
    const identity = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const abb = sceneRotationToAbbRotation(identity)
    expect(abb[0][0]).toBeCloseTo(1)
    expect(abb[1][1]).toBeCloseTo(1)
    expect(abb[2][2]).toBeCloseTo(1)
    expect(abb[0][1]).toBeCloseTo(0)
    expect(abb[1][0]).toBeCloseTo(0)
  })

  it('旋转基变换是自身逆（scene↔ABB 往返回到原始旋转）', () => {
    const euler: [number, number, number] = [0.35, -0.2, 0.5]
    const sceneRotation = eulerZYXToMatrix(euler)
    const abb = sceneRotationToAbbRotation(sceneRotation)
    // 逆变换 R_scene = M · R_abb · M^T，回到原始场景旋转
    const backToScene = abbRotationToSceneRotation(abb)
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        expect(backToScene[row][col]).toBeCloseTo(sceneRotation[row][col])
      }
    }
  })

  it('sceneTransformToAbbPose 位置与姿态正确', () => {
    const pose = sceneTransformToAbbPose([0.2, 0.5, -0.1], [0, 0, 0, 1], BASE_HEIGHT_MM)
    // abb_y = -scene_z = 100mm；abb_z = (scene_y - baseHeight) = (0.5-0.4)*1000 = 100mm
    expect(pose.position[0]).toBeCloseTo(200)
    expect(pose.position[1]).toBeCloseTo(100)
    expect(pose.position[2]).toBeCloseTo(100)
    expect(pose.rotation).toHaveLength(3)
    const euler = rotationMatrixToEulerZYX(pose.rotation)
    expect(euler).toHaveLength(3)
  })

  it('abb→scene→abb 位置在含 baseHeight 时往返稳定（数值一致）', () => {
    const originalAbb: [number, number, number] = [55, -88, 120]
    const scene = abbPositionToSceneM(originalAbb, BASE_HEIGHT_MM)
    const round = scenePositionToAbbMm(scene, BASE_HEIGHT_MM)
    expect(round[0]).toBeCloseTo(originalAbb[0])
    expect(round[1]).toBeCloseTo(originalAbb[1])
    expect(round[2]).toBeCloseTo(originalAbb[2])
  })

  it('与 DH FK 闭环：ABB 法兰位姿 → 场景 → 回 ABB，恢复原 Pose', () => {
    const model = new AbbDhRobotModel()
    const joints: [number, number, number, number, number, number] = [15, -20, 35, 0, 25, 0]
    const fk = model.forwardKinematics(joints)
    expect(fk).not.toBeNull()
    if (!fk) return

    // ABB 位姿 → 场景 frame（位置米 + 四元数）
    const scenePos = abbPositionToSceneM(fk.position, BASE_HEIGHT_MM)
    const sceneQuat = rotationMatrixToQuaternion(abbRotationToSceneRotation(fk.rotation))

    // 场景 → ABB Pose（gizmo 拖拽目标构造路径）
    const recovered = sceneTransformToAbbPose(scenePos, sceneQuat, BASE_HEIGHT_MM)

    // 位置应在毫米量级一致（数值浮点）
    expect(recovered.position[0]).toBeCloseTo(fk.position[0], 6)
    expect(recovered.position[1]).toBeCloseTo(fk.position[1], 6)
    expect(recovered.position[2]).toBeCloseTo(fk.position[2], 6)

    // 姿态：旋转矩阵应一致
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        expect(recovered.rotation[row][col]).toBeCloseTo(fk.rotation[row][col], 6)
      }
    }
  })

  it('base-height 语义自洽：FK 原点(z_abb=0)落于场景 y=baseHeight', () => {
    // 与既有 robtarget/DH 显示语义一致：ABB z=0（基座安装面）在场景里对应 y=baseHeight。
    // 因此 gizmo 从场景取到法兰世界位姿后，减去 baseHeight 才能还原 DH 的 z（如上叠加）。
    const sceneOriginY = BASE_HEIGHT_MM / 1000
    const back = scenePositionToAbbMm([0.5, sceneOriginY, -0.3], BASE_HEIGHT_MM)
    expect(back[2]).toBeCloseTo(0)
    // 抬高 baseHeight 后，z_abb 相应为正
    const raised = scenePositionToAbbMm([0.5, sceneOriginY + 0.2, -0.3], BASE_HEIGHT_MM)
    expect(raised[2]).toBeCloseTo(200)
  })

  it('旋转常量与单一真源 ABB_BASE_TO_SCENE 一致（防 Divergent Change）', () => {
    // 场景→ABB 的位置映射 = 场景 Y 减 baseHeight 后，再按 ABB_BASE_TO_SCENE 逆向；
    // 这里验证「纯 Z 抬升」这一最简情形在真源上成立，即 abbBaseFrameToSceneFrame 对原点
    // 施加的正是我们手写常量所表达的轴映射。
    const m = ABB_BASE_TO_SCENE.getRotation()
    // m 把 ABB 基向量映到场景：X→(1,0,0), Y→(0,0,-1), Z→(0,1,0)
    expect(m[0][0]).toBeCloseTo(1)
    expect(m[1][2]).toBeCloseTo(1) // Z 列第 2 行 = scene +Y
    expect(m[2][1]).toBeCloseTo(-1) // Y 列第 3 行 = scene -Z
  })

  it('与 DH FK 闭环：ABB 法兰位姿 → 场景 → 回 ABB，位置与旋转完全一致', () => {
    const model = new AbbDhRobotModel()
    const joints: [number, number, number, number, number, number] = [15, -20, 35, 0, 25, 0]
    const fk = model.forwardKinematics(joints)
    if (!fk) return

    const scenePos = abbPositionToSceneM(fk.position, BASE_HEIGHT_MM)
    const sceneQuat = rotationMatrixToQuaternion(abbRotationToSceneRotation(fk.rotation))
    const target = sceneTransformToAbbPose(scenePos, sceneQuat, BASE_HEIGHT_MM)

    // 位置毫米量级一致 + 旋转矩阵逐元素一致，验证拖拽目标构造路径不丢任何自由度
    expect(target.position[0]).toBeCloseTo(fk.position[0], 6)
    expect(target.position[1]).toBeCloseTo(fk.position[1], 6)
    expect(target.position[2]).toBeCloseTo(fk.position[2], 6)
    expect(target.euler).toHaveLength(3)
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        expect(target.rotation[row][col]).toBeCloseTo(fk.rotation[row][col], 6)
      }
    }
  })
})
