<script setup lang="ts">
/**
 * 首页：先讲清楚「这个产品能帮你什么」，再让人选入口。
 *
 * 纯静态页：不引 composable、不发请求、不 import 另外两个页面。
 * 两个入口用同一份数据生成，卡片组件只负责展示，链接由页面包在外面。
 * 首屏速度优先：没有大图、没有动画库，只有排版和内联 SVG 图标。
 */

useHead({ title: '麦穗 · 代码理解助手' })

const ENTRIES = [
  {
    key: 'code',
    title: '复制代码',
    description: '理解一段代码的语法、关系、作用与技术背景。',
    tag: '单段代码理解',
    cta: '开始理解代码',
    icon: 'code' as const,
    to: '/code',
  },
  {
    key: 'project',
    title: '整个项目',
    description: '梳理项目文件、模块职责与文件之间的关系。',
    tag: '项目级理解',
    cta: '开始理解项目',
    icon: 'project' as const,
    to: '/project',
  },
]

const BENEFITS = [
  { icon: 'book' as const, label: '结构化解释' },
  { icon: 'graph' as const, label: '可视化关系' },
  { icon: 'shield' as const, label: '证据辅助核对' },
]

const FEATURES = [
  {
    title: '不只是简单总结',
    icon: 'code' as const,
    body: '从一行代码开始，慢慢分析它的语法、上下文和作用。',
  },
  {
    title: '遇到知识点，也能找到出处',
    icon: 'book' as const,
    body: '结合知识卡片和技术资料，帮助你理解代码背后的技术知识。',
  },
  {
    title: '不只看眼前这一段',
    icon: 'graph' as const,
    body: '分析整个项目的文件和模块，帮你理清它们之间的关系。',
  },
  {
    title: '哪里不懂，就接着问',
    icon: 'chat' as const,
    body: '选中不理解的代码或解释，继续追问，不用重新描述一遍问题。',
  },
]
</script>

<template>
  <div class="min-h-dvh bg-white text-slate-800">
    <SiteHeader active="home" />

    <!-- 首屏：产品定位 + 两个入口 + 三个能力 -->
    <section class="bg-white">
      <div class="mx-auto w-full max-w-[1000px] px-4 pb-12 pt-14 text-center sm:px-6 sm:pt-20">
        <span
          class="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700"
        >
          AI 代码理解工具
        </span>

        <h1
          class="mt-6 text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl"
        >
          让代码更容易理解
        </h1>

        <p class="mt-5 text-lg leading-relaxed text-slate-600 sm:text-xl">
          贴一段代码，或者拖进整个项目。
        </p>
        <p class="mt-1 text-lg font-semibold text-emerald-600 sm:text-xl">不用写提示词。</p>
        <p class="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-500 sm:text-base">
          从语法解释到项目结构分析，帮助你逐步理解代码背后的逻辑。
        </p>
      </div>

      <div class="mx-auto w-full max-w-[1000px] px-4 pb-12 sm:px-6">
        <section class="grid gap-4 sm:grid-cols-2 sm:gap-5">
          <NuxtLink
            v-for="entry in ENTRIES"
            :key="entry.key"
            :to="entry.to"
            class="block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
          >
            <EntryCard
              :title="entry.title"
              :description="entry.description"
              :tag="entry.tag"
              :cta="entry.cta"
              :icon="entry.icon"
            />
          </NuxtLink>
        </section>

        <div class="mt-10 grid grid-cols-3 gap-3 border-t border-slate-100 pt-6 text-center">
          <div v-for="benefit in BENEFITS" :key="benefit.label">
            <AppIcon :name="benefit.icon" class="mx-auto h-6 w-6 text-emerald-600" />
            <p class="mt-2 text-xs font-medium text-slate-600 sm:text-sm">{{ benefit.label }}</p>
          </div>
        </div>
      </div>
    </section>

    <main class="mx-auto w-full max-w-[1000px] px-4 sm:px-6">
      <!-- 为什么选择麦穗 -->
      <section class="py-14 sm:py-20">
        <h2 class="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          为什么不直接问大模型就行了？
        </h2>
        <p class="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500 sm:text-base">
          直接问大模型，也能得到代码解释。但麦穗希望帮你把代码看得更清楚一些。
        </p>

        <div
          class="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div v-for="feature in FEATURES" :key="feature.title" class="flex gap-4 p-5 sm:p-6">
            <span
              class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600"
              aria-hidden="true"
            >
              <AppIcon :name="feature.icon" class="h-5 w-5" />
            </span>
            <div class="min-w-0">
              <h3 class="text-base font-semibold text-slate-800">{{ feature.title }}</h3>
              <p class="mt-1 text-sm leading-relaxed text-slate-500">{{ feature.body }}</p>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="border-t border-slate-200/70 bg-white px-4 py-2.5 text-center sm:py-3">
      <p class="text-sm text-slate-500">让代码好理解，让项目更清晰。</p>
      <p class="mt-1 text-xs text-slate-400">
        麦穗团队 · 传智杯 AI Web 开发挑战赛 ·
        <a
          href="https://github.com/skf-123/AI-We"
          target="_blank"
          rel="noreferrer"
          class="transition hover:text-slate-600"
          >GitHub</a
        >
        · © 2026 麦穗团队
      </p>
    </footer>
  </div>
</template>
