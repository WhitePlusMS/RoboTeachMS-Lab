<script setup lang="ts">
import { ArrowRight, Check } from '@lucide/vue'

const emit = defineEmits<{
  start: []
}>()

const baseUrl = import.meta.env.BASE_URL
const assetPath = (name: string): string => baseUrl + name

const features = [
  {
    icon: '🦾',
    image: assetPath('images/hero-robot.png'),
    title: '机械臂结构与运动控制',
    description:
      '在三维场景中认识 J1～J6 六个关节，理解关节角度与末端位姿之间的关系，通过关节示教和笛卡尔 Jog 建立运动直觉。',
    items: ['六个关节独立调节', '正逆运动学实时反馈', '回零、随机姿态与末端位姿显示'],
  },
  {
    icon: '⌘',
    image: assetPath('images/hero-preview.png'),
    title: 'RAPID 程序示教与执行',
    description:
      '像使用示教器一样编辑 RAPID 教学子集，观察程序解析、点位数据、程序指针和运动指针如何共同驱动机器人。',
    items: [
      'MoveJ / MoveL / MoveC 运动指令',
      '语法、数据与运动诊断',
      '运行、单步、停止与 PP to Main',
    ],
  },
  {
    icon: '◎',
    image: assetPath('images/hero-grasp.png'),
    title: '点位示教与末端操作',
    description:
      '使用平移或旋转操作轴直接调整末端目标，记录当前姿态为 robtarget，并在三维场景中查看命名点位与运动轨迹。',
    items: ['World / Tool 坐标系控制', '末端平移与旋转拖拽', 'robtarget 记录、修改与高亮'],
  },
]

const steps = [
  { number: 1, title: '观察结构', description: '在三维场景中认识机器人基座、六个关节和末端法兰。' },
  {
    number: 2,
    title: '动手控制',
    description: '使用关节面板、笛卡尔 Jog 或末端操作轴调整机器人姿态。',
  },
  {
    number: 3,
    title: '编写程序',
    description: '编辑 RAPID 指令、创建 robtarget，并通过诊断修正程序问题。',
  },
  {
    number: 4,
    title: '验证运动',
    description: '运行或单步执行程序，观察轨迹、PP/MP 和运行日志的变化。',
  },
]
</script>

