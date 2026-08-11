import { estimateNumericalJacobian } from '../core/robot/numerical-jacobian'
import type { RobotModel } from '../core/robot/robot-model'
import type { JointAngles, Pose } from '../core/robot/types'
import { AbbDhRobotModel } from '../robots/abb-irb1200/dh-robot-model'

/** ABB 场景模型适配器；当前候选 DH 仍是 FK/Jacobian 的唯一计算来源。 */
export class AbbSceneRobotModel implements RobotModel {
  private readonly kinematicsModel = new AbbDhRobotModel()

  isAvailable(): boolean {
    return true
  }

  forwardKinematics(jointsDeg: JointAngles): Pose | null {
    // FBX 仅作为可视化资产；当前使用报告中的ABB候选等价DH链作为FK/IK数据源。
    return this.kinematicsModel.forwardKinematics(jointsDeg)
  }

  estimateJacobian(jointsDeg: JointAngles, stepDeg = 0.2): number[][] | null {
    return estimateNumericalJacobian(this.forwardKinematics.bind(this), jointsDeg, stepDeg)
  }
}
