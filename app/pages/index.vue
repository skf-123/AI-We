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
    title: '一段代码，讲透上下文',
    fit: '适合场景：遇到卡壳的报错片段、看不懂的面试题、开源库里的一段核心逻辑。',
    points: [
      '讲清每一行的作用、上下文的衔接与关联',
      '术语可点开，技术出处可核对',
      '选中正文，左侧代码行自动高亮',
    ],
    tone: 'emerald' as const,
    to: '/code',
  },
  {
    key: 'project',
    eyebrow: '整个项目',
    title: '一个项目，理清结构网',
    fit: '适合场景：限时读懂陌生的课设/毕设/开源仓库、接手团队老项目。',
    points: [
      '浏览器里只读文件，解析片段只发给大模型，服务端不留存',
      '逐个文件四段解释，按依赖关系串联',
      '最后收拢成可展开的项目知识框架图',
    ],
    tone: 'indigo' as const,
    to: '/project',
  },
]

const FEATURES = [
  {
    title: '逐行拆解',
    body: '普通 AI 只会给一段大概的总结。我们把每一行、局部上下文、整体作用、技术来由，按固定四段讲清楚，不敷衍。',
  },
  {
    title: '技术出处，有据可查',
    body: '自建 58 张技术卡片。讲这项技术为什么被发明时，不仅给结论，还标出处；跨文件的引用和依赖关系，由程序严格核对，不瞎编。',
  },
  {
    title: '跨文件的全局视角',
    body: '不孤立解释单行。它属于哪一层、被谁引用、又依赖了谁，一张知识框架图把代码、技术和文件关系全部串起来。',
  },
  {
    title: '不懂就追问',
    body: '选中正文里看不懂的一段，直接在原地展开追问。历史不存服务器，对话关掉即焚，不给你留痕。',
  },
]

const STEPS = [
  { title: '丢进去', body: '贴一段代码，或者拖进整个项目。不需要想提示词，不需要配环境。' },
  {
    title: '自动拆解',
    body: '自动跑出四段解释，生成知识框架图，把文件和依赖的结构关系摊开在你面前。',
  },
  {
    title: '顺藤摸瓜',
    body: '点术语、点出处、点跨文件关联，顺着线索把项目看穿；看不懂的地方，选中直接追问。',
  },
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
          看懂代码，<br class="hidden sm:block" />
          不能只看<span
            class="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent"
          >
            这一行</span
          >。
        </h1>

        <p class="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
          贴代码，讲透上下文；拖项目，理清结构网。不用写一句提示词，把项目里的代码放回它原本的全局里。
        </p>

        <div class="mt-6 flex flex-wrap gap-2 text-xs text-slate-500">
          <span class="rounded-full bg-white px-3 py-1 shadow-sm">零提示词</span>
          <span class="rounded-full bg-white px-3 py-1 shadow-sm">技术说法有出处</span>
          <span class="rounded-full bg-white px-3 py-1 shadow-sm">全局结构感</span>
          <span class="rounded-full bg-white px-3 py-1 shadow-sm">就地追问</span>
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
        隐私优先：浏览器里只读文件，解析片段只发给大模型，服务端不留存；解析结果只留在当前页面。
      </p>

      <!-- 它能帮你什么 -->
      <section class="py-14 sm:py-20">
        <h2 class="text-center text-sm font-medium tracking-wide text-slate-400">
          为什么它比“直接问大模型”管用？
        </h2>

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
