import type { RobTarget } from '../data/index.ts'

/** 一次只执行一条的结构化编辑命令。 */
export type RapidEditCommand =
  | { type: 'create-target'; name: string; target: RobTarget }
  | { type: 'modify-position'; name: string; target: RobTarget }
  | { type: 'rename-target'; name: string; newName: string }
  | { type: 'delete-target'; name: string }
  | {
      /** FlexPendant「添加指令」：插入 MoveJ/MoveL 未示教目标。 */
      type: 'insert-motion'
      kind: 'movej' | 'movel'
      insertionIndex: number
    }
  | {
      /** 参数编辑器：改写第 index 条运动指令的目标点参数。 */
      type: 'edit-motion-operand'
      index: number
      operand: 'target'
      value: { source: 'existing'; name: string } | { source: 'new'; target: RobTarget }
    }
  | {
      /** 参数编辑器：改写第 index 条运动指令的速度/转弯区参数。 */
      type: 'edit-motion-operand'
      index: number
      operand: 'speed' | 'zone'
      value: { name: string }
    }
  | { type: 'delete-instruction'; index: number }
  | { type: 'comment-instructions'; indices: readonly number[] }
  | { type: 'uncomment-lines'; lines: readonly number[] }
  | { type: 'change-motion-kind'; index: number }

export type RapidEditErrorCode =
  | 'source-error'
  | 'invalid-name'
  | 'duplicate-name'
  | 'undefined-target'
  | 'target-referenced'
  | 'invalid-insertion-position'
  | 'invalid-instruction'
  | 'undefined-operand'

export interface RapidEditError {
  code: RapidEditErrorCode
  message: string
}

export interface RapidEditSuccess {
  source: string
  programRemap?: {
    removed?: readonly number[]
    inserted?: { at: number; count: number }
  }
  programTextChangedAt?: number
}

export type RapidEditResult =
  | { ok: true; result: RapidEditSuccess }
  | { ok: false; error: RapidEditError }
