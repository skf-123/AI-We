<script setup lang="ts">
/**
 * 右栏：解析结果。
 *
 * 这个组件**只管展示**：数据从 props 进、交互从事件出。它不碰网络、
 * 不认识页面上的别的东西 —— 将来「项目树」那个新页面也要复用这一块，
 * 不能让面板跟某一个页面的请求逻辑绑在一起。
 *
 * 唯一的例外是**它自己那个滚动容器**：流式自动跟随必须贴着 DOM 做，
 * 让页面越界去调 `outputBoxRef.scrollTop` 才是耦合，所以这段逻辑留在组件内。
 */
import glossaryData from '~/data/glossary.json'
import type { GlossaryTerm, RagSource } from '~/types/analysis'
import { parseSections, SECTION_TITLES } from '~/utils/analysis-sections'

const props = defineProps<{
  /** 流式原始文本（未切分） */
  output: string
  /** 知识库检索到的引用来源，走响应头传来 */
  sources: RagSource[]
  errorMsg: string
  loading: boolean
  done: boolean
  /** 图 JSON 是否已经解析成功 —— 决定要不要显示「图已生成」入口 */
  graphReady: boolean
}>()

const emit = defineEmits<{
  /** 「查看 ↓」被点了。滚到图区是跨区域的动线，交给页面转接 */
  (e: 'request-graph'): void
}>()

const panelRef = ref<HTMLElement | null>(null)
const outputBoxRef = ref<HTMLElement | null>(null)

/** 把流式返回的文本按四个小标题切成块，边流边渲染 */
const sections = computed(() => parseSections(props.output))

const isEmpty = computed(() => props.output.trim().length === 0)

/**
 * 术语只在「四、技术溯源」那一段生效。
 *
 * 那一段本来就是逐条讲「这项技术从哪来、当初解决什么」的地方，
 * 术语密度最高、读者最需要一个能就地查的入口；而别处的正文提到
 * "Python""数组"这类词时如果也变蓝，反而碎。
 */
const TRACE_TITLE: string = SECTION_TITLES[3]

const terms = glossaryData as GlossaryTerm[]
const termIndex = new Map(terms.map((t) => [t.term, t]))

/** 引用卡片列表的实例：点正文里的 [n] 时调它暴露的 focus() */
const sourceListRef = ref<{ focus: (oneBased: number) => void } | null>(null)

/** 当前打开的术语卡，以及它贴着哪一个词 */
const activeTerm = ref<GlossaryTerm | null>(null)
const termAnchor = ref<{ left: number; right: number; top: number; bottom: number } | null>(null)

function onTerm(payload: { key: string; rect: DOMRect }) {
  const found = termIndex.get(payload.key)
  if (!found) return
  activeTerm.value = found
  termAnchor.value = {
    left: payload.rect.left,
    right: payload.rect.right,
    top: payload.rect.top,
    bottom: payload.rect.bottom,
  }
}

function onCite(index: number) {
  sourceListRef.value?.focus(index)
}

function closeTerm() {
  activeTerm.value = null
  termAnchor.value = null
}

// 新一轮解析开始，把上一轮开着的小卡收掉
watch(
  () => props.loading,
  (v) => {
    if (v) closeTerm()
  },
)

/**
 * 是否跟随最新内容自动滚到底部。
 * 用户手动往上滚之后就置 false，不再把人家拉回来 —— 否则想回看前文会被反复拽走。
 */
let followTail = true

/** 用户滚动输出面板时，用「离底部还有多远」判断要不要继续跟随 */
function onOutputScroll() {
  const box = outputBoxRef.value
  if (!box) return
  followTail = box.scrollHeight - box.scrollTop - box.clientHeight < 40
}

/**
 * 把输出面板滚到底部。
 *
 * 面板是「锁定一屏、内部滚动」的设计：一次解析的正文会长到四千多像素，
 * 而面板只有六百多像素高。不主动跟随的话，内容全堆在下方看不见 ——
 * 打字机效果从第二屏起就完全失效了（实测 scrollTop 全程停在 0）。
 *
 * 必须 await nextTick()：刚写进 props.output，DOM 还没更新，
 * 这时候读 scrollHeight 拿到的是旧值。
 */
