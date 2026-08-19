/**
 * 3D 场景主题 —— Three.js 侧颜色的「单一数据源」。
 *
 * sceneEnvironment：ABB / KUKA 两厂商共用的中性环境色（背景、工作台、网格、
 * 灯光、坐标轴、轨迹线）。由 scene-factory.ts 与 scene-helpers.ts 消费。
 * abbScene：ABB 厂商专属色（回退几何、robtarget 标记、DH 参考链、标签画布）。
 * 由 abb-scene.ts 与 abb-dh-debug-chain.ts 消费。
 *
 * 视图层 CSS 需要感知的场景色（如 --color-scene-bg）亦从本模块派生注入，
 * 保证 WebGL 背景与页面 CSS 背景严格一致，消除「同一块背景多处各写各的」。
 */
export const sceneEnvironment = {
  /** 场景背景：WebGL scene.background 与页面 --color-scene-bg 的唯一来源。 */
  background: '#101827',
  /** 工作台台面（顶部材质）。 */
  workbenchTop: '#d5d9df',
  /** 工作台框架。 */
  workbenchFrame: '#667085',
  /** 地面网格主线。 */
  gridColor: '#64748b',
  /** 地面网格副线。 */
  gridColorLine: '#334155',
  /** 半球光天空色。 */
  hemisphereSky: '#f6f8fb',
  /** 半球光地面色。 */
  hemisphereGround: '#4b5563',
  /** 主光（白）。 */
  keyLight: '#ffffff',
  /** 补光。 */
  fillLight: '#9ab9e8',
  /** TCP 轨迹线。 */
  trajectory: '#f97316',
  /** 世界坐标轴 X（红）。 */
  axisX: '#ff0000',
  /** 世界坐标轴 Y（绿）。 */
  axisY: '#00ff00',
  /** 世界坐标轴 Z（蓝）。 */
  axisZ: '#0000ff',
  /** 坐标轴原点。 */
  axisOrigin: '#ffff00',
} as const

export type SceneEnvironmentColors = typeof sceneEnvironment

/**
 * ABB 厂商专属 3D 色。KUKA 保留独立配色，不做合并（预留多厂商扩展）。
 */
export const abbScene = {
  /** 回退几何——机械臂深色基材。 */
  fallbackDark: '#343b48',
  /** 回退几何——黄色连杆。 */
  fallbackYellow: '#f59e0b',
  /** robtarget 点位小球（ABB 品牌橙）及其自发光。 */
  robTarget: '#ff6a1a',
  /** robtarget 名称标签底色。 */
  labelBackground: 'rgba(14, 16, 19, 0.82)',
  /** robtarget 名称标签描边。 */
  labelBorder: '#333a44',
  /** robtarget 名称标签文字。 */
  labelText: '#e8eaee',
  /** DH 参考链连接线。 */
  dhLink: '#ff4d4f',
  /** DH 各关节原点标记色（J1..FLANGE）。 */
  dhFrameColors: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de'],
} as const

export type AbbSceneColors = typeof abbScene

/** 注入到 CSS 变量、由页面视图层消费的场景色（与 WebGL 同源）。 */
export const sceneCssTokens = {
  '--color-scene-bg': sceneEnvironment.background,
} as const
