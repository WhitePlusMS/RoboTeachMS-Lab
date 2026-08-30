import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Pose } from '@/robot-geometry/model/index.ts'
import {
  abbPoseToSceneTransform,
  sceneTransformToAbbPose,
} from '@/robot-geometry/math/scene-pose-transform.ts'
import { findNode } from './scene-factory.ts'

export type TransformGizmoMode = 'translate' | 'rotate'

export interface AbbTransformGizmoOptions {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  domElement: HTMLElement
  /** 相机轨道控制器；拖拽时临时禁用避免与操作轴手柄冲突。 */
  orbitControls: OrbitControls
  /** 法兰/tool 节点名称（ABB 为 joint6）。 */
  flangeNodeName: string
  /** 解析当前布局的根模型（null 表示尚未加载）。 */
  getModel: () => THREE.Object3D | null
  /** 当前 DH 机械法兰位姿；操作轴跟随它而非 FBX 的近似骨骼原点。 */
  getAuthoritativePose?: () => Pose | null
  /** 对目标 ABB Pose 求解 IK；成功并应用返回 true，不可达返回 false。 */
  solveTargetPose: (pose: Pose) => boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  /** 控制手柄是否允许用户拖拽（用于程序运行期间禁止）。 */
  isInteractive?: () => boolean
}

/**
 * 末端法兰拖拽操作轴（TransformControls 封装）。
 *
 * 用原生 three 的 TransformControls 挂到一个「弱代理」dummy Object3D 上，dummy 平时优先跟随
 * DH 机械法兰的场景位姿（未提供运动学回调时才降级跟随 joint6）。拖拽时读取 dummy 的世界位姿
 * （场景 frame），换算成 ABB 基座 Pose 交给 solveTargetPose（DH IK），成功则关节被应用、FBX
 * 跟随；失败/不可达则 dummy 回弹到最新有效法兰位姿，避免手柄与机械臂脱节。与参考项目
 * （React drei TransformControls + dummy）同构，只是用 imperative 原生实现。
 */
export class AbbTransformGizmo {
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: TransformControls
  private readonly dummy: THREE.Object3D
  private readonly options: AbbTransformGizmoOptions

  private mode: TransformGizmoMode = 'translate'
  private enabled = false
  private dragging = false
  private frameId: number | null = null

  private readonly posBuf = new THREE.Vector3()
  private readonly quatBuf = new THREE.Quaternion()

  constructor(options: AbbTransformGizmoOptions) {
    this.options = options
    this.scene = options.scene
    this.camera = options.camera

    this.dummy = new THREE.Object3D()
    this.dummy.name = 'abb-transform-gizmo-dummy'

    this.controls = new TransformControls(this.camera, options.domElement)
    this.controls.setMode(this.mode)
    this.controls.setSize(1)
    this.controls.attach(this.dummy)
    this.scene.add(this.dummy)
    this.scene.add(this.controls.getHelper())
    this.visible(false)

    this.controls.addEventListener('dragging-changed', this.handleDraggingChanged)
    this.controls.addEventListener('objectChange', this.handleObjectChange)
  }

  /** 当归帧跟随法兰或读取世界位姿时统一更新的方法。 */
  private followFlange(): boolean {
    const authoritativePose = this.options.getAuthoritativePose?.()
    if (authoritativePose) {
      const transform = abbPoseToSceneTransform(authoritativePose, this.baseHeightMm)
      this.dummy.position.set(...transform.position)
      this.dummy.quaternion.set(...transform.quaternion)
      return true
    }

    const model = this.options.getModel()
    if (!model) return false
    const flange = findNode(model, this.options.flangeNodeName)
    if (!flange) return false
    model.updateMatrixWorld(true)
    flange.getWorldPosition(this.posBuf)
    flange.getWorldQuaternion(this.quatBuf)
    this.dummy.position.copy(this.posBuf)
    this.dummy.quaternion.copy(this.quatBuf)
    return true
  }

  /** three TransformControls 把 'dragging-changed' 事件 value 声明为 unknown（见 @types/three）。 */
  private readonly handleDraggingChanged = (event: { value: unknown }): void => {
    const interactive = this.options.isInteractive?.() ?? true
    const dragging = event.value === true
    // 拖拽期间禁用轨道控制，避免两者抢鼠标（参照 drei 自动禁用行为）。
    this.options.orbitControls.enabled = interactive && !dragging
    if (!interactive) return
    this.dragging = dragging
    if (this.dragging) this.options.onDragStart?.()
    else this.options.onDragEnd?.()
  }

  private readonly handleObjectChange = (): void => {
    if (!this.dragging) return
    const targetPose = sceneTransformToAbbPose(
      [this.dummy.position.x, this.dummy.position.y, this.dummy.position.z],
      [
        this.dummy.quaternion.x,
        this.dummy.quaternion.y,
        this.dummy.quaternion.z,
        this.dummy.quaternion.w,
      ],
      this.baseHeightMm,
    )
    if (this.options.solveTargetPose(targetPose)) return
    // 不可达：dummy 回弹到法兰位姿
    this.followFlange()
  }

  private baseHeightMm = 0

  setBaseHeightMm(heightMm: number): void {
    this.baseHeightMm = Math.max(0, heightMm)
  }

  setMode(mode: TransformGizmoMode): void {
    this.mode = mode
    this.controls.setMode(mode)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.controls.enabled = enabled
    this.visible(enabled)
    if (enabled) {
      this.followFlange()
      this.startLoop()
    } else {
      this.dragging = false
      this.stopLoop()
      // 禁用操作轴时确保轨道控制恢复可用，避免残留禁用。
      this.options.orbitControls.enabled = this.options.isInteractive?.() ?? true
    }
  }

  private visible(show: boolean): void {
    this.controls.getHelper().visible = show
    this.controls.enabled = show
  }

  private startLoop(): void {
    if (this.frameId !== null) return
    const tick = (): void => {
      if (!this.enabled) {
        this.frameId = null
        return
      }
      if (!this.dragging) this.followFlange()
      this.frameId = window.requestAnimationFrame(tick)
    }
    this.frameId = window.requestAnimationFrame(tick)
  }

  private stopLoop(): void {
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId)
      this.frameId = null
    }
  }

  dispose(): void {
    this.stopLoop()
    this.controls.removeEventListener('dragging-changed', this.handleDraggingChanged)
    this.controls.removeEventListener('objectChange', this.handleObjectChange)
    this.controls.dispose()
    this.scene.remove(this.controls.getHelper())
    this.scene.remove(this.dummy)
  }
}
