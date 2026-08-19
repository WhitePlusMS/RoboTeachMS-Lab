import { inject, provide, type InjectionKey } from 'vue'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/controlled-rapid-edit.ts'
import type {
  RapidExecutableInstruction,
  RapidMotionInsertionPoint,
  RapidProgramData,
} from '@/rapid/rapid-parser.ts'
import type { Pose } from '@/robotics/types.ts'
import type { RapidScalarVariable } from '@/rapid/rapid-types.ts'

/**
 * 只读 ref：面板只读展示控制器提供的状态切片，因此只要求可读的 .value。
 * 既接受 Ref 也接受 ComputedRef，避免把控制器与某一具体响应式实现耦合。
 */
type ReadonlyRef<T> = { readonly value: T }

/**
 * 右侧 RAPID/Program Data 工作区共享的控制器切片（由 App 单一实例化并 provide）。
 * Program Data 视图（data/activeIndex/canExecute/program/insertionPoints/runtimeValues）
 * 全部从同一次 parseRapidProgram 结果派生，不建立第二份点位存储或平行 parser。
 * 动作切片（run/step/stop/ppToMain/…/applyEdit）委托给唯一 ProgramController。
 * 点位选中态由 App 单一持有，ProgramDataPanel 是受控组件。
 */
export interface ProgramPanelController {
  snapshot: ReadonlyRef<ProgramControllerSnapshot>
  source: ReadonlyRef<string>
  program: ReadonlyRef<readonly RapidExecutableInstruction[]>
  pendingClear: ReadonlyRef<'run' | 'step' | null>
  data: ReadonlyRef<readonly RapidProgramData[]>
  activeIndex: ReadonlyRef<number | null>
  canExecute: ReadonlyRef<boolean>
  insertionPoints: ReadonlyRef<readonly RapidMotionInsertionPoint[]>
  pose: ReadonlyRef<Pose | null>
  runtimeValues: ReadonlyRef<ReadonlyMap<string, RapidScalarVariable>>
  /** App 唯一持有的点位选中名称；null 表示未选中。 */
  selectedTargetName: ReadonlyRef<string | null>
  applyEdit: (command: RapidEditCommand) => RapidEditResult
  run(): void
  step(): void
  stop(): void
  ppToMain(): void
  confirmClearToNext(): void
  cancelClearToNext(): void
  setSource(source: string): void
  /** 更新共享选中态；ProgramDataPanel 通过该入口与 App 同步。 */
  selectTarget(name: string | null): void
}

export const ProgramPanelControllerKey: InjectionKey<ProgramPanelController> = Symbol(
  'program-panel-controller',
)

/** 由 App 在 setup 中调用一次，把右侧程序工作区共享控制器提供给 ProgramWorkspace 子树。 */
export function provideProgramPanelController(controller: ProgramPanelController): void {
  provide(ProgramPanelControllerKey, controller)
}

/** ProgramWorkspace inject；无提供方（如独立测试挂载）时返回 null，由组件回退到自己的 props。 */
export function injectProgramPanelController(): ProgramPanelController | null {
  return inject(ProgramPanelControllerKey, null)
}
