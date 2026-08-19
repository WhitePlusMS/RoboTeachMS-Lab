/**
 * 主题聚合出口 + 运行时注入。
 *
 * 启动时把 tokens（UI）与 sceneCssTokens（3D 场景色）一并写入 :root CSS 变量，
 * 作为全部主题值的唯一来源。`style.css` 的 :root 不再声明具体值，
 * 本函数在 main.ts 挂载前同步执行，保证组件渲染时变量已就绪。
 */
import { tokens, type DesignTokens } from './tokens.ts'
import { sceneCssTokens } from './scene.ts'

type CssTokenMap = DesignTokens | typeof sceneCssTokens

/** 把主题变量写入文档根节点 CSS 变量。纯浏览器环境（本项目无 SSR）。 */
export function applyTheme(): void {
  const root = document.documentElement
  applyTokenMap(root, tokens as CssTokenMap)
  applyTokenMap(root, sceneCssTokens as CssTokenMap)
}

function applyTokenMap(root: HTMLElement, map: CssTokenMap): void {
  for (const [name, value] of Object.entries(map)) {
    root.style.setProperty(name, value)
  }
}

export { tokens } from './tokens.ts'
export { sceneEnvironment, abbScene, sceneCssTokens } from './scene.ts'
export type { DesignTokens } from './tokens.ts'
export type { SceneEnvironmentColors, AbbSceneColors } from './scene.ts'
