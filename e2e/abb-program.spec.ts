import { expect, test } from '@playwright/test'

async function waitForScene(page: Parameters<typeof test>[0]['page']): Promise<void> {
  await page.goto('/')
  await expect(page.getByText('场景已就绪')).toBeVisible({ timeout: 15_000 })
}

function programStats(page: Parameters<typeof test>[0]['page']) {
  return page.locator('[aria-label="程序快照"]')
}

function statusLabel(page: Parameters<typeof test>[0]['page']) {
  return page.locator('.program-panel .control-status')
}

/** 读取 CoordinateInfoPanel 显示的正解位置（毫米）。 */
async function readDisplayedPosition(page: Parameters<typeof test>[0]['page']): Promise<number[]> {
  const values = await page.locator('[aria-label="正解结果"] .pose-grid strong').allTextContents()
  return values.slice(0, 3).map(Number)
}

function positionsClose(left: number[], right: number[], tolerance = 0.5): boolean {
  return left.every((value, index) => Math.abs(value - right[index]) < tolerance)
}

test.describe('RAPID 文本 ABB 程序（运行/单步/停止/PP to Main）', () => {
  test('完整运行后状态为已完成，程序指针等于程序长度', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('button', { name: '运行' }).click()

    await expect(statusLabel(page)).toHaveText('已完成', { timeout: 30_000 })
    const stats = programStats(page)
    // 程序指针 = 3（三条指令全部完成），运动指针清空。
    await expect(stats.locator('dd').nth(0)).toHaveText('3')
    await expect(stats.locator('dd').nth(1)).toHaveText('—')
  })

  test('单步只执行一条并停在等待下一步，PP 推进', async ({ page }) => {
    await waitForScene(page)
    const stepButton = page.getByRole('button', { name: '单步' })
    await stepButton.click()

    // 首条 MoveJ 完成后停在 waiting-next。
    await expect(statusLabel(page)).toHaveText('已停止', { timeout: 30_000 })
    await expect(page.locator('.program-panel').getByText('等待下一步')).toBeVisible()
    await expect(programStats(page).locator('dd').nth(0)).toHaveText('1')
    await expect(programStats(page).locator('dd').nth(1)).toHaveText('—')
  })

  test('停止后程序不推进到下一指令', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('button', { name: '运行' }).click()

    const stopButton = page.getByRole('button', { name: '停止' })
    await expect(stopButton).toBeEnabled({ timeout: 5_000 })
    await stopButton.click()

    await expect(statusLabel(page)).toHaveText('已停止', { timeout: 5_000 })
    const stats = programStats(page)
    // 停止时尚未完成任何指令：程序指针保持 0，运动指针清空。
    await expect(stats.locator('dd').nth(0)).toHaveText('0')
    await expect(stats.locator('dd').nth(1)).toHaveText('—')

    // 停止后位姿不再变化。
    const stoppedPose = await readDisplayedPosition(page)
    await page.waitForTimeout(700)
    const afterWait = await readDisplayedPosition(page)
    expect(positionsClose(stoppedPose, afterWait)).toBe(true)
  })

  test('停止后继续运行从当前执行位置完成', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('button', { name: '运行' }).click()
    await page.getByRole('button', { name: '停止' }).click()
    await expect(statusLabel(page)).toHaveText('已停止', { timeout: 5_000 })

    // 从当前执行位置继续运行 → 完成全部。
    await page.getByRole('button', { name: '运行' }).click()
    await expect(statusLabel(page)).toHaveText('已完成', { timeout: 30_000 })
    await expect(programStats(page).locator('dd').nth(0)).toHaveText('3')
  })

  test('完成后 PP to Main 回到 main，可重新运行', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('button', { name: '运行' }).click()
    await expect(statusLabel(page)).toHaveText('已完成', { timeout: 30_000 })

    await page.getByRole('button', { name: 'PP to Main' }).click()
    await expect(statusLabel(page)).toHaveText('空闲')
    await expect(programStats(page).locator('dd').nth(0)).toHaveText('0')

    await page.getByRole('button', { name: '运行' }).click()
    await expect(statusLabel(page)).toHaveText('已完成', { timeout: 30_000 })
  })

  test('RAPID 诊断存在时不启动运动', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('textbox', { name: 'RAPID 源程序' }).fill(`MODULE Broken
    PROC main()
        MoveJ missingPoint,v100,fine,tool0;
    ENDPROC
ENDMODULE`)
    await expect(page.getByRole('button', { name: '运行' })).toBeDisabled()
    await expect(page.locator('[aria-label="RAPID 诊断"]')).toContainText('undefined-symbol')
    await expect(programStats(page).locator('dd').nth(0)).toHaveText('0')
  })

  test('运行期间锁定 RAPID 源程序编辑器，停止后可编辑', async ({ page }) => {
    await waitForScene(page)
    const editor = page.getByRole('textbox', { name: 'RAPID 源程序' })
    await page.getByRole('button', { name: '运行' }).click()
    await expect(page.getByRole('button', { name: '停止' })).toBeEnabled({ timeout: 5_000 })
    await expect(editor).toBeDisabled()

    await page.getByRole('button', { name: '停止' }).click()
    await expect(statusLabel(page)).toHaveText('已停止', { timeout: 5_000 })
    await expect(editor).toBeEnabled()
  })
})

