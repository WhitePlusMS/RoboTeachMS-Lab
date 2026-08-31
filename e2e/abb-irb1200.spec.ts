import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { extractPose } from '@/robot-geometry/transform'
import type { JointAngles } from '@/robot-geometry/types'
import {
  forwardAbbKinematicsDegrees,
  forwardAbbKinematicsFramesDegrees,
} from '@/robot-models/abb-irb1200/abb-kinematics'
import {
  ABB_ACTIVE_JOINT_NODE_NAMES,
  ABB_JOINT_AXES,
  ABB_TOOL_NODE_NAME,
  applyAbbJointAngles,
  findNode,
  prepareAbbModel,
} from '@/scene/abb-scene.ts'
import { abbBaseFrameToSceneFrame, ABB_FLANGE_TO_FBX_TOOL } from '@/scene/abb-scene-transform.ts'
import { extractAbbFbxCalibration } from '@/scene/abb-fbx-calibration.ts'

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

/** 新边栏语义：Jog 控件在最右窄边栏的 Jog 功能面板里，先展开再操作。 */
async function openJogPanel(page: Parameters<typeof test>[0]['page']): Promise<void> {
  // 功能边栏 Jog 开关按钮：当前命名「手动控制」（兼容历史「手动 Jog」）。
  const jogTab = page.getByRole('button', { name: /手动/ })
  if ((await jogTab.getAttribute('aria-pressed')) !== 'true') await jogTab.click()
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

function readVisualToolPose(tool: THREE.Object3D): {
  position: [number, number, number]
  quaternion: THREE.Quaternion
} {
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  tool.getWorldPosition(position)
  tool.getWorldQuaternion(quaternion)
  position.multiplyScalar(1000)
  return {
    position: [position.x, position.y, position.z],
    quaternion,
  }
}

function rotationQuaternion(rotation: number[][]): THREE.Quaternion {
  const matrix = new THREE.Matrix4().set(
    rotation[0][0],
    rotation[0][1],
    rotation[0][2],
    0,
    rotation[1][0],
    rotation[1][1],
    rotation[1][2],
    0,
    rotation[2][0],
    rotation[2][1],
    rotation[2][2],
    0,
    0,
    0,
    0,
    1,
  )
  return new THREE.Quaternion().setFromRotationMatrix(matrix)
}

function quaternionDistanceDegrees(actual: THREE.Quaternion, expected: THREE.Quaternion): number {
  const dot = Math.min(1, Math.abs(actual.dot(expected)))
  return (2 * Math.acos(dot) * 180) / Math.PI
}

function readNodePosition(node: THREE.Object3D): [number, number, number] {
  const position = new THREE.Vector3()
  node.getWorldPosition(position)
  position.multiplyScalar(1000)
  return [position.x, position.y, position.z]
}

function subtractVector(
  left: [number, number, number],
  right: [number, number, number],
): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function vectorLength(vector: [number, number, number]): number {
  return Math.hypot(...vector)
}

function vectorDot(left: [number, number, number], right: [number, number, number]): number {
  const leftLength = vectorLength(left)
  const rightLength = vectorLength(right)
  if (leftLength === 0 || rightLength === 0) return 0
  return (left[0] * right[0] + left[1] * right[1] + left[2] * right[2]) / (leftLength * rightLength)
}

function distanceToLineMm(
  point: [number, number, number],
  lineStart: [number, number, number],
  lineEnd: [number, number, number],
): number {
  const direction = new THREE.Vector3(...lineEnd).sub(new THREE.Vector3(...lineStart))
  if (direction.lengthSq() === 0)
    return new THREE.Vector3(...point).distanceTo(new THREE.Vector3(...lineStart))
  const relative = new THREE.Vector3(...point).sub(new THREE.Vector3(...lineStart))
  return relative.cross(direction).length() / direction.length()
}

async function sampleDisplayedPositions(
  page: Parameters<typeof test>[0]['page'],
  durationMs: number,
): Promise<[number, number, number][]> {
  const samples: [number, number, number][] = []
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    samples.push((await readDisplayedPose(page)).position)
    await page.waitForTimeout(35)
  }
  return samples
}

function signedAngleAroundAxis(
  from: [number, number, number],
  to: [number, number, number],
  axis: [number, number, number],
): number {
  const fromVector = new THREE.Vector3(...from).normalize()
  const toVector = new THREE.Vector3(...to).normalize()
  const axisVector = new THREE.Vector3(...axis).normalize()
  const cross = new THREE.Vector3().crossVectors(fromVector, toVector)
  return (Math.atan2(axisVector.dot(cross), fromVector.dot(toVector)) * 180) / Math.PI
}

