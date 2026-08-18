import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import type { JointAngles } from '@/robotics/types.ts'
import { ABB_DEFAULT_JOINTS } from '@/robot-models/abb-irb1200/robot-config.ts'
import { createAbbDhDebugChain } from './abb-dh-debug-chain.ts'
import {
  createBaseScene,
  createSceneController,
  findNode as findNodeShared,
  type SceneDisplayConfig,
} from './scene-factory.ts'

export const ABB_MODEL_URL = '/models/ABB_IRB1200_5_90.fbx'
/** FBX 资产的单位基线是厘米；项目场景使用米，位姿面板再转换为毫米。 */
export const ABB_MODEL_SCALE = 0.01
export const ABB_BASE_NODE_NAME = 'dizuo'
export const ABB_ACTIVE_JOINT_NODE_NAMES = [
  'joint1',
  'joint2',
  'joint3',
  'joint4',
  'joint5',
  'joint6',
] as const
/** joint6 是 ABB 机械法兰；joint7 及其 joint8/joint9 子树属于当前 FBX 携带的夹具。 */
export const ABB_FLANGE_NODE_NAME = 'joint6'
export const ABB_TOOL_NODE_NAME = 'joint7'

export const ABB_JOINT_AXES: Record<(typeof ABB_ACTIVE_JOINT_NODE_NAMES)[number], THREE.Vector3> = {
  joint1: new THREE.Vector3(0, 1, 0),
  joint2: new THREE.Vector3(0, 0, 1),
  joint3: new THREE.Vector3(0, 0, 1),
  joint4: new THREE.Vector3(1, 0, 0),
  joint5: new THREE.Vector3(0, 0, 1),
  joint6: new THREE.Vector3(0, 1, 0),
}

export type AbbSceneStatus = 'loading' | 'ready' | 'error'

/** robtarget 空间标记：ABB 基座坐标（毫米）的命名点位。 */
export interface AbbRobTargetMarker {
  name: string
  position: readonly [number, number, number]
}

export interface AbbSceneOptions {
  onStatus?: (status: AbbSceneStatus) => void
  onTrajectoryCount?: (count: number) => void
  showGrid?: boolean
  showCoordinateSystems?: boolean
  showDhDebug?: boolean
  showTrajectory?: boolean
}

export interface AbbSceneController {
  setJoints: (joints: JointAngles) => void
  setGridVisible: (visible: boolean) => void
  setCoordinateSystemsVisible: (visible: boolean) => void
  setDhDebugVisible: (visible: boolean) => void
  setTrajectoryVisible: (visible: boolean) => void
  /** 重建 robtarget 空间标记（小球 + 名称标签）；位置为 ABB 基座坐标（毫米）。 */
  setRobTargets: (targets: readonly AbbRobTargetMarker[]) => void
  setRobTargetsVisible: (visible: boolean) => void
  clearTrajectory: () => void
  dispose: () => void
}

export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return findNodeShared(root, name)
}

/** 仅用 dizuo 的包围盒计算抬升量，避免把底座误算成 J1。 */
export function calculateAbbModelLift(model: THREE.Group): number {
  const baseNode = findNode(model, ABB_BASE_NODE_NAME)
  const bounds = new THREE.Box3().setFromObject(baseNode ?? model)
  if (bounds.isEmpty()) return 0
  return -bounds.min.y * ABB_MODEL_SCALE
}

/** 将六轴增量应用到 FBX 的 six active bones；底座和末端分支不被改写。 */
export function applyAbbJointAngles(root: THREE.Group, joints: JointAngles): void {
  ABB_ACTIVE_JOINT_NODE_NAMES.forEach((name, index) => {
    const joint = findNode(root, name)
    if (!joint) return
    const baseQuaternionArray = joint.userData.baseQuaternion as
      [number, number, number, number] | undefined
    const baseQuaternion = baseQuaternionArray
      ? new THREE.Quaternion(...baseQuaternionArray)
      : new THREE.Quaternion()
    const deltaQuaternion = new THREE.Quaternion().setFromAxisAngle(
      ABB_JOINT_AXES[name],
      (joints[index] * Math.PI) / 180,
    )
    joint.quaternion.copy(baseQuaternion).multiply(deltaQuaternion)
  })
}

