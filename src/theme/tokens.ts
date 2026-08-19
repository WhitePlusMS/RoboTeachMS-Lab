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

  // 字号阶梯（紧凑工业 UI；组件一律引用阶梯，不写 px 字面量）
  '--text-xs': string
  '--text-sm': string
  '--text-md': string
  '--text-lg': string
  '--text-xl': string
  '--text-2xl': string
  '--text-3xl': string

  // 层级阶梯（z-index 只取这几个档，避免层级战争）
  '--z-raised': string
  '--z-overlay': string
  '--z-sticky': string
  '--z-popover': string
  '--z-modal': string
  '--z-toast': string

  // 根页面背景与默认文本
  '--color-bg': string
  '--color-text-base': string

  // 表面（亮色，三级明度）
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

  // 品牌（ABB 红）
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

  // 浮层 / 遮罩 / 阴影（标高）
  '--color-scrim': string
  '--color-overlay-bg': string
  '--color-overlay-bg-strong': string
  '--shadow-pop': string
  '--shadow-overlay': string
  '--shadow-modal': string
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

  // 字号阶梯
  '--text-xs': '10px',
  '--text-sm': '11px',
  '--text-md': '12px',
  '--text-lg': '13px',
  '--text-xl': '14px',
  '--text-2xl': '16px',
  '--text-3xl': '18px',

  // 层级阶梯
  '--z-raised': '2', // 场景内浮层（辅助工具条等）
  '--z-overlay': '3', // 场景级覆盖（WebGL fallback）
  '--z-sticky': '20', // 吸顶 / 下拉菜单
  '--z-popover': '40', // 面板内弹层
  '--z-modal': '900', // 模态对话框
  '--z-toast': '1000', // toast / 确认框（最顶层）

  // 根页面背景与默认文本
  '--color-bg': '#eef0f4',
  '--color-text-base': '#2b2f38',

  // 表面（亮色，三级明度）
  '--color-surface': '#ffffff', // inputs, base surfaces
  '--color-surface-deep': '#f1f3f6', // panels, tab strips
  '--color-surface-raised': '#ffffff', // items, details, stats
  '--color-surface-hover': '#e9edf2',
  '--color-editor': '#f5f6f8', // code editors (inset)

  // 边框
  '--color-border': '#dfe3e9', // default borders
  '--color-border-strong': '#c7cdd6', // stronger borders
  '--color-border-soft': '#d3d8e0', // input / button borders
  '--color-border-special': '#d3d8e0',
  '--color-border-kind': '#d3d8e0',

  // 文本
  '--color-text-strong': '#171a20',
  '--color-text': '#2b2f38',
  '--color-text-muted': '#4d5462',
  '--color-text-faint': '#6e7683',
  '--color-text-dim': '#9aa2ae',
  '--color-text-dim-deep': '#b7bec8',
  '--color-on-brand': '#ffffff', // 白字置于品牌红填充上
  '--color-on-fill': '#ffffff', // 白字置于彩色填充上（危险/错误/强调色）

  // 品牌（ABB 红 #FF000F）
  '--color-brand': '#ff000f',
  '--color-brand-strong': '#cf000c', // 亮底下 hover 加深
  '--color-brand-soft': '#c2000c', // 亮底文本用深红（保证对比度）
  '--color-brand-dim': 'rgba(255, 0, 15, 0.08)',

  // 强调
  '--color-accent': '#2563eb', // 位姿读数强调填充
  '--color-accent-orange': '#ff6a1a', // tool coordinate
  '--color-info': '#1f6fd6',

  // 状态（亮底整体加深，保证文本对比度）
  '--color-success': '#16a34a',
  '--color-success-soft': '#15803d',
  '--color-warning': '#d97706',
  '--color-warning-strong': '#b45309', // dot
  '--color-warning-soft': '#b45309',
  '--color-danger': '#dc2626',
  '--color-danger-strong': '#dc2626',
  '--color-danger-soft': '#b91c1c',
  '--color-danger-faint': '#b91c1c',
  '--color-error-bg': '#dc2626',
  '--color-error-edge': '#991b1b',
  '--color-orange': '#f97316', // MP line
  '--color-orange-soft': '#c2410c',
  '--color-pp': '#f5c542', // PP line（配深字）
  '--color-primary-hover-bg': 'rgba(255, 0, 15, 0.07)',
  '--color-danger-hover-bg': 'rgba(220, 38, 38, 0.08)',

  // 浮层 / 遮罩 / 阴影（标高；状态色 alpha 变体不预设，组件用
  // color-mix(in srgb, var(--color-*) N%, transparent) 从基础 token 派生）
  '--color-scrim': 'rgba(15, 23, 42, 0.45)', // 模态遮罩
  '--color-overlay-bg': 'rgba(255, 255, 255, 0.88)', // 3D 场景上的浮层底
  '--color-overlay-bg-strong': 'rgba(255, 255, 255, 0.94)',
  '--shadow-pop': '0 8px 24px rgba(15, 23, 42, 0.18)', // 菜单 / 角标小浮层
  '--shadow-overlay': '0 10px 28px rgba(15, 23, 42, 0.16)', // toast / 局部弹层
  '--shadow-modal': '0 20px 60px rgba(15, 23, 42, 0.22)', // 模态对话框
}

export const TOKEN_NAMES = Object.keys(tokens) as Array<keyof DesignTokens>
