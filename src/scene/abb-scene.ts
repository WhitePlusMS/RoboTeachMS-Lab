import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import { DEFAULT_ROBOT } from '@/robot-models/registry.ts'
import { DEFAULT_ROBOT_VISUAL } from './robot-visual.ts'
import { createAbbDhDebugChain } from './abb-dh-debug-chain.ts'
import { abbScene } from '@/theme/scene.ts'
import {
  createBaseScene,
  createSceneController,
  findNode as findNodeShared,
  type SceneDisplayConfig,
} from './scene-factory.ts'
import { AbbTransformGizmo, type TransformGizmoMode } from './abb-transform-gizmo.ts'

const visual = DEFAULT_ROBOT_VISUAL
export const ABB_MODEL_URL = import.meta.env.BASE_URL + visual.assetPath
export const ABB_MODEL_SCALE = visual.scale
export const ABB_BASE_NODE_NAME = visual.baseNode
export const ABB_ACTIVE_JOINT_NODE_NAMES = visual.jointNodes
export const ABB_FLANGE_NODE_NAME = visual.flangeNode
export const ABB_TOOL_NODE_NAME = visual.toolNode
export const ABB_JOINT_AXES = Object.fromEntries(
  visual.jointNodes.map((name, index) => [name, new THREE.Vector3(...visual.axes[index])]),
) as Record<string, THREE.Vector3>
export const ABB_JOINT_ZERO_OFFSETS_DEG = Object.fromEntries(
  visual.jointNodes.map((name, index) => [name, visual.offsetsDeg[index]]),
) as Record<string, number>

export type AbbSceneStatus = 'loading' | 'ready' | 'error'

/** robtarget 空间标记：ABB 基座坐标（毫米）的命名点位。 */
export interface AbbRobTargetMarker {
  name: string
  position: readonly [number, number, number]
  /** 当前是否在 Program Data 中被选中；必填，避免调用方遗漏高亮态。 */
  selected: boolean
}

