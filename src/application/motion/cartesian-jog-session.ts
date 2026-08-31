import type { JointAngles, PoseDisplay } from '@/robot-geometry/model/index.ts'

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
  getAnchor: (fallback: PoseDisplay) => PoseDisplay
  getPlanningJoints: (fallback: JointAngles) => JointAngles
  commit: (pose: PoseDisplay, joints: JointAngles) => void
  end: () => void
}

export function createCartesianJogSession(): CartesianJogSession {
  let active = false
  let committed: PoseDisplay | null = null
  let committedJoints: JointAngles | null = null

  function begin(pose: PoseDisplay, joints?: JointAngles): void {
    committed = clonePose(pose)
    committedJoints = joints ? ([...joints] as JointAngles) : null
    active = true
  }

  function getAnchor(fallback: PoseDisplay): PoseDisplay {
    // 规划中的 requested 只是输入快照，不能作为下一次目标的锚点；
    // 只有已成功提交的 committed 才能推进连续点动，避免未完成请求累积成未来队列。
    return clonePose(committed ?? fallback)
  }

  function getPlanningJoints(fallback: JointAngles): JointAngles {
    return committedJoints ? ([...committedJoints] as JointAngles) : ([...fallback] as JointAngles)
  }

  function commit(pose: PoseDisplay, joints: JointAngles): void {
    if (!active) return
    committed = clonePose(pose)
    committedJoints = [...joints] as JointAngles
  }

  function end(): void {
    active = false
    committed = null
    committedJoints = null
  }

  return {
    begin,
    isActive: () => active,
    getAnchor,
    getPlanningJoints,
    commit,
    end,
  }
}
