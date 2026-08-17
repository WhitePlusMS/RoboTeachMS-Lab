import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  calculateModelLift,
  createBenchmarkScene,
  findNode,
  applyJointAngles,
  KUKA_JOINT_NODE_NAMES,
  KUKA_MODEL_SCALE,
} from './kuka-scene.ts'
import { createBaseAxes, createToolAxes } from './scene-helpers.ts'
import { appendTrajectoryPoint } from './trajectory.ts'

describe('KUKA 场景适配器', () => {
  it('公开六个 KUKA 关节节点名称和独立模型缩放', () => {
    expect(KUKA_JOINT_NODE_NAMES).toHaveLength(6)
    expect(KUKA_MODEL_SCALE).toBeGreaterThan(0)
  })

  it('可以在场景树中查找命名节点并计算底座抬升量', () => {
    const model = new THREE.Group()
    const base = new THREE.Group()
    base.name = '固定底座'
    base.position.y = -12
    base.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)))
    model.add(base)

    expect(findNode(model, '固定底座')).toBe(base)
    expect(findNode(model, 'missing')).toBeNull()
    expect(calculateModelLift(model)).toBeCloseTo(13 * KUKA_MODEL_SCALE)
  })

  it('可以建立包含工作台、地面网格和世界坐标轴的基准场景', () => {
    const scene = createBenchmarkScene()

    expect(scene.getObjectByName('KUKA_Benchmark_Workbench')).not.toBeNull()
    expect(scene.getObjectByName('Ground_Grid')).not.toBeNull()
    expect(scene.getObjectByName('BaseAxesHelper')).not.toBeNull()
  })

  it('会把关节角度应用到对应的 Pivot 节点', () => {
    const root = new THREE.Group()
    const pivot = new THREE.Group()
    pivot.name = 'Pivot_转台'
    pivot.userData.baseQuaternion = [0, 0, 0, 1]
    root.add(pivot)

    applyJointAngles(root, [90, 0, 0, 0, 0, 0])

    expect(pivot.quaternion.z).toBeCloseTo(Math.SQRT1_2)
    expect(pivot.quaternion.w).toBeCloseTo(Math.SQRT1_2)
  })

  it('创建基坐标和工具坐标辅助轴', () => {
    expect(createBaseAxes().name).toBe('BaseAxesHelper')
    expect(createToolAxes().name).toBe('ToolAxesHelper')
  })

  it('轨迹采样会去重并限制最大点数', () => {
    const first = appendTrajectoryPoint([], [0, 0, 0], 2)
    const duplicate = appendTrajectoryPoint(first, [0.0005, 0, 0], 2)
    const second = appendTrajectoryPoint(duplicate, [0.01, 0, 0], 2)
    const third = appendTrajectoryPoint(second, [0.02, 0, 0], 2)

    expect(duplicate).toEqual(first)
    expect(third).toEqual([
      [0.01, 0, 0],
      [0.02, 0, 0],
    ])
  })
})
