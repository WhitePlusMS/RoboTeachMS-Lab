import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { applyTheme } from '@/theme/index.ts'

// 根因升级：主题值唯一来源是 theme/tokens 与 theme/scene，启动时注入 CSS 变量。
// style.css 的 :root 不再声明具体值，故必须先注入再挂载，避免无主题闪烁。
applyTheme()

createApp(App).mount('#app')
