import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { JointAngles } from '@/robot-geometry/model/index.ts'
import { createBaseAxes, createToolAxes } from './scene-helpers.ts'
import {
  appendTrajectoryPoint,
  DEFAULT_TRAJECTORY_DISTANCE,
  DEFAULT_TRAJECTORY_LIMIT,
  type ScenePoint,
} from './trajectory.ts'
import { sceneEnvironment } from '@/theme/scene.ts'

export type SceneStatus = 'loading' | 'ready' | 'error'

export interface SceneBenchSpec {
  name: string
  topSize: [number, number, number]
  frameSize: [number, number, number]
}

/** 场景外观参数：每个厂家（ABB/KUKA）唯一，其它生命周期逻辑全部放共享骨架。 */
export interface SceneDisplayConfig {
  ariaLabel: string
  /** 用于场景资源日志的前缀，如 'AbbScene' / 'KukaScene'。 */
  logTag: string
  gridSize: number
  cameraPosition: [number, number, number]
  controlsTarget: [number, number, number]
  controlsMinDistance: number
  controlsMaxDistance: number
  keyLightPosition: [number, number, number]
  keyLightFar: number
  keyLightBounds: number
  fillLightPosition: [number, number, number]
  bench: SceneBenchSpec
}

/**
 * 共享运行时句柄：厂商适配器/附加方法只读当前场景、已加载模型、
 * 坐标可见性状态与当前目标关节。
 */
export interface SceneRuntime {
  readonly scene: THREE.Scene
  readonly model: THREE.Group | null
  readonly camera: THREE.PerspectiveCamera
  readonly domElement: HTMLCanvasElement
  /** 相机轨道控制器；厂商附加交互（如操作轴拖拽）需在拖拽时临时禁用其 enabled 以避免冲突。 */
  readonly controls: OrbitControls
  readonly coordinateSystemsVisible: boolean
  readonly currentJoints: JointAngles
}

export interface SceneFactoryConfig {
  display: SceneDisplayConfig
  defaultJoints: JointAngles
  /** 厂商负责真正的模型加载（FBX/GLTF）；成功回调原始根 Group，失败回调走回退几何。 */
  loadModel: (onSuccess: (root: THREE.Group) => void, onError: () => void) => void
  /** 把加载到的根模型规整为场景可用的 Group（缩放、居中、Pivot 等）。 */
  prepareModel: (root: THREE.Group) => THREE.Group
  /** 把当前目标关节角应用到已准备好的模型节点。 */
  applyJoints: (root: THREE.Group, joints: JointAngles) => void
  /** 查找末端/TCP 节点，供工具轴跟随与轨迹采样。 */
  findToolNode: (root: THREE.Group) => THREE.Object3D | null
  /** 模型加载失败时构建的回退几何。 */
  createFallbackRobot: () => THREE.Group
  onStatus?: (status: SceneStatus) => void
  onTrajectoryCount?: (count: number) => void
  showGrid?: boolean
  showCoordinateSystems?: boolean
  showTrajectory?: boolean
  /** ABB 忽略首个采样点（仅作参照），KUKA 直接记录；用于保持两者既有轨迹语义。 */
  skipFirstTrajectorySample?: boolean
  /** 模型准备后、状态置 ready 前调用（如 KUKA 建立 RobotModel、ABB 设置 DH 底座高度）。 */
  onModelReady?: (model: THREE.Group, runtime: SceneRuntime) => void
  /** 回退几何挂载后调用（如 KUKA 对回退 Pivot 施加关节并通知 onModel(null)）。 */
  onModelFallback?: (fallback: THREE.Group, runtime: SceneRuntime) => void
  /** 目标关节变化后调用（如 ABB 同步 DH 参考链、KUKA 同步 RobotModel）。 */
  onJointUpdated?: (joints: JointAngles, runtime: SceneRuntime) => void
  onDispose?: (runtime: SceneRuntime) => void
}

export interface SceneBaseController {
  setJoints: (joints: JointAngles) => void
  setGridVisible: (visible: boolean) => void
  setCoordinateSystemsVisible: (visible: boolean) => void
  setTrajectoryVisible: (visible: boolean) => void
  clearTrajectory: () => void
  dispose: () => void
}

export interface SceneControllerBundle {
  controller: SceneBaseController
  runtime: SceneRuntime
}

/** 在场景树中按名称查找节点；兼容两厂家的模型适配与关节寻址。 */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null
  root.traverse((child) => {
    if (child.name === name) result = child
  })
  return result
}

