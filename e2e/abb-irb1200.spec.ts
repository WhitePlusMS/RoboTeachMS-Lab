import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { extractPose } from '../src/core/robot/kinematics'
import type { JointAngles } from '../src/core/robot/types'
import { forwardAbbKinematicsDegrees } from '../src/robots/abb-irb1200/abb-kinematics'
import {
  ABB_FLANGE_NODE_NAME,
  applyAbbJointAngles,
  findNode,
  prepareAbbModel,
} from '../src/scene/abb-scene'

async function readDisplayedPose(page: Parameters<typeof test>[0]['page']): Promise<{
  position: [number, number, number]
  orientation: [number, number, number]
}> {
  const values = await page.locator('[aria-label="正解结果"] .pose-grid strong').allTextContents()
  return {
    position: values.slice(0, 3).map(Number) as [number, number, number],
    orientation: values.slice(3, 6).map(Number) as [number, number, number],
  }
}

async function setJoints(
  page: Parameters<typeof test>[0]['page'],
  joints: JointAngles,
): Promise<void> {
  for (let index = 0; index < joints.length; index += 1) {
    const input = page.getByRole('spinbutton', { name: `J${index + 1} 角度输入` })
    await input.fill(String(joints[index]))
    await input.press('Tab')
  }
}

function readVisualFlangePose(flange: THREE.Object3D): {
  position: [number, number, number]
  quaternion: THREE.Quaternion
} {
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  flange.getWorldPosition(position)
  flange.getWorldQuaternion(quaternion)
  position.multiplyScalar(1000)
  return {
    position: [position.x, position.y, position.z],
    quaternion,
  }
}

function rotationQuaternion(rotation: number[][]): THREE.Quaternion {
  const matrix = new THREE.Matrix4().set(
    rotation[0][0], rotation[0][1], rotation[0][2], 0,
    rotation[1][0], rotation[1][1], rotation[1][2], 0,
    rotation[2][0], rotation[2][1], rotation[2][2], 0,
    0, 0, 0, 1,
  )
  return new THREE.Quaternion().setFromRotationMatrix(matrix)
}

function quaternionDistanceDegrees(actual: THREE.Quaternion, expected: THREE.Quaternion): number {
  const dot = Math.min(1, Math.abs(actual.dot(expected)))
  return (2 * Math.acos(dot) * 180) / Math.PI
}

