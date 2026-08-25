import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { RobotModel } from '@/robotics/model/robot-model.ts'
import type { JointAngles } from '@/robotics/model/types.ts'
import { DEFAULT_JOINTS } from '@/robot-models/kuka-like/parameters.ts'
import { KukaSceneRobotModel } from './kuka-scene-model.ts'
import {
  createBaseScene,
  createSceneController,
  findNode as findNodeShared,
  type SceneDisplayConfig,
} from './scene-factory.ts'

/** KUKA 资产属于独立应用自己的 public 目录。 */
export const KUKA_MODEL_URL = import.meta.env.BASE_URL + 'models/KUKA_V1.glb'
export const KUKA_MODEL_SCALE = 0.0943
export const KUKA_JOINT_NODE_NAMES = [
  '转台',
  '大臂',
  '小臂',
  '回转机构',
  '末端关节',
  '快拆机器人端口',
] as const

const KUKA_JOINT_AXES: Record<(typeof KUKA_JOINT_NODE_NAMES)[number], THREE.Vector3> = {
  转台: new THREE.Vector3(0, 0, 1),
  大臂: new THREE.Vector3(0, 1, 0),
  小臂: new THREE.Vector3(0, 1, 0),
  回转机构: new THREE.Vector3(1, 0, 0),
  末端关节: new THREE.Vector3(0, 1, 0),
  快拆机器人端口: new THREE.Vector3(0, 0, 1),
}

export type KukaSceneStatus = 'loading' | 'ready' | 'error'

export interface KukaSceneOptions {
  onStatus?: (status: KukaSceneStatus) => void
  onModel?: (model: RobotModel | null) => void
  onTrajectoryCount?: (count: number) => void
  showGrid?: boolean
  showCoordinateSystems?: boolean
  showTrajectory?: boolean
}

export interface KukaSceneController {
  setJoints: (joints: JointAngles) => void
  setGridVisible: (visible: boolean) => void
  setCoordinateSystemsVisible: (visible: boolean) => void
  setTrajectoryVisible: (visible: boolean) => void
  clearTrajectory: () => void
  dispose: () => void
}

/** 在场景树中按名称查找节点，供模型适配和后续关节控制复用。 */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return findNodeShared(root, name)
}

/**
 * 根据 GLB 底座包围盒把模型抬到地面上方。
 * 计算使用模型原始单位，缩放后再应用到场景单位。
 */
export function calculateModelLift(model: THREE.Group): number {
  const baseNode = findNode(model, '固定底座')
  const bounds = new THREE.Box3().setFromObject(baseNode ?? model)
  if (bounds.isEmpty()) return 0
  return -bounds.min.y * KUKA_MODEL_SCALE
}

/** 将控制面板角度应用到已准备好的 KUKA Pivot 节点。 */
export function applyJointAngles(root: THREE.Group, joints: JointAngles): void {
  KUKA_JOINT_NODE_NAMES.forEach((name, index) => {
    const pivot = findNode(root, `Pivot_${name}`)
    const axis = KUKA_JOINT_AXES[name]
    if (!(pivot instanceof THREE.Group)) return

    const baseQuaternionArray = pivot.userData.baseQuaternion as
      [number, number, number, number] | undefined
    const baseQuaternion = baseQuaternionArray
      ? new THREE.Quaternion(...baseQuaternionArray)
      : new THREE.Quaternion()
    const deltaQuaternion = new THREE.Quaternion().setFromAxisAngle(
      axis,
      (joints[index] * Math.PI) / 180,
    )
    pivot.quaternion.copy(baseQuaternion).multiply(deltaQuaternion)
  })
}

function createFallbackRobot(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'KUKA_Fallback_Robot'

  const material = new THREE.MeshStandardMaterial({
    color: 0xe6a400,
    metalness: 0.35,
    roughness: 0.5,
  })
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x343b48,
    metalness: 0.6,
    roughness: 0.35,
  })

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.2, 32), darkMaterial)
  base.position.y = 0.1
  base.castShadow = true
  root.add(base)

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, 0.35), material)
  shoulder.position.set(0, 0.45, 0)
  shoulder.castShadow = true
  root.add(shoulder)

  const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.05, 0.28), material)
  upperArm.position.set(0, 1.15, 0)
  upperArm.rotation.z = -0.24
  upperArm.castShadow = true
  root.add(upperArm)

  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.95, 0.24), material)
  forearm.position.set(0.2, 1.9, 0)
  forearm.rotation.z = 0.38
  forearm.castShadow = true
  root.add(forearm)

  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.45, 24), darkMaterial)
  wrist.position.set(0.38, 2.52, 0)
  wrist.rotation.z = Math.PI / 2
  wrist.castShadow = true
  root.add(wrist)

  const tool = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 0.18), darkMaterial)
  tool.position.set(0.58, 2.52, 0)
  tool.castShadow = true

  /**
   * 占位模型没有真实 GLB 节点层级，因此为每个几何件建立同名 Pivot。
   * 这样加载失败时控制面板仍能驱动占位几何，且不会影响正式模型适配。
   */
  const addFallbackJoint = (
    name: (typeof KUKA_JOINT_NODE_NAMES)[number],
    mesh: THREE.Mesh,
  ): void => {
    const pivot = new THREE.Group()
    pivot.name = `Pivot_${name}`
    pivot.position.copy(mesh.position)
    pivot.quaternion.copy(mesh.quaternion)
    pivot.userData.baseQuaternion = pivot.quaternion.toArray()
    mesh.position.set(0, 0, 0)
    mesh.quaternion.identity()
    pivot.add(mesh)
    root.add(pivot)
  }

  addFallbackJoint('转台', base)
  addFallbackJoint('大臂', shoulder)
  addFallbackJoint('小臂', upperArm)
  addFallbackJoint('回转机构', forearm)
  addFallbackJoint('末端关节', wrist)
  addFallbackJoint('快拆机器人端口', tool)

  return root
}

