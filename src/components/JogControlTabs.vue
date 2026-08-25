<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import CartesianControlPanel from './CartesianControlPanel.vue'
import JointControlPanel from './JointControlPanel.vue'
import type {
  JointAngles,
  PoseDisplay,
} from '@/robotics/model/types.ts'
import type { CartesianAxis, CoordinateSystem } from '@/application/cartesian-types.ts'
import type { JointRange } from '@/robotics/model/robot-profile.ts'
import type { JointDirection, JointStep } from '@/application/joint-control.ts'
import type {
  CartesianDirection,
  CartesianStatus,
  OrientationStep,
  PositionStep,
} from '@/application/cartesian-control.ts'
import {
  injectRobotController,
  type RobotController,
} from '@/application/use-robot-controller.ts'

interface Props {
  joints?: JointAngles
  jointRanges?: readonly JointRange[]
  jointStep?: JointStep
  pose?: PoseDisplay
  coordinateSystem?: CoordinateSystem
  positionStep?: PositionStep
  orientationStep?: OrientationStep
  status?: CartesianStatus
  statusMessage?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'set-joint': [index: number, value: number]
  'adjust-joint': [index: number, direction: JointDirection, isContinuous?: boolean]
  'step-change': [value: number]
  reset: []
  'mechanical-zero': []
  random: []
  move: [axis: CartesianAxis, direction: CartesianDirection, isContinuous?: boolean]
  'coordinate-change': [value: CoordinateSystem]
  'position-step-change': [value: number]
  'orientation-step-change': [value: number]
}>()

const EMPTY_JOINTS: JointAngles = [0, 0, 0, 0, 0, 0]
const EMPTY_POSE: PoseDisplay = { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }

/**
 * 共享控制器：App provide 时直接使用；独立挂载（测试）时回退到本地 props + 转发事件。
 * 这样左侧 Jog 工作区在真实应用里无需再传一长串 props/emits。
 */
const controller: RobotController =
  injectRobotController() ??
  {
    joints: computed(() => props.joints ?? EMPTY_JOINTS),
    jointRanges: props.jointRanges ?? [],
    jointStep: computed(() => props.jointStep ?? 1),
    pose: computed(() => props.pose ?? EMPTY_POSE),
    coordinateSystem: computed(() => props.coordinateSystem ?? 'World'),
    positionStep: computed(() => props.positionStep ?? 1),
    orientationStep: computed(() => props.orientationStep ?? 1),
    status: computed(() => props.status ?? 'ready'),
    statusMessage: computed(() => props.statusMessage ?? ''),
    setJoint: (index, value) => emit('set-joint', index, value),
    adjustJoint: (index, direction, isContinuous) =>
      emit('adjust-joint', index, direction, isContinuous),
    setStep: (value) => emit('step-change', value),
    reset: () => emit('reset'),
    resetMechanicalZero: () => emit('mechanical-zero'),
    randomize: () => emit('random'),
    moveCartesian: (axis, direction, isContinuous) =>
      emit('move', axis, direction, isContinuous),
    beginCartesianContinuous: () => {},
    endCartesianContinuous: () => {},
    setCoordinateSystem: (value) => emit('coordinate-change', value),
    setPositionStep: (value) => emit('position-step-change', value),
    setOrientationStep: (value) => emit('orientation-step-change', value),
  }

type JogTab = 'joint' | 'cartesian'
const activeTab = ref<JogTab>('joint')
const jointTabButton = ref<HTMLButtonElement | null>(null)
const cartesianTabButton = ref<HTMLButtonElement | null>(null)

function selectTab(tab: JogTab): void {
  activeTab.value = tab
}

function focusActiveTab(): void {
  void nextTick(() => {
    const button = activeTab.value === 'joint' ? jointTabButton.value : cartesianTabButton.value
    button?.focus()
  })
}

function handleTabKeydown(event: KeyboardEvent, tab: JogTab): void {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    selectTab(tab === 'joint' ? 'cartesian' : 'joint')
    focusActiveTab()
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    selectTab(tab === 'cartesian' ? 'joint' : 'cartesian')
    focusActiveTab()
  } else if (event.key === 'Home') {
    event.preventDefault()
    selectTab('joint')
    focusActiveTab()
  } else if (event.key === 'End') {
    event.preventDefault()
    selectTab('cartesian')
    focusActiveTab()
  }
}
</script>

<template>
  <section class="jog-control-tabs" aria-label="手动 Jog 控制">
    <div class="workbench-tabs" role="tablist" aria-label="Jog 模式">
      <button
        id="jog-tab-joint"
        ref="jointTabButton"
        type="button"
        role="tab"
        class="workbench-tab"
        :class="{ active: activeTab === 'joint' }"
        :aria-selected="activeTab === 'joint'"
        aria-controls="jog-panel-joint"
        :tabindex="activeTab === 'joint' ? 0 : -1"
        title="关节模式：逐轴调整各关节角度"
        @click="selectTab('joint')"
        @keydown="handleTabKeydown($event, 'joint')"
      >
        关节
      </button>
      <button
        id="jog-tab-cartesian"
        ref="cartesianTabButton"
        type="button"
        role="tab"
        class="workbench-tab"
        :class="{ active: activeTab === 'cartesian' }"
        :aria-selected="activeTab === 'cartesian'"
        aria-controls="jog-panel-cartesian"
        :tabindex="activeTab === 'cartesian' ? 0 : -1"
        title="笛卡尔模式：按坐标移动 TCP"
        @click="selectTab('cartesian')"
        @keydown="handleTabKeydown($event, 'cartesian')"
      >
        笛卡尔
      </button>
    </div>

    <div
      id="jog-panel-joint"
      class="jog-tabpanel"
      role="tabpanel"
      aria-labelledby="jog-tab-joint"
      :hidden="activeTab !== 'joint'"
    >
      <JointControlPanel
        :joints="controller.joints.value"
        :joint-ranges="controller.jointRanges"
        :joint-step="controller.jointStep.value"
        @set-joint="controller.setJoint"
        @adjust-joint="controller.adjustJoint"
        @step-change="controller.setStep"
        @reset="controller.reset"
        @mechanical-zero="controller.resetMechanicalZero"
        @random="controller.randomize"
      />
    </div>

    <div
      id="jog-panel-cartesian"
      class="jog-tabpanel"
      role="tabpanel"
      aria-labelledby="jog-tab-cartesian"
      :hidden="activeTab !== 'cartesian'"
    >
      <CartesianControlPanel
        :coordinate-system="controller.coordinateSystem.value"
        :position-step="controller.positionStep.value"
        :orientation-step="controller.orientationStep.value"
        :status="controller.status.value"
        :status-message="controller.statusMessage.value"
        @move="controller.moveCartesian"
        @continuous-start="controller.beginCartesianContinuous"
        @continuous-end="controller.endCartesianContinuous"
        @coordinate-change="controller.setCoordinateSystem"
        @position-step-change="controller.setPositionStep"
        @orientation-step-change="controller.setOrientationStep"
      />
    </div>
  </section>
</template>

<style scoped>
.jog-control-tabs {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  height: 100%;
  padding: 12px 16px 0;
  overflow: hidden;
  min-height: 0;
}

.jog-tabpanel {
  min-height: 0;
  overflow: hidden auto;
}
</style>