<template>
  <div class="landing-page">
    <section class="landing-hero">
      <div class="hero-grid" aria-hidden="true"></div>
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="hero-fade" aria-hidden="true"></div>
      <img
        class="hero-outline"
        :src="assetPath('images/hero-outline.png')"
        alt=""
        aria-hidden="true"
      />

      <div class="landing-topbar">
        <div class="landing-topbar-inner">
          <div class="brand-lockup">
            <img
              class="brand-logo"
              :src="assetPath('brand/roboteachms-logo.png')"
              alt=""
              aria-hidden="true"
            />
            <div class="brand-copy">
              <span>工业机器人示教编程实验室</span>
              <small>RoboTeachMS Lab</small>
            </div>
          </div>
          <div class="landing-actions">
            <a
              class="github-link"
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg class="github-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path
                  d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.79-.26.79-.58v-2.23c-3.34.73-4.03-1.42-4.03-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.4s2.05.13 3.01.4c2.29-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.19.69.8.58A12.01 12.01 0 0 0 24 12c0-6.63-5.37-12-12-12Z"
                />
              </svg>
              GitHub
            </a>
            <button class="start-button" type="button" @click="emit('start')">
              开始实验
              <ArrowRight :size="16" />
            </button>
          </div>
        </div>
      </div>

      <div class="hero-content page-width">
        <h1>
          在 3D 场景中
          <br />
          <span>理解工业机器人示教编程</span>
        </h1>
        <p class="hero-subtitle">交互式工业机器人学习与仿真工作台</p>
        <p class="hero-description">
          通过观察、控制、编程、验证四个步骤，把关节运动学、坐标系、点位示教和 RAPID
          程序执行变成直观的学习体验。
        </p>
        <div class="metrics-grid">
          <div class="metric-card">
            <strong>6</strong>
            <span>活动关节</span>
            <p>从 J1 到 J6 逐轴观察工业机器人运动。</p>
          </div>
          <div class="metric-card">
            <strong>3D</strong>
            <span>实时场景</span>
            <p>模型、坐标、轨迹和命名点位同步呈现。</p>
          </div>
          <div class="metric-card">
            <strong>0</strong>
            <span>后端依赖</span>
            <p>打开浏览器即可开始本地教学实验。</p>
          </div>
        </div>
      </div>
    </section>

    <main>
      <section class="preview-section section-shell">
        <div class="section-heading">
          <span class="eyebrow">实验工作台</span>
          <h2>左侧三维场景，右侧示教与编程工具</h2>
          <p>
            RoboTeachMS Lab 将机器人运动、RAPID 源码、Program Data
            和运行日志放在同一个实验空间内，边学边做、即时验证。
          </p>
        </div>
        <div class="preview-frame">
          <img :src="assetPath('images/hero-preview.png')" alt="工业机器人示教工作台预览" />
        </div>
      </section>

      <section class="features-section">
        <div class="section-shell">
          <div class="section-heading">
            <span class="eyebrow">三大学习模块</span>
            <h2>从机器人结构到完整程序运动闭环</h2>
          </div>

          <div
            v-for="(feature, index) in features"
            :key="feature.title"
            class="feature-row"
            :class="{ reverse: index % 2 === 1 }"
          >
            <div class="feature-image">
              <img :src="feature.image" :alt="feature.title" />
            </div>
            <div class="feature-copy">
              <div class="feature-icon" aria-hidden="true">{{ feature.icon }}</div>
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.description }}</p>
              <ul>
                <li v-for="item in feature.items" :key="item">
                  <span class="check-icon" aria-hidden="true"><Check :size="12" /></span>
                  {{ item }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section class="steps-section section-shell">
        <div class="section-heading">
          <span class="eyebrow">学习流程</span>
          <h2>四步进入工业机器人学习</h2>
        </div>
        <div class="steps-grid">
          <div class="steps-line" aria-hidden="true"></div>
          <div v-for="step in steps" :key="step.number" class="step-card">
            <div class="step-number">{{ step.number }}</div>
            <h3>{{ step.title }}</h3>
            <p>{{ step.description }}</p>
          </div>
        </div>
      </section>
    </main>

    <footer class="landing-footer">
      <div class="footer-inner section-shell">
        <span>RoboTeachMS Lab · 工业机器人示教编程实验室</span>
        <span>© 2026</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing-page {
  height: 100%;
  min-height: 100%;
  overflow: hidden auto;
  color: #0f172a;
  background: #fff;
}

.page-width,
.section-shell {
  width: min(1152px, calc(100% - 48px));
  margin: 0 auto;
}

.landing-hero {
  position: relative;
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
  background: linear-gradient(135deg, #091120 0%, #102742 54%, #163a5d 100%);
}

.hero-grid,
.hero-glow,
.hero-fade {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.hero-grid {
  background-image:
    linear-gradient(rgb(255 255 255 / 2.8%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / 2.8%) 1px, transparent 1px);
  background-size: 56px 56px;
}

.hero-glow {
  background:
    radial-gradient(circle at top left, rgb(56 189 248 / 16%), transparent 38%),
    radial-gradient(circle at 85% 22%, rgb(59 130 246 / 18%), transparent 34%),
    radial-gradient(circle at 50% 100%, rgb(20 184 166 / 12%), transparent 28%);
}

.hero-fade {
  top: auto;
  height: 112px;
  background: linear-gradient(to bottom, transparent, rgb(2 6 23 / 24%));
}

.hero-outline {
  position: absolute;
  right: 10vw;
  bottom: 15vh;
  z-index: 1;
  width: auto;
  max-width: 56vw;
  height: 60vh;
  max-height: 620px;
  user-select: none;
  opacity: 0.9;
  pointer-events: none;
  filter: drop-shadow(0 0 20px rgb(255 255 255 / 16%));
}

.landing-topbar {
  position: relative;
  z-index: 2;
  border-bottom: 1px solid rgb(255 255 255 / 10%);
}

.landing-topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: min(1152px, calc(100% - 48px));
  min-height: 72px;
  margin: 0 auto;
}

.brand-lockup,
.landing-actions,
.github-link,
.start-button {
  display: inline-flex;
  align-items: center;
}

.brand-lockup {
  gap: 11px;
}

.brand-logo {
  width: 34px;
  height: 34px;
  object-fit: contain;
  border-radius: 8px;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.brand-copy small {
  color: rgb(255 255 255 / 40%);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.landing-actions {
  gap: 12px;
}

.github-link,
.start-button {
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: 0.2s ease;
}

.github-link {
  color: rgb(255 255 255 / 70%);
  border: 1px solid rgb(255 255 255 / 15%);
  background: rgb(255 255 255 / 5%);
}

.github-icon {
  width: 15px;
  height: 15px;
}

.github-link:hover {
  color: #fff;
  background: rgb(255 255 255 / 10%);
}

.start-button {
  color: #0f172a;
  border: 0;
  background: #fff;
  box-shadow: 0 12px 28px rgb(255 255 255 / 10%);
  cursor: pointer;
}

.start-button:hover {
  background: #e0f2fe;
  transform: translateY(-1px);
}

.hero-content {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  padding-top: 64px;
  padding-bottom: 64px;
}

.hero-content h1 {
  max-width: 760px;
  font-size: clamp(42px, 5vw, 68px);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.hero-content h1 span {
  color: transparent;
  background: linear-gradient(90deg, #bae6fd, #a5f3fc 45%, #bfdbfe);
  background-clip: text;
}

.hero-subtitle {
  margin-top: 18px;
  color: rgb(255 255 255 / 80%);
  font-size: clamp(20px, 2vw, 28px);
  font-weight: 500;
}

.hero-description {
  max-width: 610px;
  margin-top: 20px;
  color: rgb(255 255 255 / 60%);
  font-size: 17px;
  line-height: 1.75;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  max-width: 760px;
  margin-top: 56px;
}

.metric-card {
  padding: 20px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 16px;
  background: rgb(255 255 255 / 5%);
  box-shadow: 0 20px 40px rgb(2 6 23 / 18%);
  backdrop-filter: blur(8px);
}

.metric-card strong {
  display: block;
  color: #bae6fd;
  font-size: 38px;
  font-weight: 800;
  line-height: 1;
}

.metric-card span {
  display: block;
  margin-top: 10px;
  color: rgb(255 255 255 / 50%);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.metric-card p {
  margin-top: 10px;
  color: rgb(255 255 255 / 60%);
  font-size: 13px;
  line-height: 1.6;
}

.preview-section,
.steps-section {
  padding-top: 80px;
  padding-bottom: 80px;
}

.section-heading {
  margin-bottom: 34px;
}

.eyebrow {
  display: block;
  margin-bottom: 9px;
  color: #2563eb;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.section-heading h2 {
  color: #0f172a;
  font-size: clamp(28px, 3vw, 38px);
  font-weight: 800;
  letter-spacing: -0.035em;
}

.section-heading p {
  max-width: 680px;
  margin-top: 10px;
  color: #64748b;
  line-height: 1.7;
}

.preview-frame,
.feature-image {
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #0f172a;
  box-shadow: 0 24px 50px rgb(15 23 42 / 13%);
}

.preview-frame img,
.feature-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-frame {
  aspect-ratio: 16 / 8.8;
}

.features-section {
  padding-top: 80px;
  padding-bottom: 80px;
  background: #f8fafc;
}

.feature-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 64px;
  margin-top: 52px;
}

.feature-row.reverse .feature-image {
  order: 2;
}

.feature-row.reverse .feature-copy {
  order: 1;
}

.feature-image {
  aspect-ratio: 16 / 10;
  background: #fff;
}

.feature-copy h3 {
  margin-top: 8px;
  color: #0f172a;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.feature-copy > p {
  margin-top: 14px;
  color: #64748b;
  line-height: 1.75;
}

.feature-icon {
  color: #2563eb;
  font-size: 28px;
  line-height: 1;
}

.feature-copy ul {
  display: flex;
  flex-direction: column;
  gap: 11px;
  margin: 22px 0 0;
  padding: 0;
  list-style: none;
}

.feature-copy li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: #1e293b;
  font-size: 14px;
}

.check-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-top: -1px;
  border-radius: 50%;
  color: #2563eb;
  background: #dbeafe;
}

.steps-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 32px;
}

.steps-line {
  position: absolute;
  top: 20px;
  right: 12%;
  left: 12%;
  height: 2px;
  background: linear-gradient(90deg, #3b82f6, #06b6d4, #f59e0b);
  opacity: 0.25;
}

.step-card {
  position: relative;
  z-index: 1;
  text-align: center;
}

.step-number {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin: 0 auto 16px;
  border: 2px solid #cbd5e1;
  border-radius: 50%;
  color: #2563eb;
  background: #fff;
  font-weight: 800;
}

.step-card h3 {
  color: #0f172a;
  font-size: 16px;
  font-weight: 700;
}

.step-card p {
  margin-top: 6px;
  color: #64748b;
  font-size: 14px;
  line-height: 1.65;
}

.landing-footer {
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

.footer-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 24px;
  padding-bottom: 24px;
  color: #94a3b8;
  font-size: 12px;
}

@media (max-width: 900px) {
  .hero-outline {
    right: -2vw;
    max-width: 62vw;
    opacity: 0.45;
  }

  .feature-row {
    gap: 32px;
  }
}

@media (max-width: 680px) {
  .page-width,
  .section-shell,
  .landing-topbar-inner {
    width: min(100% - 32px, 560px);
  }

  .landing-topbar-inner {
    min-height: 64px;
  }

  .brand-copy small,
  .github-link {
    display: none;
  }

  .hero-outline {
    right: -20vw;
    bottom: 8vh;
    max-width: 88vw;
    height: 48vh;
    opacity: 0.34;
  }

  .hero-content {
    padding-top: 48px;
    padding-bottom: 48px;
  }

  .hero-content h1 {
    font-size: clamp(38px, 12vw, 56px);
  }

  .hero-description {
    font-size: 15px;
  }

  .metrics-grid,
  .feature-row,
  .steps-grid {
    grid-template-columns: 1fr;
  }

  .metrics-grid {
    max-width: 360px;
    margin-top: 36px;
  }

  .feature-row.reverse .feature-image,
  .feature-row.reverse .feature-copy {
    order: initial;
  }

  .feature-row {
    gap: 24px;
    margin-top: 40px;
  }

  .steps-line {
    inset: 0 auto 0 20px;
    width: 2px;
    height: auto;
  }

  .step-card {
    display: grid;
    grid-template-columns: 40px 1fr;
    column-gap: 16px;
    text-align: left;
  }

  .step-number {
    grid-row: span 2;
    margin: 0;
  }

  .step-card p {
    margin-top: 4px;
  }
}
</style>