function prepareModel(model: THREE.Group): THREE.Group {
  const clone = model.clone(true)
  const scaleGroup = new THREE.Group()
  scaleGroup.name = 'KUKA_Model_Scale'
  scaleGroup.scale.setScalar(KUKA_MODEL_SCALE)
  scaleGroup.add(clone)

  const root = new THREE.Group()
  root.name = 'KUKA_Benchmark_Robot'
  root.position.y = calculateModelLift(clone)
  root.add(scaleGroup)

  for (const jointName of KUKA_JOINT_NODE_NAMES) {
    const node = findNode(clone, jointName)
    if (!node?.parent) {
      console.warn(`[KukaScene] 未找到关节节点: ${jointName}`)
      continue
    }

    const parent = node.parent
    const pivot = new THREE.Group()
    pivot.name = `Pivot_${jointName}`
    pivot.position.copy(node.position)
    pivot.quaternion.copy(node.quaternion)
    pivot.userData.baseQuaternion = node.quaternion.toArray()

    parent.remove(node)
    node.position.set(0, 0, 0)
    node.quaternion.identity()
    pivot.add(node)
    parent.add(pivot)
  }

  applyJointAngles(root, DEFAULT_JOINTS)

  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })

  return root
}

const KUKA_DISPLAY: SceneDisplayConfig = {
  ariaLabel: 'KUKA 机器人三维场景',
  logTag: 'KukaScene',
  gridSize: 8,
  cameraPosition: [3.4, 2.35, 4.25],
  controlsTarget: [0, 1.1, 0],
  controlsMinDistance: 1.1,
  controlsMaxDistance: 12,
  keyLightPosition: [3.5, 5.5, 4],
  keyLightFar: 20,
  keyLightBounds: 5,
  fillLightPosition: [-4, 3, -2],
  bench: {
    name: 'KUKA_Benchmark_Workbench',
    topSize: [4.525, 0.08, 3.394],
    frameSize: [4.667, 0.08, 3.536],
  },
}

/** 创建不依赖浏览器渲染器的基准场景树，便于初始化测试和后续场景适配复用。 */
export function createBenchmarkScene(): THREE.Scene {
  return createBaseScene(KUKA_DISPLAY)
}

export function createKukaScene(
  container: HTMLElement,
  options: KukaSceneOptions = {},
): KukaSceneController {
  const onStatus = options.onStatus ?? (() => undefined)
  const onModel = options.onModel ?? (() => undefined)
  const onTrajectoryCount = options.onTrajectoryCount ?? (() => undefined)

  let robotModel: KukaSceneRobotModel | null = null

  const { controller, runtime } = createSceneController(container, {
    display: KUKA_DISPLAY,
    defaultJoints: [...DEFAULT_JOINTS],
    loadModel: (onSuccess, onError) => {
      const loader = new GLTFLoader()
      loader.load(KUKA_MODEL_URL, (gltf) => onSuccess(gltf.scene), undefined, onError)
    },
    prepareModel,
    applyJoints: applyJointAngles,
    findToolNode: (root) =>
      findNode(root, 'Pivot_快拆机器人端口') ?? findNode(root, '快拆机器人端口'),
    createFallbackRobot,
    onStatus,
    onTrajectoryCount,
    showGrid: options.showGrid,
    showCoordinateSystems: options.showCoordinateSystems,
    showTrajectory: options.showTrajectory,
    onModelReady: (model) => {
      // 占位模型的 Pivot 只服务可视化，不构成真实串联运动链；IK 继续使用 App 的 DH 模型。
      robotModel = new KukaSceneRobotModel(model, applyJointAngles, runtime.currentJoints)
      onModel(robotModel)
    },
    onModelFallback: (fallback) => {
      applyJointAngles(fallback, runtime.currentJoints)
      robotModel = null
      onModel(null)
    },
    onJointUpdated: (joints) => robotModel?.setCurrentJoints(joints),
    onDispose: () => onModel(null),
  })

  return controller
}
