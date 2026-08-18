import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ABB_ACTIVE_JOINT_NODE_NAMES,
  ABB_BASE_NODE_NAME,
  ABB_FLANGE_NODE_NAME,
  ABB_JOINT_AXES,
  ABB_MODEL_SCALE,
  ABB_TOOL_NODE_NAME,
  applyAbbJointAngles,
  calculateAbbModelLift,
  createAbbBenchmarkScene,
  findNode,
  prepareAbbModel,
} from './abb-scene.ts'
import { extractAbbFbxCalibration } from './abb-fbx-calibration.ts'

describe('ABB IRB 1200 FBX 场景适配器', () => {
  it('明确底座、六个主动轴、机械法兰和工具节点', () => {
    expect(ABB_BASE_NODE_NAME).toBe('dizuo')
    expect(ABB_ACTIVE_JOINT_NODE_NAMES).toEqual([
      'joint1',
      'joint2',
      'joint3',
      'joint4',
      'joint5',
      'joint6',
    ])
    expect(ABB_FLANGE_NODE_NAME).toBe('joint6')
    expect(ABB_TOOL_NODE_NAME).toBe('joint7')
    expect(ABB_MODEL_SCALE).toBe(0.01)
  })

  it('只按 dizuo 包围盒计算模型抬升量', () => {
    const model = new THREE.Group()
    const base = new THREE.Group()
    base.name = ABB_BASE_NODE_NAME
    base.position.y = -12
    base.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)))
    model.add(base)

    expect(findNode(model, ABB_BASE_NODE_NAME)).toBe(base)
    expect(findNode(model, 'missing')).toBeNull()
    expect(calculateAbbModelLift(model)).toBeCloseTo(0.13)
  })

  it('保留导入姿态并写入底座与末端映射元数据', () => {
    const model = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1))
    base.name = ABB_BASE_NODE_NAME
    const joint = new THREE.Bone()
    joint.name = 'joint1'
    const flange = new THREE.Bone()
    flange.name = ABB_FLANGE_NODE_NAME
    const tool = new THREE.Bone()
    tool.name = ABB_TOOL_NODE_NAME
    flange.add(tool)
    joint.add(flange)
    model.add(base, joint)

    const prepared = prepareAbbModel(model)
    expect(prepared.userData.baseNodeName).toBe(ABB_BASE_NODE_NAME)
    expect(prepared.userData.flangeNodeName).toBe(ABB_FLANGE_NODE_NAME)
    expect(prepared.userData.toolNodeName).toBe(ABB_TOOL_NODE_NAME)
    expect(findNode(prepared, 'joint1')?.userData.baseQuaternion).toEqual([0, 0, 0, 1])
  })

  it('只驱动六个主动关节，不改变底座和工具节点自身角度', () => {
    const root = new THREE.Group()
    const base = new THREE.Group()
    base.name = ABB_BASE_NODE_NAME
    const joint = new THREE.Bone()
    joint.name = 'joint1'
    const tool = new THREE.Bone()
    tool.name = ABB_TOOL_NODE_NAME
    joint.add(tool)
    root.add(base, joint)
    root.traverse((node) => {
      if (node.name.startsWith('joint')) node.userData.baseQuaternion = node.quaternion.toArray()
    })
    applyAbbJointAngles(root, [90, 0, 0, 0, 0, 0])

    expect(joint.quaternion.y).toBeCloseTo(Math.SQRT1_2)
    expect(joint.quaternion.w).toBeCloseTo(Math.SQRT1_2)
    expect(tool.quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(base.quaternion.toArray()).toEqual([0, 0, 0, 1])
  })

  it('提取六个关节的零位变换、旋转中心和原有手工轴', () => {
    const root = new THREE.Group()
    const joint1 = new THREE.Bone()
    joint1.name = 'joint1'
    joint1.position.set(10, 20, 30)
    const joint2 = new THREE.Bone()
    joint2.name = 'joint2'
    joint2.position.set(0, 40, 0)
    const flange = new THREE.Bone()
    flange.name = ABB_FLANGE_NODE_NAME
    const tool = new THREE.Bone()
    tool.name = ABB_TOOL_NODE_NAME
    flange.add(tool)
    joint2.add(flange)
    joint1.add(joint2)
    root.add(joint1)
    root.traverse((node) => {
      if (node.name.startsWith('joint')) node.userData.baseQuaternion = node.quaternion.toArray()
    })

    const calibration = extractAbbFbxCalibration(root)
    expect(calibration.joints.map((joint) => joint.name)).toEqual(['joint1', 'joint2', 'joint6'])
    expect(calibration.joints[0].configuredAxisLocal).toEqual([0, 1, 0])
    expect(calibration.joints[0].rotationCenterMm).toEqual([10_000, 20_000, 30_000])
    expect(calibration.joints[1].rotationCenterMm).toEqual([10_000, 60_000, 30_000])
    expect(calibration.joints[0].localZeroTransform[0][3]).toBe(10)
    expect(calibration.mechanicalFlangeWorldZeroTransform).not.toBeNull()
    expect(calibration.toolWorldZeroTransform).not.toBeNull()
    expect(ABB_JOINT_AXES.joint1.toArray()).toEqual([0, 1, 0])
  })

  it('创建 ABB 工作台、地面网格和世界坐标轴', () => {
    const scene = createAbbBenchmarkScene()
    expect(scene.getObjectByName('ABB_Benchmark_Workbench')).not.toBeNull()
    expect(scene.getObjectByName('Ground_Grid')).not.toBeNull()
    expect(scene.getObjectByName('BaseAxesHelper')).not.toBeNull()
  })
})