/** 创建不依赖渲染器的工作台 + 地面网格 + 世界坐标轴 + 灯光基准场景树。 */
export function createBaseScene(display: SceneDisplayConfig): THREE.Scene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(sceneEnvironment.background)

  const workbench = new THREE.Group()
  workbench.name = display.bench.name
  const topMaterial = new THREE.MeshStandardMaterial({
    color: sceneEnvironment.workbenchTop,
    metalness: 0.25,
    roughness: 0.75,
  })
  const top = new THREE.Mesh(new THREE.BoxGeometry(...display.bench.topSize), topMaterial)
  top.position.y = -0.04
  top.receiveShadow = true
  workbench.add(top)
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: sceneEnvironment.workbenchFrame,
    metalness: 0.45,
    roughness: 0.55,
  })
  const frame = new THREE.Mesh(new THREE.BoxGeometry(...display.bench.frameSize), frameMaterial)
  frame.position.y = -0.1
  frame.receiveShadow = true
  workbench.add(frame)
  scene.add(workbench)

  const grid = new THREE.GridHelper(
    display.gridSize,
    32,
    sceneEnvironment.gridColor,
    sceneEnvironment.gridColorLine,
  )
  grid.position.y = 0.002
  grid.name = 'Ground_Grid'
  scene.add(grid)

  const axes = createBaseAxes()
  axes.position.y = 0.01
  scene.add(axes)

  scene.add(
    new THREE.HemisphereLight(
      sceneEnvironment.hemisphereSky,
      sceneEnvironment.hemisphereGround,
      1.8,
    ),
  )
  const keyLight = new THREE.DirectionalLight(sceneEnvironment.keyLight, 3.2)
  keyLight.position.set(...display.keyLightPosition)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.camera.near = 0.1
  keyLight.shadow.camera.far = display.keyLightFar
  keyLight.shadow.camera.left = -display.keyLightBounds
  keyLight.shadow.camera.right = display.keyLightBounds
  keyLight.shadow.camera.top = display.keyLightBounds
  keyLight.shadow.camera.bottom = -display.keyLightBounds
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(sceneEnvironment.fillLight, 1.4)
  fillLight.position.set(...display.fillLightPosition)
  scene.add(fillLight)

  return scene
}

function configureRenderer(container: HTMLElement, ariaLabel: string): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-label', ariaLabel)
  container.appendChild(renderer.domElement)
  return renderer
}

function configureCamera(
  container: HTMLElement,
  display: SceneDisplayConfig,
): THREE.PerspectiveCamera {
  const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1)
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.01, 100)
  camera.position.set(...display.cameraPosition)
  return camera
}

function configureControls(
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  display: SceneDisplayConfig,
): OrbitControls {
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = true
  controls.enableZoom = true
  controls.enableRotate = true
  controls.minDistance = display.controlsMinDistance
  controls.maxDistance = display.controlsMaxDistance
  controls.target.set(...display.controlsTarget)
  controls.update()
  return controls
}

/**
 * 拥有通用 Three.js 场景生命周期的深度模块：渲染器/相机/控制器、轨迹缓冲、
 * 模型加载与回退、工具轴跟随、轨迹采样、渲染循环与资源释放。
 * 各厂家通过 config 提供最小差异适配，最终控制器对象由厂家按需组合共享方法。
 */
