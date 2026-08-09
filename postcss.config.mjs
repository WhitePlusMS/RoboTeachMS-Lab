/**
 * 显式声明独立应用不使用父项目的 PostCSS/Tailwind 配置。
 * 保留空插件配置，让构建工具在本目录内停止向上查找。
 */
export default {
  plugins: {},
}
