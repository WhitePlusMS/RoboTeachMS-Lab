/**
 * 设计 token —— 全系统 UI 配色 / 圆角 / 字体的「单一数据源」。
 *
 * 这是主题体系的根本性升级：`style.css` 的 `:root` 不再声明任何具体值，
 * 所有 CSS 变量值统一由本模块在启动时（theme/index.ts 的 applyTheme）注入。
 * 任何重复的 hex 一律回归此处；Three.js 3D 场景色经 ./scene.ts 复用同一数据源。
 * 修改颜色只需改这一处，页面与场景同步生效，不再有两份手写来源导致漂移。
 */
export interface DesignTokens {
  // 字体
  '--font-sans': string
  '--font-mono': string

  // 圆角
  '--radius-xs': string
  '--radius-sm': string
  '--radius-md': string
  '--radius-lg': string
  '--radius-pill': string

  // 根页面背景与默认文本
  '--color-bg': string
  '--color-text-base': string

  // 表面（石墨工业深色，三级明度）
  '--color-surface': string
  '--color-surface-deep': string
  '--color-surface-raised': string
  '--color-surface-hover': string
  '--color-editor': string

  // 边框
  '--color-border': string
  '--color-border-strong': string
  '--color-border-soft': string
  '--color-border-special': string
  '--color-border-kind': string

  // 文本
  '--color-text-strong': string
  '--color-text': string
  '--color-text-muted': string
  '--color-text-faint': string
  '--color-text-dim': string
  '--color-text-dim-deep': string
  '--color-on-brand': string
  '--color-on-fill': string

  // 品牌（ABB 橙）
  '--color-brand': string
  '--color-brand-strong': string
  '--color-brand-soft': string
  '--color-brand-dim': string

  // 强调
  '--color-accent': string
  '--color-accent-orange': string
  '--color-info': string

  // 状态
  '--color-success': string
  '--color-success-soft': string
  '--color-warning': string
  '--color-warning-strong': string
  '--color-warning-soft': string
  '--color-danger': string
  '--color-danger-strong': string
  '--color-danger-soft': string
  '--color-danger-faint': string
  '--color-error-bg': string
  '--color-error-edge': string
  '--color-orange': string
  '--color-orange-soft': string
  '--color-pp': string
  '--color-primary-hover-bg': string
  '--color-danger-hover-bg': string
}

export const tokens: DesignTokens = {
  // 字体
  '--font-sans':
    "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  '--font-mono': "ui-monospace, SFMono-Regular, Consolas, 'JetBrains Mono', monospace",

  // 圆角
  '--radius-xs': '4px',
  '--radius-sm': '6px',
  '--radius-md': '8px',
  '--radius-lg': '10px',
  '--radius-pill': '999px',

  // 根页面背景与默认文本
  '--color-bg': '#0c0d10',
  '--color-text-base': '#e8eaee',

  // 表面
  '--color-surface': '#1d2129', // inputs, base surfaces (dock-raised)
  '--color-surface-deep': '#14161b', // panels, tab strips (dock)
  '--color-surface-raised': '#1d2129', // items, details, stats
  '--color-surface-hover': '#272c36',
  '--color-editor': '#0e1013', // code editors (inset)

  // 边框
  '--color-border': '#262a32', // default borders
  '--color-border-strong': '#323842', // stronger borders
  '--color-border-soft': '#323842', // input / button borders
  '--color-border-special': '#323842',
  '--color-border-kind': '#323842',

  // 文本
  '--color-text-strong': '#f7f8fa',
  '--color-text': '#e8eaee',
  '--color-text-muted': '#c3c9d1',
  '--color-text-faint': '#9aa2ae',
  '--color-text-dim': '#646d79',
  '--color-text-dim-deep': '#4a525d',
  '--color-on-brand': '#1c0e04', // 深色文字置于品牌橙填充上
  '--color-on-fill': '#ffffff', // 白字置于彩色填充上（危险/错误/强调色）

  // 品牌（ABB 橙）
  '--color-brand': '#ff6a1a',
  '--color-brand-strong': '#ff7d38',
  '--color-brand-soft': '#ffb38a',
  '--color-brand-dim': 'rgba(255, 106, 26, 0.14)',

  // 强调
  '--color-accent': '#3b82f6', // 位姿读数强调填充
  '--color-accent-orange': '#ff6a1a', // tool coordinate
  '--color-info': '#4aa8ff',

  // 状态
  '--color-success': '#3ecf8e',
  '--color-success-soft': '#7fe0b4',
  '--color-warning': '#f5c542',
  '--color-warning-strong': '#f5c542', // dot
  '--color-warning-soft': '#f8d87a',
  '--color-danger': '#f26d6d',
  '--color-danger-strong': '#f26d6d',
  '--color-danger-soft': '#f59b9b',
  '--color-danger-faint': '#f59b9b',
  '--color-error-bg': '#7f1d1d',
  '--color-error-edge': '#f26d6d',
  '--color-orange': '#fb923c', // MP line
  '--color-orange-soft': '#ffb38a',
  '--color-pp': '#f5c542', // PP line
  '--color-primary-hover-bg': 'rgba(255, 106, 26, 0.16)',
  '--color-danger-hover-bg': 'rgba(242, 109, 109, 0.14)',
}

export const TOKEN_NAMES = Object.keys(tokens) as Array<keyof DesignTokens>
