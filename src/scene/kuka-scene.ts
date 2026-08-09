import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { JointAngles } from '../core/robot/types'
import { DEFAULT_JOINTS } from '../robots/kuka-like/robot-config'

/** KUKA 资产属于独立应用自己的 public 目录。 */
export const KUKA_MODEL_URL = '/models/KUKA_V1.glb'
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
}

export interface KukaSceneController {
  setJoints: (joints: JointAngles) => void
  dispose: () => void
}

/** 在场景树中按名称查找节点，供模型适配和后续关节控制复用。 */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let result: THREE.Object3D | null = null
  root.traverse((child) => {
    if (child.name === name) result = child
  })
  return result
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
      | [number, number, number, number]
      | undefined
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

function createWorkbench(): THREE.Group {
  const workbench = new THREE.Group()
  workbench.name = 'KUKA_Benchmark_Workbench'

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(4.525, 0.08, 3.394),
    new THREE.MeshStandardMaterial({ color: 0xd5d9df, metalness: 0.25, roughness: 0.75 }),
  )
  top.position.y = -0.04
  top.receiveShadow = true
  workbench.add(top)

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(4.667, 0.08, 3.536),
    new THREE.MeshStandardMaterial({ color: 0x667085, metalness: 0.45, roughness: 0.55 }),
  )
  frame.position.y = -0.1
  frame.receiveShadow = true
  workbench.add(frame)

  return workbench
}

function createFallbackRobot(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'KUKA_Fallback_Robot'

  const material = new THREE.MeshStandardMaterial({ color: 0xe6a400, metalness: 0.35, roughness: 0.5 })
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x343b48, metalness: 0.6, roughness: 0.35 })

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
  const addFallbackJoint = (name: (typeof KUKA_JOINT_NODE_NAMES)[number], mesh: THREE.Mesh): void => {
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

function configureRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-label', 'KUKA 机器人三维场景')
  container.appendChild(renderer.domElement)
  return renderer
}

function configureLighting(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xf6f8fb, 0x4b5563, 1.8))

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2)
  keyLight.position.set(3.5, 5.5, 4)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(2048, 2048)
  keyLight.shadow.camera.near = 0.1
  keyLight.shadow.camera.far = 20
  keyLight.shadow.camera.left = -5
  keyLight.shadow.camera.right = 5
  keyLight.shadow.camera.top = 5
  keyLight.shadow.camera.bottom = -5
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0x9ab9e8, 1.4)
  fillLight.position.set(-4, 3, -2)
  scene.add(fillLight)
}

function configureBaseScene(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x101827)
  scene.add(createWorkbench())

  const grid = new THREE.GridHelper(8, 32, 0x64748b, 0x334155)
  grid.position.y = 0.002
  grid.name = 'Ground_Grid'
  scene.add(grid)

  const axes = new THREE.AxesHelper(0.8)
  axes.position.y = 0.01
  axes.name = 'World_Axes'
  scene.add(axes)
}

/** 创建不依赖浏览器渲染器的基准场景树，便于初始化测试和后续场景适配复用。 */
export function createBenchmarkScene(): THREE.Scene {
  const scene = new THREE.Scene()
  configureBaseScene(scene)
  configureLighting(scene)
  return scene
}

function configureCamera(container: HTMLElement): THREE.PerspectiveCamera {
  const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1)
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.01, 100)
  camera.position.set(3.4, 2.35, 4.25)
  return camera
}

function configureControls(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): OrbitControls {
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = true
  controls.enableZoom = true
  controls.enableRotate = true
  controls.minDistance = 1.1
  controls.maxDistance = 12
  controls.target.set(0, 1.1, 0)
  controls.update()
  return controls
}

export function createKukaScene(
  container: HTMLElement,
  options: KukaSceneOptions = {},
): KukaSceneController {
  const onStatus = options.onStatus ?? (() => undefined)
  const scene = createBenchmarkScene()
  const camera = configureCamera(container)
  const renderer = configureRenderer(container)
  const controls = configureControls(camera, renderer)
  const loader = new GLTFLoader()
  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  })
  let animationFrame = 0
  let loadedModel: THREE.Group | null = null
  let targetJoints: JointAngles = [...DEFAULT_JOINTS]
  let disposed = false

  resizeObserver.observe(container)
  onStatus('loading')

  loader.load(
    KUKA_MODEL_URL,
    (gltf) => {
      if (disposed) return
      loadedModel = prepareModel(gltf.scene)
      applyJointAngles(loadedModel, targetJoints)
      scene.add(loadedModel)
      onStatus('ready')
      console.info('[KukaScene] KUKA 基准模型加载完成')
    },
    undefined,
    (error) => {
      if (disposed) return
      const fallback = createFallbackRobot()
      scene.add(fallback)
      loadedModel = fallback
      applyJointAngles(loadedModel, targetJoints)
      onStatus('error')
      console.error('[KukaScene] KUKA 模型加载失败，已显示本地占位模型', error)
    },
  )

  const render = (): void => {
    if (disposed) return
    controls.update()
    renderer.render(scene, camera)
    animationFrame = window.requestAnimationFrame(render)
  }
  render()

  return {
    setJoints: (joints: JointAngles) => {
      targetJoints = [...joints]
      if (loadedModel) applyJointAngles(loadedModel, targetJoints)
    },
    dispose: () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()

      scene.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return
        node.geometry.dispose()
        if (Array.isArray(node.material)) {
          node.material.forEach((material) => material.dispose())
        } else {
          node.material.dispose()
        }
      })

      renderer.domElement.remove()
      console.info('[KukaScene] 场景资源已释放')
    },
  }
}
