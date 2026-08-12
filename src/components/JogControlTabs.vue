<script setup lang="ts">
import { nextTick, ref } from 'vue'
import CartesianControlPanel from './CartesianControlPanel.vue'
import JointControlPanel from './JointControlPanel.vue'
import type { CartesianAxis, CoordinateSystem, JointAngles, PoseDisplay } from '../robotics/types.ts'
import type { JointRange, } from '../robotics/robot-profile.ts'
import type { JointDirection, JointStep } from '../application/joint-control.ts'
import type {
  CartesianDirection,
  CartesianStatus,
  OrientationStep,
  PositionStep,
} from '../application/cartesian-control.ts'

interface Props {
  joints: JointAngles
  jointRanges: readonly JointRange[]
  jointStep: JointStep
  pose: PoseDisplay
  coordinateSystem: CoordinateSystem
  positionStep: PositionStep
  orientationStep: OrientationStep
  status: CartesianStatus
  statusMessage: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'set-joint': [index: number, value: number]
  'adjust-joint': [index: number, direction: JointDirection, isContinuous?: boolean]
  'step-change': [value: number]
  reset: []
  random: []
  move: [axis: CartesianAxis, direction: CartesianDirection, isContinuous?: boolean]
  'set-field': [axis: CartesianAxis, value: number]
  'coordinate-change': [value: CoordinateSystem]
  'position-step-change': [value: number]
  'orientation-step-change': [value: number]
}>()

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

function forwardSetJoint(index: number, value: number): void {
  emit('set-joint', index, value)
}

function forwardAdjustJoint(index: number, direction: JointDirection, isContinuous?: boolean): void {
  emit('adjust-joint', index, direction, isContinuous)
}

function forwardMove(axis: CartesianAxis, direction: CartesianDirection, isContinuous?: boolean): void {
  emit('move', axis, direction, isContinuous)
}

function forwardSetField(axis: CartesianAxis, value: number): void {
  emit('set-field', axis, value)
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
        @click="selectTab('joint')"
        @keydown="handleTabKeydown($event, 'joint')"
      >关节</button>
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
        @click="selectTab('cartesian')"
        @keydown="handleTabKeydown($event, 'cartesian')"
      >笛卡尔</button>
    </div>

    <div
      id="jog-panel-joint"
      class="jog-tabpanel"
      role="tabpanel"
      aria-labelledby="jog-tab-joint"
      :hidden="activeTab !== 'joint'"
    >
      <JointControlPanel
        :joints="props.joints"
        :joint-ranges="props.jointRanges"
        :joint-step="props.jointStep"
        :pose="props.pose"
        @set-joint="forwardSetJoint"
        @adjust-joint="forwardAdjustJoint"
        @step-change="emit('step-change', $event)"
        @reset="emit('reset')"
        @random="emit('random')"
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
        :pose="props.pose"
        :coordinate-system="props.coordinateSystem"
        :position-step="props.positionStep"
        :orientation-step="props.orientationStep"
        :status="props.status"
        :status-message="props.statusMessage"
        @move="forwardMove"
        @set-field="forwardSetField"
        @coordinate-change="emit('coordinate-change', $event)"
        @position-step-change="emit('position-step-change', $event)"
        @orientation-step-change="emit('orientation-step-change', $event)"
      />
    </div>
  </section>
</template>