/** 保存导入姿态，并按 dizuo 的中心和最低点把模型放到世界基座原点。 */
export function prepareAbbModel(model: THREE.Group): THREE.Group {
  const clone = model.clone(true)
  clone.updateMatrixWorld(true)

  const baseNode = findNode(clone, ABB_BASE_NODE_NAME)
  const baseBounds = new THREE.Box3().setFromObject(baseNode ?? clone)
  const baseCenter = baseBounds.getCenter(new THREE.Vector3())

  clone.traverse((node) => {
    if (node.name.startsWith('joint')) {
      node.userData.baseQuaternion = node.quaternion.toArray()
    }
    if (node instanceof THREE.Mesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })

  const scaleGroup = new THREE.Group()
  scaleGroup.name = 'ABB_Model_Scale'
  scaleGroup.scale.setScalar(ABB_MODEL_SCALE)
  if (!baseBounds.isEmpty()) {
    scaleGroup.position.set(
      -baseCenter.x * ABB_MODEL_SCALE,
      -baseBounds.min.y * ABB_MODEL_SCALE,
      -baseCenter.z * ABB_MODEL_SCALE,
    )
  }
  scaleGroup.add(clone)

  const root = new THREE.Group()
  root.name = 'ABB_IRB1200_5_90'
  root.userData.baseNodeName = ABB_BASE_NODE_NAME
  root.userData.activeJointNodeNames = [...ABB_ACTIVE_JOINT_NODE_NAMES]
  root.userData.flangeNodeName = ABB_FLANGE_NODE_NAME
  root.userData.toolNodeName = ABB_TOOL_NODE_NAME
  root.userData.fbxBaseHeightMm = baseBounds.isEmpty()
    ? 0
    : (baseBounds.max.y - baseBounds.min.y) * ABB_MODEL_SCALE * 1000
  root.add(scaleGroup)
  return root
}

function createFallbackRobot(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'ABB_Fallback_Robot'

  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x343b48,
    metalness: 0.6,
    roughness: 0.35,
  })
  const yellowMaterial = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.35,
    roughness: 0.5,
  })
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.16, 32), darkMaterial)
  base.position.y = 0.08
  base.castShadow = true
  base.name = ABB_BASE_NODE_NAME
  root.add(base)

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.05, 0.22), yellowMaterial)
  arm.position.y = 0.65
  arm.castShadow = true
  root.add(arm)

  const tool = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.14), darkMaterial)
  tool.position.set(0.22, 1.18, 0)
  tool.castShadow = true
  tool.name = ABB_TOOL_NODE_NAME
  root.add(tool)
  return root
}

const ABB_DISPLAY: SceneDisplayConfig = {
  ariaLabel: 'ABB IRB 1200-5/0.9 三维场景',
  logTag: 'AbbScene',
  gridSize: 4,
  cameraPosition: [2.4, 1.55, 2.8],
  controlsTarget: [0, 0.75, 0],
  controlsMinDistance: 0.5,
  controlsMaxDistance: 8,
  keyLightPosition: [3, 4.5, 3],
  keyLightFar: 15,
  keyLightBounds: 3,
  fillLightPosition: [-3, 2.5, -2],
  bench: {
    name: 'ABB_Benchmark_Workbench',
    topSize: [2.4, 0.08, 2.4],
    frameSize: [2.5, 0.08, 2.5],
  },
}

/** 创建不依赖浏览器渲染器的基准场景树，便于初始化测试和后续场景适配复用。 */
export function createAbbBenchmarkScene(): THREE.Scene {
  return createBaseScene(ABB_DISPLAY)
}

/** robtarget 空间标记：小球 + canvas 文字标签，随 setRobTargets 全量重建。 */
const ROBTARGET_SPHERE_RADIUS = 0.02
const ROBTARGET_LABEL_HEIGHT = 0.07

function createRobTargetLabel(name: string): THREE.Sprite {
  const font = '600 52px ui-monospace, SFMono-Regular, Consolas, monospace'
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return new THREE.Sprite()
  context.font = font
  const textWidth = Math.ceil(context.measureText(name).width)
  canvas.width = textWidth + 48
  canvas.height = 80
  context.font = font
  context.fillStyle = 'rgba(14, 16, 19, 0.82)'
  context.strokeStyle = '#333a44'
  context.beginPath()
  context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 12)
  context.fill()
  context.stroke()
  context.fillStyle = '#e8eaee'
  context.textBaseline = 'middle'
  context.fillText(name, 24, canvas.height / 2 + 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }))
  sprite.scale.set(
    (canvas.width / canvas.height) * ROBTARGET_LABEL_HEIGHT,
    ROBTARGET_LABEL_HEIGHT,
    1,
  )
  return sprite
}