export interface AbbSceneOptions {
  onStatus?: (status: AbbSceneStatus) => void
  onTrajectoryCount?: (count: number) => void
  showGrid?: boolean
  showCoordinateSystems?: boolean
  showDhDebug?: boolean
  showTrajectory?: boolean
  /** 末端拖拽操作轴：对目标 ABB Pose 求解 IK，成功应用关节并返回 true，不可达返回 false。 */
  onGizmoSolve?: (pose: Pose) => boolean
  /** 操作轴空闲/回弹时跟随的 DH 机械法兰 Pose；优先于 FBX 视觉骨骼原点。 */
  getGizmoPose?: () => Pose | null
  onGizmoDragStart?: () => void
  onGizmoDragEnd?: () => void
  /** 拖拽是否允许（默认 true；程序运行期间可设为 false 以禁用手柄）。 */
  gizmoInteractive?: () => boolean
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
  /** 只隐藏名称标签、保留点位小球。 */
  setRobTargetLabelsVisible: (visible: boolean) => void
  /** 显示/隐藏末端法兰拖拽操作轴。 */
  enableTransformGizmo: (enabled: boolean) => void
  /** 切换操作轴模式：'translate'（XYZ 平移）或 'rotate'（RX/RY/RZ 旋转）。 */
  setTransformGizmoMode: (mode: TransformGizmoMode) => void
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
      ((joints[index] + ABB_JOINT_ZERO_OFFSETS_DEG[name]) * Math.PI) / 180,
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
  root.name = DEFAULT_ROBOT.id
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
    color: abbScene.fallbackDark,
    metalness: 0.6,
    roughness: 0.35,
  })
  const yellowMaterial = new THREE.MeshStandardMaterial({
    color: abbScene.fallbackYellow,
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
const ROBTARGET_NORMAL_RADIUS = 0.02
const ROBTARGET_SELECTED_RADIUS = 0.03
const ROBTARGET_LABEL_HEIGHT = 0.07
const ROBTARGET_NORMAL_EMISSIVE = 0.55
const ROBTARGET_SELECTED_EMISSIVE = 1.4

/** 纯样式函数：根据选中态返回固定半径与发光强度，便于单元测试验证。 */
export function robtargetMarkerStyle(selected: boolean): {
  radius: number
  emissiveIntensity: number
} {
  return selected
    ? { radius: ROBTARGET_SELECTED_RADIUS, emissiveIntensity: ROBTARGET_SELECTED_EMISSIVE }
    : { radius: ROBTARGET_NORMAL_RADIUS, emissiveIntensity: ROBTARGET_NORMAL_EMISSIVE }
}

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
  context.fillStyle = abbScene.labelBackground
  context.strokeStyle = abbScene.labelBorder
  context.beginPath()
  context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 12)
  context.fill()
  context.stroke()
  context.fillStyle = abbScene.labelText
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
  let robTargetLabelsVisible = true

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
      const style = robtargetMarkerStyle(target.selected)
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(style.radius, 20, 14),
        new THREE.MeshStandardMaterial({
          color: abbScene.robTarget,
          emissive: abbScene.robTarget,
          emissiveIntensity: style.emissiveIntensity,
          metalness: 0.2,
          roughness: 0.5,
        }),
      )
      sphere.position.copy(scenePosition)
      const label = createRobTargetLabel(target.name)
      label.visible = robTargetLabelsVisible
      label.position.copy(scenePosition)
      // 标签位置使用实际半径计算 gap，避免选中球体放大后与标签重叠。
      const labelGap = style.radius + ROBTARGET_LABEL_HEIGHT * 0.7
      label.position.y += index % 2 === 0 ? labelGap : -labelGap
      robTargetGroup.add(sphere, label)
    })
  }

  const onGizmoSolve = options.onGizmoSolve
  const gizmoInteractive = options.gizmoInteractive

  const { controller, runtime } = createSceneController(container, {
    display: ABB_DISPLAY,
    defaultJoints: [...DEFAULT_ROBOT.homeJoints],
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
        transformGizmo?.setBaseHeightMm(fbxBaseHeightMm)
        rebuildRobTargets()
      }
      console.info(
        '[AbbScene] ABB FBX 加载完成：底座=dizuo，主动轴=joint1..joint6，机械法兰=joint6，工具=joint7',
      )
    },
    onJointUpdated: (joints) => dhDebugChain.update(joints),
    onDispose: () => {
      transformGizmo?.dispose()
      transformGizmo = null
      disposeRobTargetMarkers(robTargetGroup)
    },
  })

  dhDebugChain.group.visible = showDhDebug
  runtime.scene.add(dhDebugChain.group)
  runtime.scene.add(robTargetGroup)

  // 末端拖拽操作轴：只在提供 IK 求解回调时启用（否则保持为空，控制器方法变为安全 no-op）。
  let transformGizmo: AbbTransformGizmo | null = onGizmoSolve
    ? new AbbTransformGizmo({
        scene: runtime.scene,
        camera: runtime.camera,
        domElement: runtime.domElement,
        orbitControls: runtime.controls,
        flangeNodeName: ABB_FLANGE_NODE_NAME,
        getAuthoritativePose: options.getGizmoPose,
        getModel: () => runtime.model,
        solveTargetPose: onGizmoSolve,
        onDragStart: options.onGizmoDragStart,
        onDragEnd: options.onGizmoDragEnd,
        isInteractive: gizmoInteractive,
      })
    : null

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
    setRobTargetLabelsVisible: (visible: boolean) => {
      robTargetLabelsVisible = visible
      for (const child of robTargetGroup.children) {
        if (child instanceof THREE.Sprite) child.visible = visible
      }
    },
    enableTransformGizmo: (enabled: boolean) => {
      transformGizmo?.setEnabled(enabled)
    },
    setTransformGizmoMode: (mode: TransformGizmoMode) => {
      transformGizmo?.setMode(mode)
    },
  }
}
