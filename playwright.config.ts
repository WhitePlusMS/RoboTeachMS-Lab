import { defineConfig } from '@playwright/test'

const chromePath = process.env.PLAYWRIGHT_CHROME_PATH
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

export default defineConfig({
  testDir: './e2e',
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    headless: true,
    launchOptions: {
      executablePath: chromePath,
      args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