test.describe('教学闭环：Program Data 示教与源码观察', () => {
  test('新建点位→插入 MoveJ→单步→连续运行→修改位置→再运行', async ({ page }) => {
    await waitForScene(page)

    await page.getByRole('tab', { name: 'Program Data' }).click()

    // 1) 用当前 TCP 新建命名点位。
    await page.getByLabel('新点位名称').fill('pTeach')
    await page.getByRole('button', { name: '新建点位' }).click()
    await expect(page.locator('.program-data-panel')).toContainText('pTeach')

    // 2) 为新建点位插入一条 MoveJ。
    await page.getByRole('button', { name: '选择点位 pTeach' }).click()
    await page.getByRole('button', { name: '插入 MoveJ' }).click()

    // 3) 单步执行首条运动，停在下一条等待。
    await page.getByRole('button', { name: '单步' }).click()
    await expect(statusLabel(page)).toHaveText('已停止', { timeout: 30_000 })
    await page.getByRole('tab', { name: 'RAPID' }).click()
    await expect(page.locator('.program-panel').getByText('等待下一步')).toBeVisible()
    await expect(page.locator('body')).toContainText('MoveJ')

    // 4) 连续运行到完成。
    await page.getByRole('button', { name: '运行' }).click()
    await expect(statusLabel(page)).toHaveText('已完成', { timeout: 40_000 })
    // 原 3 条 + 插入的 1 条 = 4 条指令全部完成。
    await expect(programStats(page).locator('dd').nth(0)).toHaveText('4')

    // 5) Modify Position（示教）更新已有点位，源码可继续执行。
    await page.getByRole('tab', { name: 'Program Data' }).click()
    await page.getByRole('button', { name: '选择点位 pWork' }).click()
    await page.getByRole('button', { name: 'Modify Position（更新位置）' }).click()
    await expect(page.locator('.program-data-panel')).not.toContainText('不能删除') // 无错误

    // 6) PP to Main 后重新运行。
    await page.getByRole('button', { name: 'PP to Main' }).click()
    await expect(statusLabel(page)).toHaveText('空闲')
    await page.getByRole('button', { name: '运行' }).click()
    await expect(statusLabel(page)).toHaveText('已完成', { timeout: 40_000 })
    await expect(programStats(page).locator('dd').nth(0)).toHaveText('4')
  })

  test('程序运行与结构化指令摘要联动，MP 随运动指令更新', async ({ page }) => {
    await waitForScene(page)
    await page.getByRole('button', { name: '运行' }).click()
    const summary = page.locator('[aria-label="当前结构化指令"]')
    // 运行期间摘要展示当前运动指令（含目标、速度、zone、tool）。
    await expect(summary).toContainText('fine', { timeout: 30_000 })
    await expect(summary).toContainText('tool0')
    await expect(summary).toContainText('v200')
  })

  test('基础逻辑任务可单步观察变量/条件/运动，逻辑修改要求 PP to Main', async ({ page }) => {
    await waitForScene(page)
    const editor = page.getByRole('textbox', { name: 'RAPID 源程序' })
    await editor.fill(`MODULE LogicDemo
    VAR num count := 0;
    VAR bool enabled := FALSE;
    CONST robtarget pIf := [[500,100,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pElseIf := [[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pElse := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        count := count + 1;
        enabled := count = 1;
        IF enabled THEN
            MoveJ pIf,v200,fine,tool0;
        ELSEIF count = 2 THEN
            MoveJ pElseIf,v200,fine,tool0;
        ELSE
            MoveL pElse,v50,fine,tool0;
        ENDIF
    ENDPROC
ENDMODULE`)

    const stepButton = page.getByRole('button', { name: '单步' })
    const dataTab = page.getByRole('tab', { name: 'Program Data' })
    await dataTab.click()
    await page.getByRole('tab', { name: 'num' }).click()
    await expect(page.locator('[aria-label="选择 num count"]')).toContainText('初值 0 · 当前 0')

    // 逐条跨过数值赋值、布尔赋值和条件判断；条件单步不应移动机器人，PP 落在命中 MoveJ。
    await stepButton.click()
    await expect(statusLabel(page)).toHaveText('已停止', { timeout: 10_000 })
    await expect(page.locator('[aria-label="选择 num count"]')).toContainText('初值 0 · 当前 1')
    // 新边栏语义下重复点击当前功能会收起面板：视图保持在 Program Data，直接切数据类型页签。
    await page.getByRole('tab', { name: 'bool' }).click()
    await stepButton.click()
    await expect(page.locator('[aria-label="选择 bool enabled"]')).toContainText(
      '初值 FALSE · 当前 TRUE',
    )
    await stepButton.click()
    await expect(programStats(page).locator('dd').nth(0)).toHaveText('3')
    await expect(programStats(page).locator('dd').nth(1)).toHaveText('—')
    await page.getByRole('tab', { name: 'RAPID' }).click()
    await expect(page.locator('.program-panel').getByText('等待下一步')).toBeVisible()

    // 命中 MoveJ 后完成整个教学任务。
    await stepButton.click()
    await expect(statusLabel(page)).toHaveText('已完成', { timeout: 30_000 })

    // 修改赋值表达式属于逻辑编辑：停止/完成上下文不能静默迁移，必须 PP to Main。
    const changedSource = (await editor.inputValue()).replace(
      'count := count + 1',
      'count := count + 2',
    )
    await editor.fill(changedSource)
    await expect(page.getByText('请先执行 PP to Main')).toBeVisible()
    await expect(page.getByRole('button', { name: '运行' })).toBeDisabled()
    await page.getByRole('button', { name: 'PP to Main' }).click()
    await expect(statusLabel(page)).toHaveText('空闲')
    await dataTab.click()
    await page.getByRole('tab', { name: 'num' }).click()
    await expect(page.locator('[aria-label="选择 num count"]')).toContainText('初值 0 · 当前 0')
  })
})
