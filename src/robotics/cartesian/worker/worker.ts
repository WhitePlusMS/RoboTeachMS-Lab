import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/profile.ts'
import { planCartesianTarget } from '../index.ts'
import type { CartesianPathResult } from '../path-planner.ts'
import type { JointAngles, Pose } from '../../model/types.ts'

interface PlannerRequest {
  requestId: number
  targetPose: Pose
  initialJoints: JointAngles
}

interface PlannerResponse {
  requestId: number
  result: CartesianPathResult
}

interface PlannerWorkerScope {
  onmessage: ((event: MessageEvent<PlannerRequest>) => void) | null
  postMessage: (message: PlannerResponse) => void
}

const workerScope = globalThis as unknown as PlannerWorkerScope

workerScope.onmessage = (event) => {
  const { requestId, targetPose, initialJoints } = event.data
  const result = planCartesianTarget(targetPose, initialJoints, ABB_IRB1200_PROFILE)
  workerScope.postMessage({ requestId, result })
}

export {}
