import type { JointAngles, PoseDisplay } from '@/robotics/types.ts'

function clonePose(pose: PoseDisplay): PoseDisplay {
  return {
    positionMm: [...pose.positionMm] as PoseDisplay['positionMm'],
    orientationDeg: [...pose.orientationDeg] as PoseDisplay['orientationDeg'],
  }
}

/** 长按笛卡尔 Jog 的目标锚点；不读取执行中的瞬时动画帧作为下一次规划起点。 */
export interface CartesianJogSession {
  begin: (pose: PoseDisplay, joints?: JointAngles) => void
  isActive: () => boolean
  getGeneration: () => number
  getAnchor: (fallback: PoseDisplay) => PoseDisplay
  getPlanningJoints: (fallback: JointAngles) => JointAngles
  request: (pose: PoseDisplay) => void
  commit: (pose: PoseDisplay, joints: JointAngles) => void
  rollback: () => void
  end: () => void
}

export function createCartesianJogSession(): CartesianJogSession {
  let active = false
  let committed: PoseDisplay | null = null
  let requested: PoseDisplay | null = null
  let committedJoints: JointAngles | null = null
  let generation = 0

  function begin(pose: PoseDisplay, joints?: JointAngles): void {
    committed = clonePose(pose)
    requested = clonePose(pose)
    committedJoints = joints ? [...joints] as JointAngles : null
    generation += 1
    active = true
  }

  function getAnchor(fallback: PoseDisplay): PoseDisplay {
    return clonePose(requested ?? committed ?? fallback)
  }

  function getPlanningJoints(fallback: JointAngles): JointAngles {
    return committedJoints ? [...committedJoints] as JointAngles : [...fallback] as JointAngles
  }

  function request(pose: PoseDisplay): void {
    if (!active) begin(pose)
    requested = clonePose(pose)
  }

  function commit(pose: PoseDisplay, joints: JointAngles): void {
    if (!active) return
    committed = clonePose(pose)
    requested = clonePose(pose)
    committedJoints = [...joints] as JointAngles
    generation += 1
  }

  function rollback(): void {
    requested = committed ? clonePose(committed) : null
  }

  function end(): void {
    active = false
    committed = null
    requested = null
    committedJoints = null
    generation += 1
  }

  return {
    begin,
    isActive: () => active,
    getGeneration: () => generation,
    getAnchor,
    getPlanningJoints,
    request,
    commit,
    rollback,
    end,
  }
}