test.describe('ABB IRB 1200-5/0.9 教学场景', () => {
  test('验证FBX法兰与ABB候选DH正解闭环', async ({}, testInfo) => {
    const bytes = fs.readFileSync('public/models/ABB_IRB1200_5_90.fbx')
    const model = new FBXLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )
    const prepared = prepareAbbModel(model)
    const flange = findNode(prepared, ABB_FLANGE_NODE_NAME)
    expect(flange).not.toBeNull()
    if (!flange) return

    const samples: JointAngles[] = [
      [0, 0, 0, 0, 0, 0],
      [10, 0, 0, 0, 0, 0],
      [0, 10, 0, 0, 0, 0],
      [0, 0, 10, 0, 0, 0],
      [0, 0, 0, 10, 0, 0],
      [0, 0, 0, 0, 10, 0],
      [0, 0, 0, 0, 0, 10],
      [15, -20, 30, 10, 25, -15],
    ]
    const measurements = samples.map((joints) => {
      applyAbbJointAngles(prepared, joints)
      prepared.updateMatrixWorld(true)
      const actual = readVisualFlangePose(flange)
      const expectedMatrix = forwardAbbKinematicsDegrees(joints)
      const expectedPose = extractPose(expectedMatrix)
      const positionDelta = actual.position.map(
        (value, index) => value - expectedPose.position[index],
      ) as [number, number, number]
      const positionError = Math.hypot(...positionDelta)
      const orientationError = quaternionDistanceDegrees(
        actual.quaternion,
        rotationQuaternion(expectedPose.rotation),
      )
      return {
        joints,
        actual: actual.position,
        expected: expectedPose.position,
        positionDelta,
        positionError,
        orientationError,
      }
    })

    console.info('[ABB-FBX-DH-MEASURE]', JSON.stringify(measurements))
    await testInfo.attach('fbx-dh-measurements.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    })

    const maxPositionError = Math.max(...measurements.map((measurement) => measurement.positionError))
    const maxOrientationError = Math.max(...measurements.map((measurement) => measurement.orientationError))
    expect(maxPositionError, JSON.stringify(measurements, null, 2)).toBeLessThan(1)
    expect(maxOrientationError, JSON.stringify(measurements, null, 2)).toBeLessThan(0.5)
  })

  test('完成模型加载、六轴控制、坐标辅助和轨迹闭环', async ({ page }) => {
    const consoleMessages: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => consoleMessages.push(message.text()))
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'ABB IRB 1200-5/0.9 教学场景' })).toBeVisible()
    await expect(page.getByText('场景已就绪')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('canvas[aria-label="ABB IRB 1200-5/0.9 三维场景"]')).toHaveCount(1)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('KUKA')
    expect(consoleMessages.some((message) => message.includes('[AbbScene] ABB FBX 加载完成'))).toBe(true)
    expect(consoleMessages.some((message) => message.includes('底座=dizuo'))).toBe(true)
    expect(pageErrors).toEqual([])

    const j1 = page.getByRole('spinbutton', { name: 'J1 角度输入' })
    await j1.fill('30')
    await j1.press('Tab')
    await expect(j1).toHaveValue('30.0')
    await j1.fill('999')
    await j1.press('Tab')
    await expect(j1).toHaveValue('170.0')
    await expect(page.getByText('-170° ~ 170°')).toBeVisible()
    await expect(page.getByText('-100° ~ 130°')).toBeVisible()
    await expect(page.getByText('-400° ~ 400°')).toBeVisible()

    const coordinateButton = page.getByRole('button', { name: '基座/工具坐标' })
    await expect(coordinateButton).toHaveAttribute('aria-pressed', 'true')
    await coordinateButton.click()
    await expect(coordinateButton).toHaveAttribute('aria-pressed', 'false')
    await coordinateButton.click()
    await expect(coordinateButton).toHaveAttribute('aria-pressed', 'true')

    const gridButton = page.getByRole('button', { name: '网格' })
    await gridButton.click()
    await expect(gridButton).toHaveAttribute('aria-pressed', 'false')
    await gridButton.click()
    await expect(gridButton).toHaveAttribute('aria-pressed', 'true')

    const trajectoryButton = page.getByRole('button', { name: '轨迹', exact: true })
    const clearTrajectoryButton = page.getByRole('button', { name: '清空轨迹' })
    await trajectoryButton.click()
    await expect(trajectoryButton).toHaveAttribute('aria-pressed', 'true')
    await j1.fill('20')
    await j1.press('Tab')
    await expect(clearTrajectoryButton).toBeEnabled({ timeout: 5_000 })
    await clearTrajectoryButton.click()
    await expect(clearTrajectoryButton).toBeDisabled()

    await page.getByRole('button', { name: '回零' }).click()
    await expect(j1).toHaveValue('0.0', { timeout: 2_000 })

    await page.screenshot({
      path: path.join(process.env.TEMP ?? '.', 'abb-irb1200-playwright.png'),
      fullPage: true,
    })
  })

  test('验证页面位姿与 ABB DH 正解闭环', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('场景已就绪')).toBeVisible({ timeout: 15_000 })

    const samples: JointAngles[] = [
      [0, 0, 0, 0, 0, 0],
      [10, 0, 0, 0, 0, 0],
      [0, 10, 0, 0, 0, 0],
      [0, 0, 10, 0, 0, 0],
      [0, 0, 0, 10, 0, 0],
      [0, 0, 0, 0, 10, 0],
      [0, 0, 0, 0, 0, 10],
      [15, -20, 30, 10, 25, -15],
    ]
    const measurements = []

    for (const joints of samples) {
      await setJoints(page, joints)
      const actual = await readDisplayedPose(page)
      const expectedMatrix = forwardAbbKinematicsDegrees(joints)
      const expected = extractPose(expectedMatrix)
      const positionDelta = actual.position.map((value, index) => value - expected.position[index]) as [number, number, number]
      const positionError = Math.hypot(...positionDelta)
      const expectedOrientation = expected.eulerZYX.map((value) => (value * 180) / Math.PI) as [number, number, number]
      const orientationDelta = actual.orientation.map((value, index) => value - expectedOrientation[index]) as [number, number, number]
      measurements.push({ joints, actual, expected: { position: expected.position, orientation: expectedOrientation }, positionDelta, orientationDelta, positionError })
    }

    const zeroPose = measurements[0].actual
    const singleAxisDeltas = measurements.slice(1, 7).map((measurement) => ({
      joints: measurement.joints,
      actualPositionDeltaFromZero: measurement.actual.position.map(
        (value, index) => value - zeroPose.position[index],
      ),
      actualOrientationDeltaFromZero: measurement.actual.orientation.map(
        (value, index) => value - zeroPose.orientation[index],
      ),
    }))

    for (const measurement of measurements) {
      console.info(
        `[ABB-DH-MEASURE] joints=${measurement.joints.join(',')} actual=${measurement.actual.position.join(',')} dh=${measurement.expected.position.join(',')} delta=${measurement.positionDelta.join(',')}`,
      )
    }

    await test.info().attach('dh-measurements.json', {
      body: JSON.stringify({ measurements, singleAxisDeltas }, null, 2),
      contentType: 'application/json',
    })
    const maxPositionError = Math.max(...measurements.map((measurement) => measurement.positionError))
    expect(maxPositionError, JSON.stringify(measurements, null, 2)).toBeLessThan(1)
  })
})
