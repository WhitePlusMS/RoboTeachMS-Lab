import { describe, expect, it } from 'vitest'
import { Matrix4x4 } from '../robotics/matrix4x4.ts'
import { extractPose } from '../robotics/kinematics.ts'
import { forwardAbbKinematicsDegrees } from '../robot-models/abb-irb1200/abb-kinematics.ts'
import {
  ABB_FLANGE_TO_FBX_TOOL,
  abbBaseFrameToSceneFrame,
} from './abb-scene-transform.ts'

describe('ABB 场景显示适配', () => {
  it('ABB 基座零位机械法兰经显示转换后映射到 Three.js 坐标', () => {
    const flange = forwardAbbKinematicsDegrees([0, 0, 0, 0, 0, 0])
    const scene = abbBaseFrameToSceneFrame(flange)
    const position = scene.getPosition()

    expect(position[0]).toBeCloseTo(451)
    expect(position[1]).toBeCloseTo(807.1)
    expect(position[2]).toBeCloseTo(0)
  })

  it('ABB 基座 frame → 场景是纯固定旋转，不引入平移', () => {
    const scene = abbBaseFrameToSceneFrame(Matrix4x4.identity())
    expect(scene.getPosition()).toEqual([0, 0, 0])
  })

  it('视觉工具偏移只在显式组合 ABB_FLANGE_TO_FBX_TOOL 时参与：场景法兰与视觉工具位置不同', () => {
    const flange = forwardAbbKinematicsDegrees([0, 0, 0, 0, 0, 0])
    const sceneFlange = abbBaseFrameToSceneFrame(flange)
    const sceneFlangePose = extractPose(sceneFlange)

    // 场景法兰（机械法兰，三轴视图 Y 上）仍位于 [451, 807.1, 0]，不携带视觉工具偏移。
    expect(sceneFlangePose.position[0]).toBeCloseTo(451)
    expect(sceneFlangePose.position[1]).toBeCloseTo(807.1)
    expect(sceneFlangePose.position[2]).toBeCloseTo(0)

    // 仅当在测试中显式执行“场景法兰 frame × 视觉工具偏移”时，才得到视觉工具节点位置。
    const visualTool = sceneFlange.multiply(ABB_FLANGE_TO_FBX_TOOL)
    const visualToolPose = extractPose(visualTool)
    expect(visualToolPose.position[0]).toBeCloseTo(451)
    expect(visualToolPose.position[1]).toBeCloseTo(713.197792)
    expect(visualToolPose.position[2]).toBeCloseTo(0)

    // 差异来自显式视觉变换：两处位置在场景 Y 轴相差 FBX joint7 的 93.902208 mm 偏移。
    const deltaY = sceneFlangePose.position[1] - visualToolPose.position[1]
    expect(deltaY).toBeCloseTo(93.902208)
  })
})
