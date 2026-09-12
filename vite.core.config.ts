import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/** 独立核心产物不含 Vue、Three、Worker 或场景资产，可直接在 Node 中调用验证。 */
export default defineConfig({
  publicDir: false,
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist-core',
    lib: {
      entry: 'src/robot-motion-core/index.ts',
      formats: ['es'],
      fileName: () => 'motion-core.js',
    },
    minify: false,
  },
})
