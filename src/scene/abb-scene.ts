import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import type { JointAngles } from '../robotics/types.ts'
import { ABB_DEFAULT_JOINTS } from '../robot-models/abb-irb1200/robot-config.ts'
import { createAbbDhDebugChain } from './abb-dh-debug-chain.ts'
import { createBaseAxes, createFrameAxes, createToolAxes } from './scene-helpers.ts'
import {
  appendTrajectoryPoint,
  DEFAULT_TRAJECTORY_DISTANCE,
  DEFAULT_TRAJECTORY_LIMIT,
  type ScenePoint,
} from './trajectory.ts'

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
  clearTrajectory: () => void
  /** 在场景（米）位置显示/隐藏“当前活动工具”坐标系框；null 隐藏。 */
  setActiveToolFrame: (position: [number, number, number] | null) => void
  /** 在场景（米）位置显示/隐藏“当前工件坐标”坐标系框；null 隐藏。 */
  setActiveWobjFrame: (position: [number, number, number] | null) => void
  dispose: () => void
}

export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null
  root.traverse((child) => {
    if (child.name === name) result = child
  })
  return result
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
      | [number, number, number, number]
      | undefined
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

function createWorkbench(): THREE.Group {
  const workbench = new THREE.Group()
  workbench.name = 'ABB_Benchmark_Workbench'

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.08, 2.4),
    new THREE.MeshStandardMaterial({ color: 0xd5d9df, metalness: 0.25, roughness: 0.75 }),
  )
  top.position.y = -0.04
  top.receiveShadow = true
  workbench.add(top)

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.08, 2.5),
    new THREE.MeshStandardMaterial({ color: 0x667085, metalness: 0.45, roughness: 0.55 }),
  )
  frame.position.y = -0.1
  frame.receiveShadow = true
  workbench.add(frame)
  return workbench
}

function createFallbackRobot(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'ABB_Fallback_Robot'

  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x343b48, metalness: 0.6, roughness: 0.35 })
  const yellowMaterial = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.35, roughness: 0.5 })
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

function configureRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-label', 'ABB IRB 1200-5/0.9 三维场景')
  container.appendChild(renderer.domElement)
  return renderer
}

function configureLighting(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xf6f8fb, 0x4b5563, 1.8))

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2)
  keyLight.position.set(3, 4.5, 3)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.camera.near = 0.1
  keyLight.shadow.camera.far = 15
  keyLight.shadow.camera.left = -3
  keyLight.shadow.camera.right = 3
  keyLight.shadow.camera.top = 3
  keyLight.shadow.camera.bottom = -3
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0x9ab9e8, 1.4)
  fillLight.position.set(-3, 2.5, -2)
  scene.add(fillLight)
}

function configureBaseScene(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x101827)
  scene.add(createWorkbench())

  const grid = new THREE.GridHelper(4, 32, 0x64748b, 0x334155)
  grid.position.y = 0.002
  grid.name = 'Ground_Grid'
  scene.add(grid)

  const axes = createBaseAxes()
  axes.position.y = 0.01
  scene.add(axes)
}

export function createAbbBenchmarkScene(): THREE.Scene {
  const scene = new THREE.Scene()
  configureBaseScene(scene)
  configureLighting(scene)
  return scene
}

function configureCamera(container: HTMLElement): THREE.PerspectiveCamera {
  const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1)
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.01, 100)
  camera.position.set(2.4, 1.55, 2.8)
  return camera
}

function configureControls(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): OrbitControls {
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = true
  controls.enableZoom = true
  controls.enableRotate = true
  controls.minDistance = 0.5
  controls.maxDistance = 8
  controls.target.set(0, 0.75, 0)
  controls.update()
  return controls
}

