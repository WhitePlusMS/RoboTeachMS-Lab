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

test.describe('RAPID 文本 ABB 程序（MoveJ → MoveL → MoveJ）', () => {
  test('完整运行后状态为已完成，程序指针等于程序长度', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('button', { name: '运行' }).click()

    const status = page.locator('.program-panel .control-status')
    await expect(status).toHaveText('已完成', { timeout: 30_000 })
    const stats = programStats(page)
    // 程序指针 = 3（三条指令全部完成），运动指针清空。
    await expect(stats.locator('dd').nth(0)).toHaveText('3')
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
    // 先点击停止，再等待 UI 显示“已停止”，随后才读取位姿（避免动画帧竞态）。
    await stopButton.click()

    const status = page.locator('.program-panel .control-status')
    await expect(status).toHaveText('已停止', { timeout: 5_000 })
    const stats = programStats(page)
    // 停止时尚未完成任何指令：程序指针保持 0，运动指针清空。
    await expect(stats.locator('dd').nth(0)).toHaveText('0')
    await expect(stats.locator('dd').nth(1)).toHaveText('—')

    // 读取停止后的位姿，并等待一段时间验证它不再变化。
    const stoppedPose = await readDisplayedPosition(page)
    await page.waitForTimeout(700)
    const afterWait = await readDisplayedPosition(page)
    expect(positionsClose(stoppedPose, afterWait)).toBe(true)
  })

  test('RAPID 诊断存在时不启动运动', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('textbox', { name: 'RAPID 源程序' }).fill(`MODULE Broken
    PROC main()
        MoveJ missingPoint,v100,fine,tool0;
    ENDPROC
ENDMODULE`)
    await page.getByRole('button', { name: '运行' }).click()

    await expect(page.locator('.program-panel .control-status')).toHaveText('错误')
    await expect(page.locator('[aria-label="RAPID 诊断"]')).toContainText('undefined-symbol')
    await expect(programStats(page).locator('dd').nth(0)).toHaveText('0')
  })

  test('程序运行或暂停期间锁定 RAPID 源程序编辑器', async ({ page }) => {
    await waitForScene(page)
    const editor = page.getByRole('textbox', { name: 'RAPID 源程序' })
    await page.getByRole('button', { name: '运行' }).click()
    await expect(page.getByRole('button', { name: '暂停' })).toBeEnabled({ timeout: 5_000 })
    await expect(editor).toBeDisabled()

    await page.getByRole('button', { name: '停止' }).click()
    await expect(page.locator('.program-panel .control-status')).toHaveText('已停止', {
      timeout: 5_000,
    })
    await expect(editor).toBeEnabled()
  })
})
