<script setup lang="ts">
/**
 * 首页：先讲清楚「这个产品能帮你什么」，再让人选入口。
 *
 * 纯静态页：不引 composable、不发请求、不 import 另外两个页面。
 * 两个入口用同一份数据生成，卡片组件只负责展示，链接由页面包在外面。
 * 首屏速度优先：没有大图、没有动画库，只有排版与一层很淡的渐变。
 */

useHead({ title: '麦穗 · 代码理解助手' })

const ENTRIES = [
  {
    key: 'code',
    eyebrow: '贴代码',
    title: '一段代码，几秒看懂',
    fit: '适合：一段陌生代码、面试题、报错片段、课程示例',
    points: [
      '逐词逐句、局部关系、整段作用、技术溯源',
      '正文里的术语可点，引用编号可点',
      '选中一段，左栏对应代码行亮起',
    ],
    tone: 'emerald' as const,
    to: '/code',
  },
  {
    key: 'project',
    eyebrow: '整个项目',
    title: '一个项目，先看全局',
    fit: '适合：接手别人的项目、课程设计、看不懂目录结构',
    points: [
      '目录树先告诉你哪些文件值得读',
      '每个文件四段，按文件并发解析',
      '最后一张可展开的项目级知识框架图',
    ],
    tone: 'indigo' as const,
    to: '/project',
  },
]

const FEATURES = [
  {
    title: '不是总结，是逐行讲',
    body: '每一行在干什么、前后怎么衔接、整体解决什么问题，都按固定四段讲清楚。',
  },
  {
    title: '技术溯源有出处',
    body: '自建 58 条知识语料；关键结论标注来源，点开就能核对原文。',
  },
  {
    title: '知识框架图',
    body: '代码、技术、概念三类节点，把一段代码或一个项目的关系摊开来看。',
  },
  {
    title: '读不懂就地追问',
    body: '选中正文里的一段就能问，同一个面板里可以接着往下聊。',
  },
]

const STEPS = [
  { title: '贴代码，或拖进整个项目', body: '不需要写任何提示词。' },
  { title: '自动解析', body: '逐词逐句、局部关系、整体作用、技术溯源。' },
  { title: '带出处地看懂', body: '顺着引用与框架图，继续读下去。' },
]
</script>

<template>
  <div class="min-h-dvh bg-[#f5f6f8] text-slate-800">
    <SiteHeader active="home" />

    <!-- Hero -->
    <section
      class="relative overflow-hidden border-b border-slate-200/70"
      style="
        background-image: radial-gradient(
          60% 70% at 50% 0%,
          rgba(16, 185, 129, 0.12) 0%,
          rgba(245, 246, 248, 0) 72%
        );
      "
    >
      <div class="mx-auto w-full max-w-[1100px] px-4 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
        <span
          class="inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-white/70 px-3 py-1 text-[11px] font-medium text-emerald-700"
        >
          传智杯 · AI Web 网页开发挑战赛
        </span>

        <h1
          class="mt-6 text-4xl font-semibold leading-[1.15] tracking-tight text-slate-900 sm:text-6xl"
        >
          贴一段代码，<br class="hidden sm:block" />
          或者拖进<span
            class="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent"
          >
            整个项目</span
          >。
        </h1>

        <p class="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          不用写一句提示词。逐词逐句、局部关系、整段作用、技术溯源，一次讲完；
          再配一张能展开的知识框架图。
        </p>

        <div class="mt-6 flex flex-wrap gap-2 text-xs text-slate-500">
          <span class="rounded-full bg-white px-3 py-1 shadow-sm">零提示词</span>
          <span class="rounded-full bg-white px-3 py-1 shadow-sm">引用有出处</span>
          <span class="rounded-full bg-white px-3 py-1 shadow-sm">术语可点</span>
          <span class="rounded-full bg-white px-3 py-1 shadow-sm">选中即可追问</span>
        </div>
      </div>
    </section>

    <main class="mx-auto w-full max-w-[1100px] px-4 sm:px-6">
      <!-- 两个入口 -->
      <section class="-mt-8 grid gap-4 sm:-mt-10 sm:gap-5 lg:grid-cols-2">
        <NuxtLink
          v-for="entry in ENTRIES"
          :key="entry.key"
          :to="entry.to"
          class="block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
        >
          <EntryCard
            :eyebrow="entry.eyebrow"
            :title="entry.title"
            :fit="entry.fit"
            :points="entry.points"
            :tone="entry.tone"
          />
        </NuxtLink>
      </section>

      <p class="mt-3 px-1 text-center text-[11px] text-slate-400">
        两个入口都不会把代码上传到任何存储；解析结果只留在当前页面。
      </p>

      <!-- 它能帮你什么 -->
      <section class="py-14 sm:py-20">
        <h2 class="text-center text-sm font-medium tracking-wide text-slate-400">它能帮你什么</h2>

        <div class="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article
            v-for="feature in FEATURES"
            :key="feature.title"
            class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div class="h-1.5 w-8 rounded-full bg-emerald-400" />
            <h3 class="mt-4 text-base font-semibold text-slate-800">{{ feature.title }}</h3>
            <p class="mt-2 text-sm leading-relaxed text-slate-500">{{ feature.body }}</p>
          </article>
        </div>
      </section>

      <!-- 怎么用 -->
      <section class="pb-16 sm:pb-24">
        <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <h2 class="text-center text-sm font-medium tracking-wide text-slate-400">三步</h2>

          <ol class="mt-6 grid gap-6 sm:grid-cols-3">
            <li v-for="(step, i) in STEPS" :key="step.title" class="flex gap-3">
              <span
                class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700"
              >
                {{ i + 1 }}
              </span>
              <div>
                <h3 class="text-sm font-semibold text-slate-800">{{ step.title }}</h3>
                <p class="mt-1 text-sm leading-relaxed text-slate-500">{{ step.body }}</p>
              </div>
            </li>
          </ol>
        </div>
      </section>
    </main>

    <footer class="border-t border-slate-200/70 px-4 py-6 text-center text-xs text-slate-400">
      麦穗团队 · 传智杯 AI Web 开发挑战赛
    </footer>
  </div>
</template>