export function createAbbScene(
  container: HTMLElement,
  options: AbbSceneOptions = {},
): AbbSceneController {
  const onStatus = options.onStatus ?? (() => undefined)
  const onTrajectoryCount = options.onTrajectoryCount ?? (() => undefined)
  const scene = createAbbBenchmarkScene()
  const grid = scene.getObjectByName('Ground_Grid')
  const baseAxes = scene.getObjectByName('BaseAxesHelper')
  const showGrid = options.showGrid ?? true
  let showCoordinateSystems = options.showCoordinateSystems ?? true
  let showDhDebug = options.showDhDebug ?? true
  let showTrajectory = options.showTrajectory ?? false
  if (grid) grid.visible = showGrid
  if (baseAxes) baseAxes.visible = showCoordinateSystems

  const trajectoryGeometry = new THREE.BufferGeometry()
  const trajectoryPositions = new Float32Array(DEFAULT_TRAJECTORY_LIMIT * 3)
  const trajectoryAttribute = new THREE.BufferAttribute(trajectoryPositions, 3)
  trajectoryGeometry.setAttribute('position', trajectoryAttribute)
  trajectoryGeometry.setDrawRange(0, 0)
  const trajectoryMaterial = new THREE.LineBasicMaterial({
    color: 0xf97316,
    opacity: 0.8,
    transparent: true,
    depthTest: false,
  })
  const trajectoryLine = new THREE.Line(trajectoryGeometry, trajectoryMaterial)
  trajectoryLine.name = 'EndEffector_Trajectory'
  trajectoryLine.visible = showTrajectory
  scene.add(trajectoryLine)

  const camera = configureCamera(container)
  const renderer = configureRenderer(container)
  const controls = configureControls(camera, renderer)
  const loader = new FBXLoader()
  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  })
  let animationFrame = 0
  let loadedModel: THREE.Group | null = null
  let targetJoints: JointAngles = [...ABB_DEFAULT_JOINTS]
  const dhDebugChain = createAbbDhDebugChain()
  dhDebugChain.group.visible = showDhDebug
  dhDebugChain.update(targetJoints)
  scene.add(dhDebugChain.group)
  let toolAxes: THREE.Group | null = null
  let activeToolFrame: THREE.Group | null = null
  let activeWobjFrame: THREE.Group | null = null
  let trajectoryPoints: ScenePoint[] = []
  let lastTrajectoryPoint: ScenePoint | null = null
  let lastTrajectoryTime = 0
  let disposed = false

  /** 把领域层给出的（场景米）活动 Tool/WObj 坐标系框移动到该位置并显示；null 隐藏。 */
  function setActiveFrameAt(group: THREE.Group | null, position: [number, number, number] | null): void {
    if (!group) return
    if (!position) {
      group.visible = false
      return
    }
    group.position.set(position[0], position[1], position[2])
    group.quaternion.set(0, 0, 0, 1) // 领域层只给出原点位置；轴方向沿用世界朝向（示意）。
    group.visible = showCoordinateSystems
  }

  function refreshTrajectoryLine(): void {
    trajectoryPoints.forEach((point, index) => {
      trajectoryPositions[index * 3] = point[0]
      trajectoryPositions[index * 3 + 1] = point[1]
      trajectoryPositions[index * 3 + 2] = point[2]
    })
    trajectoryAttribute.needsUpdate = true
    trajectoryGeometry.setDrawRange(0, trajectoryPoints.length)
    trajectoryGeometry.computeBoundingSphere()
  }

  function attachToolAxes(): void {
    toolAxes?.parent?.remove(toolAxes)
    toolAxes = createToolAxes()
    toolAxes.visible = showCoordinateSystems
    scene.add(toolAxes)

    if (!activeToolFrame) {
      activeToolFrame = createFrameAxes('ActiveToolFrameHelper')
      activeToolFrame.visible = false
      scene.add(activeToolFrame)
    }
    if (!activeWobjFrame) {
      activeWobjFrame = createFrameAxes('ActiveWobjFrameHelper')
      activeWobjFrame.visible = false
      scene.add(activeWobjFrame)
    }
  }

  function updateToolAxes(): void {
    if (!loadedModel || !toolAxes) return
    const tool = findNode(loadedModel, ABB_TOOL_NODE_NAME)
    if (!tool) return
    loadedModel.updateMatrixWorld(true)
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    tool.getWorldPosition(position)
    tool.getWorldQuaternion(quaternion)
    toolAxes.position.copy(position)
    toolAxes.quaternion.copy(quaternion)
  }

  function sampleTrajectory(now: number): void {
    if (!loadedModel || now - lastTrajectoryTime < 50) return
    lastTrajectoryTime = now
    const tool = findNode(loadedModel, ABB_TOOL_NODE_NAME)
    if (!tool) return

    loadedModel.updateMatrixWorld(true)
    const position = new THREE.Vector3()
    tool.getWorldPosition(position)
    const point: ScenePoint = [position.x, position.y, position.z]
    const previousPoint = lastTrajectoryPoint
    lastTrajectoryPoint = point
    // 轨迹采样是教学事实源，和可见性开关解耦；用户运行后再打开显示也能看到已采样路径。
    if (!previousPoint) return
    if (Math.hypot(
      point[0] - previousPoint[0],
      point[1] - previousPoint[1],
      point[2] - previousPoint[2],
    ) < DEFAULT_TRAJECTORY_DISTANCE) return

    const next = appendTrajectoryPoint(trajectoryPoints, point)
    trajectoryPoints = next
    refreshTrajectoryLine()
    onTrajectoryCount(trajectoryPoints.length)
  }

  resizeObserver.observe(container)
  onStatus('loading')

  loader.load(
    ABB_MODEL_URL,
    (model) => {
      if (disposed) return
      loadedModel = prepareAbbModel(model)
      const fbxBaseHeightMm = loadedModel.userData.fbxBaseHeightMm
      if (typeof fbxBaseHeightMm === 'number') dhDebugChain.setBaseHeightMm(fbxBaseHeightMm)
      applyAbbJointAngles(loadedModel, targetJoints)
      scene.add(loadedModel)
      attachToolAxes()
      onStatus('ready')
      console.info('[AbbScene] ABB FBX 加载完成：底座=dizuo，主动轴=joint1..joint6，机械法兰=joint6，工具=joint7')
    },
    undefined,
    (error) => {
      if (disposed) return
      const fallback = createFallbackRobot()
      scene.add(fallback)
      loadedModel = fallback
      attachToolAxes()
      onStatus('error')
      console.error('[AbbScene] ABB FBX 加载失败，已显示回退几何', error)
    },
  )

  const render = (): void => {
    if (disposed) return
    updateToolAxes()
    sampleTrajectory(performance.now())
    controls.update()
    renderer.render(scene, camera)
    animationFrame = window.requestAnimationFrame(render)
  }
  render()

  return {
    setJoints: (joints: JointAngles) => {
      targetJoints = [...joints]
      dhDebugChain.update(targetJoints)
      if (loadedModel) applyAbbJointAngles(loadedModel, targetJoints)
    },
    setGridVisible: (visible: boolean) => {
      if (grid) grid.visible = visible
    },
    setCoordinateSystemsVisible: (visible: boolean) => {
      showCoordinateSystems = visible
      if (baseAxes) baseAxes.visible = visible
      if (toolAxes) toolAxes.visible = visible
    },
    setDhDebugVisible: (visible: boolean) => {
      showDhDebug = visible
      dhDebugChain.group.visible = visible
    },
    setTrajectoryVisible: (visible: boolean) => {
      showTrajectory = visible
      trajectoryLine.visible = visible
    },
    setActiveToolFrame: (position) => setActiveFrameAt(activeToolFrame, position),
    setActiveWobjFrame: (position) => setActiveFrameAt(activeWobjFrame, position),
    clearTrajectory: () => {
      trajectoryPoints = []
      lastTrajectoryPoint = null
      refreshTrajectoryLine()
      onTrajectoryCount(0)
    },
    dispose: () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()

      scene.traverse((node) => {
        if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Line)) return
        node.geometry.dispose()
        const material = node.material
        if (Array.isArray(material)) material.forEach((item) => item.dispose())
        else material.dispose()
      })

      renderer.domElement.remove()
      console.info('[AbbScene] ABB 场景资源已释放')
    },
  }
}