async function scrollOutputToBottom() {
  if (!followTail) return
  await nextTick()
  const box = outputBoxRef.value
  if (box) box.scrollTop = box.scrollHeight
}

// 内容一长就跟随。改由组件自己 watch，而不是让页面在流循环里调用 ——
// 依赖方向从此只有一条：output 变了，容器自己滚。
watch(
  () => props.output,
  () => {
    void scrollOutputToBottom()
  },
)

// 新一轮解析开始（loading 由 false 变 true）→ 重新开始跟随
watch(
  () => props.loading,
  (v) => {
    if (v) followTail = true
  },
)

/**
 * 滚到本面板。
 * 小屏是上下堆叠布局：输入区在上、结果区在下，点完按钮结果还在屏幕外，
 * 用户会以为"点了没反应"。这个动作由页面在开始解析前调用。
 */
function scrollIntoView() {
  panelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ scrollIntoView })
</script>

<template>
  <section
    ref="panelRef"
    class="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:h-[calc(100vh-200px)] lg:min-h-[420px] lg:overflow-hidden"
  >
    <div class="mb-3 flex items-center gap-2">
      <span class="text-sm text-slate-500">解析结果</span>
      <span
        v-if="loading"
        class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
      >
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        正在解析
      </span>
      <span
        v-else-if="done && !errorMsg"
        class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
      >
        已完成
      </span>
    </div>

    <div
      ref="outputBoxRef"
      class="min-h-[240px] flex-1 overflow-y-auto overscroll-contain pr-1 sm:min-h-[320px] lg:min-h-0"
      @scroll.passive="onOutputScroll"
    >
      <!-- 出错 -->
      <div v-if="errorMsg" class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
        {{ errorMsg }}
      </div>

      <!--
        空状态。同一块地方，两种面孔：

        - 还没点「开始解析」→ 一段引导文字，教用户怎么用。
          此刻系统什么都没做，放动画等于撒谎。
        - 点了、但正文还没吐出来的那一两秒 → 换成一本放大的书。

        这段等待是整个流程里唯一「真的在等、又没东西可看」的时段 ——
        正文一开始流，文字本身就在持续告诉你进度了。
      -->
      <div v-else-if="isEmpty" class="flex h-full items-center justify-center px-6 text-center">
        <BookLoader v-if="loading" />
        <p v-else class="text-sm leading-relaxed text-slate-400">
          左边粘贴代码，点「开始解析」。<br />
          这里会依次出现：逐词逐句 → 局部关系 → 整段作用 → 技术溯源。
        </p>
      </div>

      <!-- 流式渲染的四段 -->
      <div v-else class="space-y-4">
        <article
          v-for="s in sections"
          :key="s.title"
          class="rounded-lg border border-slate-100 bg-slate-50 p-3.5"
        >
          <h2 class="mb-2 text-sm font-semibold text-emerald-700">{{ s.title }}</h2>
          <MarkdownBlock
            :text="s.body"
            :terms="s.title === TRACE_TITLE ? terms : undefined"
            @term="onTerm"
            @cite="onCite"
          />
        </article>

        <!-- 知识库检索到的引用来源，紧跟在四段解释之后 -->
        <SourceList v-if="sources.length" ref="sourceListRef" :sources="sources" />

        <!--
          知识框架图的入口。

          图必须等四段正文全部生成完才可能出现，而正文有四千多像素 ——
          用户读完正文不会知道下面还有东西。面板此刻已经自动跟到正文末尾，
          视线正好落在这里，所以入口放这儿而不是页面顶部或右下角。

          条件用 graphReady：模型吐的 JSON 没解析成功时图不会渲染，
          这时候不该提示「已生成」。
        -->
        <button
          v-if="!loading && graphReady"
          type="button"
          class="flex w-full items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
          @click="emit('request-graph')"
        >
          <span>知识框架图已生成</span>
          <span class="text-xs text-emerald-600">查看 ↓</span>
        </button>

        <span v-if="loading" class="inline-block h-4 w-2 animate-pulse bg-emerald-500" />
      </div>
    </div>

    <!-- 术语解释卡（Teleport 到 body，不受本面板的 overflow 裁剪） -->
    <TermCard :term="activeTerm" :anchor="termAnchor" @close="closeTerm" />
  </section>
</template>
