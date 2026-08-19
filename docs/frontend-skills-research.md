# 前端 Agent SKILL 调研（2025-12 联网检索）

> 调研目标：大范围联网检索当前可用的"做前端"的 Agent Skill（SKILL.md），主要来源为 GitHub 及各类收集目录。
> 检索引擎：bing（free-search）。核心一手资料：各仓库 `README.md` / `SKILL.md`。

---

## 一、核心结论

前端相关的 Agent Skill 已形成完整生态，绝大多数以 `SKILL.md` 格式发布，
可通过官方 CLI（Vercel `skills` / `npx skills add <owner/repo> --skill <name>`）一键安装，
面向 Claude Code、Cursor、Codex、Gemini CLI 等 38+ 个 agent（见 [agentskills.io](http://agentskills.io)）。

几个最重要的集合入口：
- [finfin/awesome-frontend-skills](https://github.com/finfin/awesome-frontend-skills) —— **专门收录前端 Skill 的精选目录（分类最全，本文档核心来源）**
- [anthropics/skills](https://github.com/anthropics/skills) —— Anthropic 官方示例
- [anthropics/claude-code](https://github.com/anthropics/claude-code) —— 内含官方 `frontend-design` 插件
- [ranbot-ai/awesome-skills](https://github.com/ranbot-ai/awesome-skills) —— 300+ 技能的跨来源汇总站
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) —— 25k+ star 社区合集

---

## 二、按框架分类的前端 Skill

### 通用前端
| Skill | 仓库 | 说明 |
|---|---|---|
| `frontend-ui-engineering` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | 组件架构、设计系统、状态管理、响应式、WCAG 2.1 AA 无障碍 |

### React
| Skill | 仓库 | 说明 |
|---|---|---|
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) 🔺官方 | 62 条规则 / 8 类：waterfall、bundle、SSR、re-render 等 |
| `react-doctor` | [millionco/react-doctor](https://github.com/millionco/react-doctor) | 扫描安全/性能/正确性/架构，输出 0–100 分 |
| `react-state-management` | [wshobson/agents](https://github.com/wshobson/agents) | Zustand/Redux Toolkit/Jotai/React Query/URL State 决策 |
| `react-dev` | [softaworks/agent-toolkit](https://github.com/softaworks/agent-toolkit) | React 19 + TS 类型安全指南 |

### Angular（官方 analogjs）
[analogjs/angular-skills](https://github.com/analogjs/angular-skills)：`angular-component` / `angular-signals` / `angular-forms` / `angular-routing` / `angular-http` / `angular-di`（面向 Angular v20+ standalone + signals）

### Vue ⭐（与本项目 Vue3 相关）
| Skill | 仓库 | 说明 |
|---|---|---|
| `vue` | [antfu/skills](https://github.com/antfu/skills) | Anthony Fu 维护的 Vue 开发技能 |
| `vue-best-practices` | [hyf0/vue-skills](https://github.com/hyf0/vue-skills) | Vue 开发最佳实践 |
| `vue-debug-guides` | [hyf0/vue-skills](https://github.com/hyf0/vue-skills) | Vue 调试指南 |
| `vueuse-functions` | [antfu/skills](https://github.com/antfu/skills) | VueUse composable 最佳实践 |
| `vue-pinia-best-practices` | [vuejs-ai/skills](https://github.com/vuejs-ai/skills) | Pinia 状态管理最佳实践 |
| `create-adaptable-composable` | [vuejs-ai/skills](https://github.com/vuejs-ai/skills) | 可复用 composable 设计模式 |

> 注：Vue 尚无官方 SKILL.md，但社区（antfu、hyf0、vuejs-ai）已有高质量技能。

### Next.js / Nuxt / Svelte / TanStack / Remix
- Next.js：`next-best-practices`（[vercel-labs/next-skills](https://github.com/vercel-labs/next-skills) 官方）、`nextjs-app-router-patterns`（wshobson）
- Nuxt：`nuxt`（antfu/skills）、`nuxt-ui`（[nuxt/ui](https://github.com/nuxt/ui) 官方）、`reka-ui`（onmax）
- Svelte：`svelte-code-writer`（[sveltejs/ai-tools](https://github.com/sveltejs/ai-tools) 官方）、sveltekit-svelte5-tailwind
- TanStack：`tanstack-start-best-practices`、`tanstack-query-best-practices`
- Remix：`react-router-framework-mode`（[remix-run/agent-skills](https://github.com/remix-run/agent-skills) 官方）

---

## 三、UI 组件库 / 设计

| Skill | 仓库 | 说明 |
|---|---|---|
| `shadcn` | [shadcn/ui](https://ui.shadcn.com/docs/skills) 🔺官方 | 项目检测 + 严格组合规则，`npx shadcn@latest add skills` |
| `tailwind-design-system` | [wshobson/agents](https://github.com/wshobson/agents) | Tailwind v4 CSS-first 设计系统 |
| `shadcn-ui` | [giuseppe-trisciuoglio/developer-kit](https://github.com/giuseppe-trisciuoglio/developer-kit) | 完整 shadcn/ui 指南（Radix、Zod、charts） |
| `building-components` | [vercel/components.build](https://github.com/vercel/components.build) 🔺官方 | Vercel 组件构建指南 |
| **`frontend-design`（Anthropic 官方）** | [anthropics/claude-code 插件](https://github.com/anthropics/claude-code) | 官方最知名前端设计技能（UI 质量、风格），也见 [skill 页](https://claudeskills.info/skills/anthropics/skills/frontend-design/) |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 50+ 风格、161 配色、57 字体、99 UX 原则、25 图表 |
| `web-design-reviewer` | [github/awesome-copilot](https://github.com/github/awesome-copilot) | 网页设计审查与反馈 |
| `frontend-design`（增强版） | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | 增强版前端设计技能 + 反模式 |
| `ckw-design-skill` | [connerkward/ckw-design-skill](https://github.com/connerkward/ckw-design-skill) | 前端设计方向/设计系统/视觉哲学 |

---

## 四、动画（含 Three.js ⭐）

| Skill | 仓库 | 说明 |
|---|---|---|
| `threejs-animation` | [cloudai-x/threejs-skills](https://github.com/cloudai-x/threejs-skills) | Three.js 动画系统：AnimationClip/Mixer、骨骼动画、Morph、blending |
| `ui-animation` | [mblode/agent-skills](https://github.com/mblode/agent-skills) | 只用 transform/opacity、200–300ms、prefers-reduced-motion |
| `framer-motion-animator` | [patricio0312rev/skills](https://github.com/patricio0312rev/skills) | Framer Motion 完整指南 |

> ⭐ 本项目为 Vue3 + Three.js（ABB 机器人仿真），`threejs-animation` 与 Vue 相关技能很有参考价值。

---

## 五、测试 / 质量 / TypeScript

### 测试
`agent-browser`(vercel)、`chrome-devtools`(github/awesome-copilot)、`playwright-best-practices`([currents-dev](https://github.com/currents-dev/playwright-best-practices-skill) 官方)、`playwright-cli`([microsoft](https://github.com/microsoft/playwright-cli) 官方)、`webapp-testing`([anthropics/skills](https://github.com/anthropics/skills) 官方)、LambdaTest 多框架（Selenium/Playwright/Cypress/WebdriverIO/Puppeteer）

### 质量（适用于任何框架）
[addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) —— `web-quality`：基于 Lighthouse/CWV 的 150+ 审计规则，**支持 React、Vue、Angular、Svelte、Next、Nuxt、Astro**

### TypeScript
`typescript-clean-code`、`typescript-unit-testing`、`typescript-e2e-testing`（[bmad-labs/skills](https://github.com/bmad-labs/skills)）、`mastering-typescript`（[SpillwaveSolutions](https://github.com/SpillwaveSolutions/mastering-typescript-skill)，TS 5.9+）

### 构建工具
`vite`、`vitepress`（antfu/skills）、`monorepo-management`（wshobson）、Nx（nrwl 官方）、Turborepo（vercel 官方）

---

## 六、Web 标准 / 无障碍 / 安全方向

[schalkneethling](https://github.com/schalkneethling/webdev-agent-skills) 的前端技能（已迁移至 [claude-toolkit](https://github.com/schalkneethling/claude-toolkit)）：
- `css-coder` — 现代 CSS 语法、逻辑属性、响应式
- `css-tokens` — 设计系统 CSS 自定义属性 token
- `semantic-html` — 语义 HTML、原生元素优先于 ARIA
- `frontend-security` — 前端安全审计（XSS/CSRF/DOM/CSP，基于 OWASP）
- `frontend-testing` — Vitest/Playwright/视觉回归/无障碍测试
- `component-scaffolding` / `component-usage-analysis`

---

## 七、官方与汇总入口

**官方仓库（🔺）**
- [anthropics/skills](https://github.com/anthropics/skills)（52k+ star）
- [anthropics/claude-code](https://github.com/anthropics/claude-code)（含 frontend-design 插件）
- [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)、[vercel-labs/next-skills](https://github.com/vercel-labs/next-skills)
- 框架官方：analogjs/angular-skills、sveltejs/ai-tools、nuxt/ui、remix-run/agent-skills、prisma、supabase、expo 等

**汇总/管理工具**
- [skills.sh](https://skills.sh) —— Skill 目录与排行榜
- [vercel-labs/skills](https://github.com/vercel-labs/skills) —— 官方 CLI（`npx skills add`）
- [@tanstack/intent](https://tanstack.com/intent) —— npm 原生发布 skill
- [antfu/skills-npm](https://github.com/antfu/skills-npm) —— 从 node_modules 自动发现 SKILL.md
- [rohitg00/skillkit](https://github.com/rohitg00/skillkit) —— 跨 44+ agent 的管理器

---

## 八、安装命令速查

```bash
# 安装单个 skill
npx skills add <owner/repo> --skill <skill-name>
# 列出仓库内所有 skill
npx skills add <owner/repo> --list
# 装到指定 agent（claude-code / cursor / codex ...）
npx skills add <owner/repo> --skill <name> -a claude-code -a cursor
# 装到所有 agent
npx skills add <owner/repo> --all
```

---

## 九、对本项目（Vue3 + Three.js + ABB 仿真）的建议

1. **Vue**：可参考 `antfu/skills` 的 `vue`、`hyf0/vue-skills`、`vuejs-ai/skills`（Pinia、composable）。
2. **Three.js**：`cloudai-x/threejs-skills` 的 `threejs-animation` 直接对口。
3. **质量**：`addyosmani/web-quality-skills` 明确支持 Vue，适合做前端质量审计。
4. **前端设计**：Anthropic 官方 `frontend-design` 及增强版 `impeccable` 用于生成精致 UI。
5. 安装方式统一 `npx skills add`，或参照各仓库 README。

---

_数据来源：随机检索于 2025-12；核心一手来源为各 GitHub 仓库 README/SKILL.md。_