function disposeRobTargetMarkers(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child)
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      ;(child.material as THREE.Material).dispose()
    } else if (child instanceof THREE.Sprite) {
      child.material.map?.dispose()
      child.material.dispose()
    }
  }
}

export function createAbbScene(
  container: HTMLElement,
  options: AbbSceneOptions = {},
): AbbSceneController {
  const onStatus = options.onStatus ?? (() => undefined)
  const onTrajectoryCount = options.onTrajectoryCount ?? (() => undefined)
  const showDhDebug = options.showDhDebug ?? true

  const dhDebugChain = createAbbDhDebugChain()
  dhDebugChain.group.visible = showDhDebug

  // robtarget 空间标记：与 FBX 视觉一致，ABB 基座 Z 向上叠加坡座（dizuo）支架高度。
  const robTargetGroup = new THREE.Group()
  robTargetGroup.name = 'ABB_RobTarget_Markers'
  let robTargetBaseHeightMm = 0
  let robTargetList: readonly AbbRobTargetMarker[] = []

  function rebuildRobTargets(): void {
    disposeRobTargetMarkers(robTargetGroup)
    robTargetList.forEach((target, index) => {
      const [x, y, z] = target.position
      // ABB 基座坐标（毫米，Z 上）→ 场景坐标（米，Y 上），与 FK 显示闭环同一转换。
      const scenePosition = new THREE.Vector3(
        x * 0.001,
        (z + robTargetBaseHeightMm) * 0.001,
        -y * 0.001,
      )
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(ROBTARGET_SPHERE_RADIUS, 20, 14),
        new THREE.MeshStandardMaterial({
          color: 0xff6a1a,
          emissive: 0xff6a1a,
          emissiveIntensity: 0.55,
          metalness: 0.2,
          roughness: 0.5,
        }),
      )
      sphere.position.copy(scenePosition)
      const label = createRobTargetLabel(target.name)
      label.position.copy(scenePosition)
      // 标签按序号上下交错，避免邻近点位的标签相互遮挡。
      const labelGap = ROBTARGET_SPHERE_RADIUS + ROBTARGET_LABEL_HEIGHT * 0.7
      label.position.y += index % 2 === 0 ? labelGap : -labelGap
      robTargetGroup.add(sphere, label)
    })
  }

  const { controller, runtime } = createSceneController(container, {
    display: ABB_DISPLAY,
    defaultJoints: [...ABB_DEFAULT_JOINTS],
    loadModel: (onSuccess, onError) => {
      const loader = new FBXLoader()
      loader.load(ABB_MODEL_URL, onSuccess, undefined, onError)
    },
    prepareModel: prepareAbbModel,
    applyJoints: applyAbbJointAngles,
    findToolNode: (root) => findNode(root, ABB_TOOL_NODE_NAME),
    createFallbackRobot,
    onStatus,
    onTrajectoryCount,
    showGrid: options.showGrid,
    showCoordinateSystems: options.showCoordinateSystems,
    showTrajectory: options.showTrajectory,
    skipFirstTrajectorySample: true,
    onModelReady: (model) => {
      const fbxBaseHeightMm = model.userData.fbxBaseHeightMm
      if (typeof fbxBaseHeightMm === 'number') {
        dhDebugChain.setBaseHeightMm(fbxBaseHeightMm)
        robTargetBaseHeightMm = fbxBaseHeightMm
        rebuildRobTargets()
      }
      console.info(
        '[AbbScene] ABB FBX 加载完成：底座=dizuo，主动轴=joint1..joint6，机械法兰=joint6，工具=joint7',
      )
    },
    onJointUpdated: (joints) => dhDebugChain.update(joints),
    onDispose: () => disposeRobTargetMarkers(robTargetGroup),
  })

  dhDebugChain.group.visible = showDhDebug
  runtime.scene.add(dhDebugChain.group)
  runtime.scene.add(robTargetGroup)

  return {
    ...controller,
    setDhDebugVisible: (visible: boolean) => {
      dhDebugChain.group.visible = visible
    },
    setRobTargets: (targets: readonly AbbRobTargetMarker[]) => {
      robTargetList = targets
      rebuildRobTargets()
    },
    setRobTargetsVisible: (visible: boolean) => {
      robTargetGroup.visible = visible
    },
  }
}