function frameAxisZ(frameRotation: number[][]): [number, number, number] {
  return [frameRotation[0][2], frameRotation[1][2], frameRotation[2][2]]
}

test.describe('ABB IRB 1200-5/0.9 教学场景', () => {
  test('核心 ABB 基座法兰经唯一场景显示转换后与 FBX 机械法兰闭环', async ({}, testInfo) => {
    const bytes = fs.readFileSync('public/models/ABB_IRB1200_5_90.fbx')
    const model = new FBXLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )
    const prepared = prepareAbbModel(model)
    // 核心 FK 末端是 ABB 基座坐标的机械法兰；与 FBX 视觉位姿对照时，
    // 经唯一场景显示转换（ABB→Three.js）再组合 flange→joint7 视觉工具变换。
    const tool = findNode(prepared, ABB_TOOL_NODE_NAME)
    expect(tool).not.toBeNull()
    if (!tool) return

    applyAbbJointAngles(prepared, [0, 0, 0, 0, 0, 0])
    const calibration = extractAbbFbxCalibration(prepared)
    const base = findNode(prepared, 'dizuo')
    const baseBounds = new THREE.Box3().setFromObject(base ?? prepared)
    const baseHeightMm = (baseBounds.max.y - baseBounds.min.y) * 1000
    console.info(
      '[ABB-FBX-BASE-BOUNDS]',
      JSON.stringify({
        minMm: [baseBounds.min.x * 1000, baseBounds.min.y * 1000, baseBounds.min.z * 1000],
        maxMm: [baseBounds.max.x * 1000, baseBounds.max.y * 1000, baseBounds.max.z * 1000],
        heightMm: (baseBounds.max.y - baseBounds.min.y) * 1000,
      }),
    )
    console.info('[ABB-FBX-CALIBRATION]', JSON.stringify(calibration))
    await testInfo.attach('fbx-joint-calibration.json', {
      body: JSON.stringify(calibration, null, 2),
      contentType: 'application/json',
    })

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
      const actual = readVisualToolPose(tool)
      // 核心 DH 给出 ABB 基座法兰 frame：先经唯一场景显示转换映射到 Three.js，再组合
      // flange→FBX joint7 视觉工具变换；FBX 世界坐标还包含 dizuo 支架，因此对位置 Y 叠加 baseHeightMm。
      const expectedMatrix = abbBaseFrameToSceneFrame(forwardAbbKinematicsDegrees(joints)).multiply(
        ABB_FLANGE_TO_FBX_TOOL,
      )
      const expectedPose = extractPose(expectedMatrix)
      const expectedScenePosition: [number, number, number] = [
        expectedPose.position[0],
        expectedPose.position[1] + baseHeightMm,
        expectedPose.position[2],
      ]
      const positionDelta = actual.position.map(
        (value, index) => value - expectedScenePosition[index],
      ) as [number, number, number]
      const positionError = Math.hypot(...positionDelta)
      const orientationError = quaternionDistanceDegrees(
        actual.quaternion,
        rotationQuaternion(expectedMatrix.getRotation()),
      )
      return {
        joints,
        actual: actual.position,
        expected: expectedScenePosition,
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

    const maxPositionError = Math.max(
      ...measurements.map((measurement) => measurement.positionError),
    )
    const maxOrientationError = Math.max(
      ...measurements.map((measurement) => measurement.orientationError),
    )
    // ROS-Industrial 候选 DH 与 FBX 骨骼轴线存在约 10 mm 的建模偏差，但运动方向和姿态必须闭环。
    expect(maxPositionError, JSON.stringify(measurements, null, 2)).toBeLessThan(15)
    expect(maxOrientationError, JSON.stringify(measurements, null, 2)).toBeLessThan(0.5)
  })

  test('测量G2到G6单关节连杆与DH frame的实际差异', async ({}, testInfo) => {
    const bytes = fs.readFileSync('public/models/ABB_IRB1200_5_90.fbx')
    const model = new FBXLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )
    const prepared = prepareAbbModel(model)
    const base = findNode(prepared, 'dizuo')
    prepared.updateMatrixWorld(true)
    const baseBounds = new THREE.Box3().setFromObject(base ?? prepared)
    const baseHeightMm = (baseBounds.max.y - baseBounds.min.y) * 1000
    const nodeNames = [...ABB_ACTIVE_JOINT_NODE_NAMES, ABB_TOOL_NODE_NAME]
    const nodes = nodeNames.map((name) => findNode(prepared, name))
    expect(nodes.every((node) => node !== null)).toBe(true)
    if (nodes.some((node) => node === null)) return

    const zeroJoints: JointAngles = [0, 0, 0, 0, 0, 0]
    applyAbbJointAngles(prepared, zeroJoints)
    prepared.updateMatrixWorld(true)
    const zeroPositions = nodes.map((node) => readNodePosition(node as THREE.Object3D))
    // 核心 DH 输出 ABB 基座 frame，经唯一场景显示转换映射到 Three.js 后再与 FBX 场景轴比较。
    const zeroDhFrames = forwardAbbKinematicsFramesDegrees(zeroJoints).map(abbBaseFrameToSceneFrame)

    const measurements = ABB_ACTIVE_JOINT_NODE_NAMES.slice(1).map((jointName, index) => {
      const jointIndex = index + 1
      const nextNodeIndex = jointIndex <= 2 ? jointIndex + 1 : 6
      const movedJoints: JointAngles = [0, 0, 0, 0, 0, 0]
      movedJoints[jointIndex] = 10
      applyAbbJointAngles(prepared, movedJoints)
      prepared.updateMatrixWorld(true)
      const movedPositions = nodes.map((node) => readNodePosition(node as THREE.Object3D))

      const actualLinkAtZero = subtractVector(
        zeroPositions[nextNodeIndex],
        zeroPositions[jointIndex],
      )
      const actualLinkAtMoved = subtractVector(
        movedPositions[nextNodeIndex],
        movedPositions[jointIndex],
      )
      const dhZeroLink = subtractVector(
        zeroDhFrames[nextNodeIndex].getPosition(),
        zeroDhFrames[jointIndex].getPosition(),
      )
      const movedDhFrames =
        forwardAbbKinematicsFramesDegrees(movedJoints).map(abbBaseFrameToSceneFrame)
      const dhMovedLink = subtractVector(
        movedDhFrames[nextNodeIndex].getPosition(),
        movedDhFrames[jointIndex].getPosition(),
      )
      const fbxAxis = ABB_JOINT_AXES[jointName].toArray() as [number, number, number]
      const dhAxis = frameAxisZ(zeroDhFrames[jointIndex].getRotation())

      return {
        joint: jointName,
        angleDeg: 10,
        fbxAxis,
        dhAxis,
        axisDot: vectorDot(fbxAxis, dhAxis),
        fbxCenterZeroMm: zeroPositions[jointIndex],
        fbxNextCenterZeroMm: zeroPositions[nextNodeIndex],
        fbxCenterMovedMm: movedPositions[jointIndex],
        fbxNextCenterMovedMm: movedPositions[nextNodeIndex],
        dhCenterZeroMm: [
          zeroDhFrames[jointIndex].getPosition()[0],
          zeroDhFrames[jointIndex].getPosition()[1] + baseHeightMm,
          zeroDhFrames[jointIndex].getPosition()[2],
        ],
        dhNextCenterZeroMm: [
          zeroDhFrames[nextNodeIndex].getPosition()[0],
          zeroDhFrames[nextNodeIndex].getPosition()[1] + baseHeightMm,
          zeroDhFrames[nextNodeIndex].getPosition()[2],
        ],
        fbxLinkLengthMm: vectorLength(actualLinkAtZero),
        dhLinkLengthMm: vectorLength(dhZeroLink),
        linkDirectionDotAtZero: vectorDot(actualLinkAtZero, dhZeroLink),
        linkDirectionDotAtMoved: vectorDot(actualLinkAtMoved, dhMovedLink),
        actualSignedAroundFbxAxis: signedAngleAroundAxis(
          actualLinkAtZero,
          actualLinkAtMoved,
          fbxAxis,
        ),
        actualSignedAroundDhAxis: signedAngleAroundAxis(
          actualLinkAtZero,
          actualLinkAtMoved,
          dhAxis,
        ),
        dhSignedAroundDhAxis: signedAngleAroundAxis(dhZeroLink, dhMovedLink, dhAxis),
      }
    })

    console.info('[ABB-FBX-DH-LINK-MEASURE]', JSON.stringify(measurements))
    await testInfo.attach('fbx-dh-link-measurements.json', {
      body: JSON.stringify({ baseHeightMm, measurements }, null, 2),
      contentType: 'application/json',
    })
    expect(measurements.every((measurement) => Number.isFinite(measurement.axisDot))).toBe(true)
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
    expect(consoleMessages.some((message) => message.includes('[AbbScene] ABB FBX 加载完成'))).toBe(
      true,
    )
    expect(consoleMessages.some((message) => message.includes('底座=dizuo'))).toBe(true)
    expect(pageErrors).toEqual([])

    const j1 = page.getByRole('spinbutton', { name: 'J1 角度输入' })
    await openJogPanel(page)
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
    await expect(coordinateButton).toHaveAttribute('aria-pressed', 'false')
    await coordinateButton.click()
    await expect(coordinateButton).toHaveAttribute('aria-pressed', 'true')
    await coordinateButton.click()
    await expect(coordinateButton).toHaveAttribute('aria-pressed', 'false')

    const dhDebugButton = page.getByRole('button', { name: 'DH参考链' })
    await expect(dhDebugButton).toHaveAttribute('aria-pressed', 'false')
    await dhDebugButton.click()
    await expect(dhDebugButton).toHaveAttribute('aria-pressed', 'true')
    await dhDebugButton.click()
    await expect(dhDebugButton).toHaveAttribute('aria-pressed', 'false')

    const gridButton = page.getByRole('button', { name: '网格' })
    await gridButton.click()
    await expect(gridButton).toHaveAttribute('aria-pressed', 'true')
    await gridButton.click()
    await expect(gridButton).toHaveAttribute('aria-pressed', 'false')

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
    await openJogPanel(page)

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
      const positionDelta = actual.position.map(
        (value, index) => value - expected.position[index],
      ) as [number, number, number]
      const positionError = Math.hypot(...positionDelta)
      const expectedOrientation = expected.eulerZYX.map((value) => (value * 180) / Math.PI) as [
        number,
        number,
        number,
      ]
      const orientationDelta = actual.orientation.map(
        (value, index) => value - expectedOrientation[index],
      ) as [number, number, number]
      measurements.push({
        joints,
        actual,
        expected: { position: expected.position, orientation: expectedOrientation },
        positionDelta,
        orientationDelta,
        positionError,
      })
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
    const maxPositionError = Math.max(
      ...measurements.map((measurement) => measurement.positionError),
    )
    expect(maxPositionError, JSON.stringify(measurements, null, 2)).toBeLessThan(1)
  })

  test('World 单次位移与 Tool 长按均保持 TCP 直线轨迹', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('场景已就绪')).toBeVisible({ timeout: 15_000 })
    await openJogPanel(page)
    await setJoints(page, [15, -20, 30, 10, 25, -15])
    await page.getByRole('tab', { name: '笛卡尔' }).click()

    // 世界系单次位移：选 10 mm 位置步进，点按一次 X 增加（<180ms 点按=单步，FlexPendant 增量式语义）。
    await page.getByRole('button', { name: '10 mm', exact: true }).click()
    const worldStart = (await readDisplayedPose(page)).position
    const worldX = page.getByRole('button', { name: 'X 增加', exact: true })
    await worldX.dispatchEvent('pointerdown')
    await worldX.dispatchEvent('pointerup')
    const worldSamples = [worldStart, ...(await sampleDisplayedPositions(page, 900))]
    const worldTarget: [number, number, number] = [worldStart[0] + 10, worldStart[1], worldStart[2]]
    const worldMaxDeviation = Math.max(
      ...worldSamples.map((point) => distanceToLineMm(point, worldStart, worldTarget)),
    )
    expect(worldMaxDeviation).toBeLessThan(0.6)
    expect(
      vectorLength(subtractVector(worldSamples.at(-1) ?? worldStart, worldTarget)),
    ).toBeLessThan(0.4)

    await page.getByRole('button', { name: 'Tool' }).click()
    await page.getByRole('button', { name: '1 mm', exact: true }).click()
    const toolStart = (await readDisplayedPose(page)).position
    const increaseX = page.getByRole('button', { name: 'X 增加', exact: true })
    await increaseX.dispatchEvent('pointerdown')
    const toolSamples = [toolStart, ...(await sampleDisplayedPositions(page, 750))]
    await increaseX.dispatchEvent('pointerup')
    toolSamples.push(...(await sampleDisplayedPositions(page, 220)))
    const toolEnd = toolSamples.at(-1) ?? toolStart
    const toolMaxDeviation = Math.max(
      ...toolSamples.map((point) => distanceToLineMm(point, toolStart, toolEnd)),
    )
    expect(vectorLength(subtractVector(toolEnd, toolStart))).toBeGreaterThan(2)
    expect(toolMaxDeviation).toBeLessThan(0.8)
  })
})