export function createSceneController(
  container: HTMLElement,
  config: SceneFactoryConfig,
): SceneControllerBundle {
  const onStatus = config.onStatus ?? (() => undefined)
  const onTrajectoryCount = config.onTrajectoryCount ?? (() => undefined)
  const display = config.display
  const scene = createBaseScene(display)
  const grid = scene.getObjectByName('Ground_Grid')
  const baseAxes = scene.getObjectByName('BaseAxesHelper')
  const initialCoordinateVisibility = config.showCoordinateSystems ?? true
  if (grid) grid.visible = config.showGrid ?? true
  if (baseAxes) baseAxes.visible = initialCoordinateVisibility
  let showTrajectory = config.showTrajectory ?? false

  const shared = {
    model: null as THREE.Group | null,
    coordinateSystemsVisible: initialCoordinateVisibility,
    currentJoints: [...config.defaultJoints] as JointAngles,
  }
  const camera = configureCamera(container, display)
  const renderer = configureRenderer(container, display.ariaLabel)
  const controls = configureControls(camera, renderer, display)
  const runtime: SceneRuntime = {
    scene,
    get model() {
      return shared.model
    },
    camera,
    domElement: renderer.domElement,
    controls,
    get coordinateSystemsVisible() {
      return shared.coordinateSystemsVisible
    },
    get currentJoints() {
      return shared.currentJoints
    },
  }

  const trajectoryGeometry = new THREE.BufferGeometry()
  /** 轨迹缓冲按需翻倍增长：点数不限，长程序不再截断旧轨迹。 */
  let trajectoryPositions = new Float32Array(DEFAULT_TRAJECTORY_LIMIT * 3)
  let trajectoryAttribute = new THREE.BufferAttribute(trajectoryPositions, 3)
  trajectoryGeometry.setAttribute('position', trajectoryAttribute)
  trajectoryGeometry.setDrawRange(0, 0)
  const trajectoryMaterial = new THREE.LineBasicMaterial({
    color: sceneEnvironment.trajectory,
    opacity: 0.8,
    transparent: true,
    depthTest: false,
  })
  const trajectoryLine = new THREE.Line(trajectoryGeometry, trajectoryMaterial)
  trajectoryLine.name = 'EndEffector_Trajectory'
  trajectoryLine.visible = showTrajectory
  scene.add(trajectoryLine)

  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    // setSize 会重置 WebGL 缓冲，而 rAF 渲染要等下一帧才会跑——必须在本帧内
    // 立即重绘一次，否则面板宽度过渡动画期间画布会被画上空白帧（闪烁）。
    renderer.render(scene, camera)
  })
  let animationFrame = 0
  let toolAxes: THREE.Group | null = null
  let trajectoryPoints: ScenePoint[] = []
  let lastTrajectoryPoint: ScenePoint | null = null
  let lastTrajectoryTime = 0
  let disposed = false

  const refreshTrajectoryLine = (): void => {
    if (trajectoryPoints.length * 3 > trajectoryPositions.length) {
      const nextCapacity = Math.max(trajectoryPoints.length, (trajectoryPositions.length / 3) * 2)
      trajectoryPositions = new Float32Array(nextCapacity * 3)
      trajectoryAttribute = new THREE.BufferAttribute(trajectoryPositions, 3)
      trajectoryGeometry.setAttribute('position', trajectoryAttribute)
    }
    trajectoryPoints.forEach((point, index) => {
      trajectoryPositions[index * 3] = point[0]
      trajectoryPositions[index * 3 + 1] = point[1]
      trajectoryPositions[index * 3 + 2] = point[2]
    })
    trajectoryAttribute.needsUpdate = true
    trajectoryGeometry.setDrawRange(0, trajectoryPoints.length)
    trajectoryGeometry.computeBoundingSphere()
  }

  const attachToolAxes = (): void => {
    toolAxes?.parent?.remove(toolAxes)
    toolAxes = createToolAxes()
    toolAxes.visible = shared.coordinateSystemsVisible
    scene.add(toolAxes)
  }

  const updateToolAxes = (): void => {
    if (!shared.model || !toolAxes) return
    const tool = config.findToolNode(shared.model)
    if (!tool) return
    shared.model.updateMatrixWorld(true)
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    tool.getWorldPosition(position)
    tool.getWorldQuaternion(quaternion)
    toolAxes.position.copy(position)
    toolAxes.quaternion.copy(quaternion)
  }

  const sampleTrajectory = (now: number): void => {
    if (!shared.model || now - lastTrajectoryTime < 50) return
    lastTrajectoryTime = now
    const tool = config.findToolNode(shared.model)
    if (!tool) return
    shared.model.updateMatrixWorld(true)
    const position = new THREE.Vector3()
    tool.getWorldPosition(position)
    const point: ScenePoint = [position.x, position.y, position.z]

    if (config.skipFirstTrajectorySample) {
      if (!lastTrajectoryPoint) {
        lastTrajectoryPoint = point
        return
      }
      const previous = lastTrajectoryPoint
      if (
        Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]) <
        DEFAULT_TRAJECTORY_DISTANCE
      )
        return
      lastTrajectoryPoint = point
    }

    const next = appendTrajectoryPoint(trajectoryPoints, point)
    if (next.length === trajectoryPoints.length) return
    trajectoryPoints = next
    refreshTrajectoryLine()
    onTrajectoryCount(trajectoryPoints.length)
  }

  resizeObserver.observe(container)
  onStatus('loading')

  config.loadModel(
    (root) => {
      if (disposed) return
      shared.model = config.prepareModel(root)
      config.applyJoints(shared.model, shared.currentJoints)
      scene.add(shared.model)
      attachToolAxes()
      config.onModelReady?.(shared.model, runtime)
      onStatus('ready')
    },
    () => {
      if (disposed) return
      const fallback = config.createFallbackRobot()
      scene.add(fallback)
      shared.model = fallback
      attachToolAxes()
      config.onModelFallback?.(fallback, runtime)
      onStatus('error')
    },
  )

  // 初始目标关节同步（如 ABB 的 DH 参考链在加载前先更新一次）。
  config.onJointUpdated?.(shared.currentJoints, runtime)

  const render = (): void => {
    if (disposed) return
    updateToolAxes()
    sampleTrajectory(performance.now())
    controls.update()
    renderer.render(scene, camera)
    animationFrame = window.requestAnimationFrame(render)
  }
  render()

  const controller: SceneBaseController = {
    setJoints: (joints: JointAngles) => {
      shared.currentJoints = [...joints]
      config.onJointUpdated?.(joints, runtime)
      if (shared.model) config.applyJoints(shared.model, shared.currentJoints)
    },
    setGridVisible: (visible: boolean) => {
      if (grid) grid.visible = visible
    },
    setCoordinateSystemsVisible: (visible: boolean) => {
      shared.coordinateSystemsVisible = visible
      if (baseAxes) baseAxes.visible = visible
      if (toolAxes) toolAxes.visible = visible
    },
    setTrajectoryVisible: (visible: boolean) => {
      showTrajectory = visible
      trajectoryLine.visible = visible
    },
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
      config.onDispose?.(runtime)
      console.info(`[${display.logTag}] 场景资源已释放`)
    },
  }

  return { controller, runtime }
}
