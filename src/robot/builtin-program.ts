import type {
  StructuredMoveJ,
  StructuredMoveL,
  RobTarget,
  SpeedData,
} from '../core/rapid/rapid-types'
import { defaultTool0, defaultWobj0, defaultZoneFine } from '../core/rapid/rapid-types'

/**
 * 内置演示程序各目标点基准：ABB IRB 1200-5/0.9 在 home 零位的 TCP 位置（毫米）。
 * 目标值固定、可读，并由 ABB 模型验证可达；不是运行时根据当前 FK 临时生成的“假”目标。
 */
const HOME_TCP_MM: [number, number, number] = [451, 713, 0]

/** 绕工具 Z 轴旋转 deg 度的四元数 (x,y,z,w)，标量 w 在最后。yaw(90) 即绕 Z 转 90°。 */
function yaw(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 180 / 2
  return [0, 0, Math.sin(half), Math.cos(half)]
}

/** 由 home 基准叠加固定偏移、携带给定姿态（默认零姿态），构造一个 robtarget 目标点。 */
function targetPos(
  dx: number,
  dy: number,
  dz: number,
  rot: [number, number, number, number] = [0, 0, 0, 1],
): RobTarget {
  return {
    trans: [HOME_TCP_MM[0] + dx, HOME_TCP_MM[1] + dy, HOME_TCP_MM[2] + dz],
    rot,
    robconf: [0, 0, 0, 0],
    extax: [0, 0, 0, 0, 0, 0],
  }
}

/** 场景演示的两种速级：接近/转移用较快速，取放/定位用较慢速，便于观察段落差异。 */
const FAST_SPEED: SpeedData = { v_tcp: 150, v_ori: 150, v_leax: 150, v_reax: 150 }
const WORK_SPEED: SpeedData = { v_tcp: 60, v_ori: 60, v_leax: 60, v_reax: 60 }

/**
 * 页面内置演示程序：模拟一次“取件 → 转移 → 放件”的搬运循环。
 *
 * 结构：MoveJ 高速接近取件点上方 → MoveL 低速下降取件 → MoveL 低速提起
 * → MoveJ 高速转移到放件点上方 → MoveL 低速下降放件 → MoveL 低速提起
 * → MoveJ 高速返回高位姿态点。全部使用 tool0/wobj0/fine、无外部轴。
 *
 * 取件/放件两工位位于 home 两侧、相距约 280 mm；取件姿态为 0°，放件姿态绕 Z 转 90°，
 * 即经典的“抓取后回转 90° 再放置”。用 7 段、MoveJ/MoveL 交替、速级变化且
 * 取向不同的路径证明结构化执行链按序推进，而不是 parser 替代品。
 */
export function createBuiltinProgram(): (StructuredMoveJ | StructuredMoveL)[] {
  /** 各指令共用的 zone/tool/wobj（均为默认值）。 */
  const common = {
    zone: defaultZoneFine(),
    tool: defaultTool0(),
    wobj: defaultWobj0(),
  }

  // 取件点 P（home 前左，0° 姿态）与放件点 Q（home 后右，90° 姿态）分居两侧，
  // 各提供“上方高位”与“下方工作位”两个高度供下降/提起复用。
  const PICK_APPR = targetPos(100, -100, 60)
  const PICK_DOWN = targetPos(100, -100, 25)
  const PLACE_APPR = targetPos(-100, 100, 60, yaw(90))
  const PLACE_DOWN = targetPos(-100, 100, 25, yaw(90))
  const rest = targetPos(0, 0, 120)

  return [
    // 1. 高速接近取件点上方，不执行取放动作。
    { kind: 'movej', speed: FAST_SPEED, ...common, target: PICK_APPR },
    // 2. 低速下降至取件工作位。
    { kind: 'movel', speed: WORK_SPEED, ...common, target: PICK_DOWN },
    // 3. 低速提起，脱离取件点。
    { kind: 'movel', speed: WORK_SPEED, ...common, target: PICK_APPR },
    // 4. 高速转移到放件点上方（姿态回转 90°）。
    { kind: 'movej', speed: FAST_SPEED, ...common, target: PLACE_APPR },
    // 5. 低速下降至放件工作位。
    { kind: 'movel', speed: WORK_SPEED, ...common, target: PLACE_DOWN },
    // 6. 低速提起，脱离放件点。
    { kind: 'movel', speed: WORK_SPEED, ...common, target: PLACE_APPR },
    // 7. 高速返回高位姿态点。
    { kind: 'movej', speed: FAST_SPEED, ...common, target: rest },
  ]
}

