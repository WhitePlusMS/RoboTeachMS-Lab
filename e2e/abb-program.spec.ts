import { expect, test } from '@playwright/test'

async function waitForScene(page: Parameters<typeof test>[0]['page']): Promise<void> {
  await page.goto('/')
  await expect(page.getByText('场景已就绪')).toBeVisible({ timeout: 15_000 })
}

function programStats(page: Parameters<typeof test>[0]['page']) {
  return page.locator('[aria-label="程序快照"]')
}

/** 读取 CoordinateInfoPanel 显示的正解位置（毫米）。 */
async function readDisplayedPosition(
  page: Parameters<typeof test>[0]['page'],
): Promise<number[]> {
  const values = await page.locator('[aria-label="正解结果"] .pose-grid strong').allTextContents()
  return values.slice(0, 3).map(Number)
}

function positionsClose(left: number[], right: number[], tolerance = 0.5): boolean {
  return left.every((value, index) => Math.abs(value - right[index]) < tolerance)
}

test.describe('内置结构化 ABB 程序（搬运循环）', () => {
  test('完整运行后状态为已完成，程序指针等于程序长度', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('button', { name: '运行' }).click()

    const status = page.locator('.program-panel .control-status')
    await expect(status).toHaveText('已完成', { timeout: 30_000 })
    const stats = programStats(page)
    // 程序指针 = 7（七条指令全部完成），运动指针清空。
    await expect(stats.locator('dd').nth(0)).toHaveText('7')
    await expect(stats.locator('dd').nth(1)).toHaveText('—')
  })

  test('暂停冻结关节，继续后完成同一次运动', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('button', { name: '运行' }).click()

    const pauseButton = page.getByRole('button', { name: '暂停' })
    await expect(pauseButton).toBeEnabled({ timeout: 5_000 })
    await pauseButton.click()

    const status = page.locator('.program-panel .control-status')
    await expect(status).toHaveText('已暂停')
    const frozen = await readDisplayedPosition(page)
    // 暂停期间关节不再变化。
    await page.waitForTimeout(700)
    const afterPause = await readDisplayedPosition(page)
    expect(positionsClose(frozen, afterPause)).toBe(true)

    await page.getByRole('button', { name: '继续' }).click()
    await expect(status).toHaveText('已完成', { timeout: 20_000 })
  })

  test('停止后程序不推进到下一指令', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('button', { name: '运行' }).click()

    const stopButton = page.getByRole('button', { name: '停止' })
    await expect(stopButton).toBeEnabled({ timeout: 5_000 })
    const stoppedPose = await readDisplayedPosition(page)
    await stopButton.click()

    const status = page.locator('.program-panel .control-status')
    await expect(status).toHaveText('已停止', { timeout: 5_000 })
    const stats = programStats(page)
    // 停止在第一/二条指令期间：还没完成任何指令，程序指针保持 0，运动指针清空。
    await expect(stats.locator('dd').nth(0)).toHaveText('0')
    await expect(stats.locator('dd').nth(1)).toHaveText('—')

    // 停止后关节不再被程序推进（复位按钮会保持关节不变）。
    await page.getByRole('button', { name: '复位' }).click()
    await expect(status).toHaveText('空闲')
    const afterReset = await readDisplayedPosition(page)
    // reset 不移动机器人。
    expect(positionsClose(stoppedPose, afterReset)).toBe(true)
  })
})
