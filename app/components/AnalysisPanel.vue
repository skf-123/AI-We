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
import type { FactCheck } from '~/types/facts'
import { parseSections } from '~/utils/analysis-sections'
import { rangeLines } from '~/utils/locate-lines'

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
  /** 空状态提示。项目入口传自己的文案，默认是贴代码入口那一套 */
  emptyHint?: string
  /** 面板标题。默认「解析结果」 */
  title?: string
  /** 标题下面那一行补充信息；项目入口显示当前文件路径 */
  subtitle?: string
  /** 模型输出撞到上限，后面的内容没有讲完 */
  outputTruncated?: boolean
  /** 跨文件事实块核对结果；贴代码入口不传 */
  facts?: FactCheck
  /** 事实块没闭合或不是合法 JSON */
  factsError?: string
  /**
   * 高度模式。
   * false：贴代码入口，锁一屏高度（桌面端）
   * true：项目入口，跟随左侧目录树的高度（grid 行高由左栏决定）
   */
  fillHeight?: boolean
}>()

const emit = defineEmits<{
  /** 「查看 ↓」被点了。滚到图区是跨区域的动线，交给页面转接 */
  (e: 'request-graph'): void
  /**
   * 用户在正文里选了一段（或点了空白处）。这里只负责从 DOM 里读出
   * "选中了什么 + 它属于哪几行 + 它在屏幕的什么位置"，**换算成代码行号、
   * 决定要不要弹追问，都交给页面** —— 因为原始代码在页面手上，
   * 面板不该为了这两件事认识左栏、也不该认识那个气泡。
   */
  (
    e: 'selection',
    payload: { text: string; anchorLines: number[] | null; range: Range | null },
  ): void
}>()

const panelRef = ref<HTMLElement | null>(null)
const outputBoxRef = ref<HTMLElement | null>(null)

/** 把流式返回的文本按四个小标题切成块，边流边渲染 */
const sections = computed(() => parseSections(props.output))

const isEmpty = computed(() => props.output.trim().length === 0)

/**
 * 术语词表，**正文的每一段都传**。
 *
 * 原先只在「四、技术溯源」那一段传，理由是"别处会碎"。实测不成立：
 * 词表里那批"普通词"（API、字节码、垃圾回收…）在真实输出里几乎不出现，
 * 而模型点名的位置恰恰常在「一、逐词逐句」（"这是装饰器语法糖，等价于…"），
 * 正好是最需要就地查的那一处。
 *
 * 现在把关只落在**一个地方**：收不收进词表。收进来的词就意味着
 * "它值得单独解释" —— 那它在哪一段出现都值得解释。
 * 判据一句话：**可不可点，由词表和文本里有没有决定，不由它在第几段决定。**
 */
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

/**
 * 从选区往上找最近的、带行号锚点的段落。
 *
 * 模型在「逐词逐句」里写的 `第 7 行` 就是**原始代码的真实行号**，
 * markdown-terms.ts 已经把它写进 DOM（data-line-start / data-line-end），
 * 所以这里只是"读属性"，不用再去正则文本、更不用猜。
 */
function anchorLinesOf(range: Range): number[] | null {
  const box = outputBoxRef.value
  let node: Node | null = range.startContainer

  while (node && node !== box) {
    if (node instanceof HTMLElement) {
      const start = node.getAttribute('data-line-start')
      if (start)
        return rangeLines(Number(start), Number(node.getAttribute('data-line-end') ?? start))
    }
    node = node.parentNode
  }
  return null
}

/**
 * 鼠标在本面板里松手：把"选中了什么"抛给页面。
 * 没选中东西时也抛（带空的 text）—— 页面据此把左栏的高亮清掉，
 * 相当于"点一下空白处取消选中"。
 */
function onBodyMouseUp() {
  const box = outputBoxRef.value
  const sel = window.getSelection()
  if (!box || !sel || sel.rangeCount === 0) return

  const range = sel.getRangeAt(0)
  // 点的必须是在本面板里面，别把页面上别处的选区也当回事
  if (!box.contains(range.commonAncestorContainer)) return

  const text = sel.toString().trim()

  emit('selection', {
    text,
    anchorLines: anchorLinesOf(range),
    // 带**真正的 Range**，不是快照矩形 —— 气泡要能在滚动时重算"选区现在在哪"。
    // cloneRange() 让这个副本脱离当前选区，之后浏览器把选区清掉了它照样能用。
    range: text ? range.cloneRange() : null,
  })
}

/**
 * 触屏上的选中走的是另一条事件路径。
 *
 * 长按选中、拖动选择手柄时，浏览器只发 `selectionchange`，**不发 `mouseup`** ——
 * 所以只挂 mouseup 的版本在手机上根本等不到，那个「提问」按钮永远不出现。
 * 这里补上 selectionchange，并且**忽略空选区**：
 * 用户去点按钮时选区会先被浏览器清掉，若这时把状态一并清空，
 * 按钮会在点击落下前消失。空选区也交给 mouseup 那条路径去清（桌面点空白处）。
 */
let selectionTimer: ReturnType<typeof setTimeout> | null = null

function emitSelectionFromDom() {
  const box = outputBoxRef.value
  const sel = window.getSelection()
  if (!box || !sel || sel.rangeCount === 0) return

  const range = sel.getRangeAt(0)
  if (!box.contains(range.commonAncestorContainer)) return

  const text = sel.toString().trim()
  if (!text) return

  emit('selection', {
    text,
    anchorLines: anchorLinesOf(range),
    range: range.cloneRange(),
  })
}

function onSelectionChange() {
  if (selectionTimer) clearTimeout(selectionTimer)
  selectionTimer = setTimeout(emitSelectionFromDom, 250)
}

onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', onSelectionChange)
  if (selectionTimer) clearTimeout(selectionTimer)
})

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
    class="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:overflow-hidden"
    :class="fillHeight ? 'lg:min-h-0' : 'lg:h-[calc(100vh-200px)] lg:min-h-[420px]'"
  >
    <div class="mb-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span class="shrink-0 text-sm text-slate-500">{{ title || '解析结果' }}</span>
      <span
        v-if="subtitle"
        class="min-w-0 truncate font-mono text-[11.5px] text-slate-400"
        :title="subtitle"
      >
        {{ subtitle }}
      </span>
      <span
        v-if="loading"
        class="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
      >
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        正在解析
      </span>
      <span
        v-else-if="done && !errorMsg"
        class="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
      >
        已完成
      </span>
    </div>

    <!-- ⚠️ overscroll-contain 只加在 lg，小屏坚决不能有它。
         小屏（<lg）这个容器没有固定高度、跟着内容长，实测 390 宽的手机上它有
         5728px 高却不可滚动，而它占满整宽（324/390）—— 带上 overscroll-contain
         就等于「手势到我这儿就被吃掉、又不许传给页面」，于是整页滑不动。
         2026-10-16 实测（仿真 390×844 + 合成触摸拖动）：
           正中 x=195 → 页面 0px 不动；最右 x=370 → 345px；最左 x=20 → 345px
           仅把 overscroll-behavior-y 改回 auto，正中立刻恢复 345px
         desktop（≥lg）才需要它：那时面板锁定一屏高度、内部滚动，
         滚到底不该把整页也带着滚。 -->
    <div
      ref="outputBoxRef"
      class="min-h-[240px] flex-1 overflow-y-auto pr-1 sm:min-h-[320px] lg:min-h-0 lg:overscroll-contain"
      @scroll.passive="onOutputScroll"
      @mouseup="onBodyMouseUp"
    >
      <!-- 出错 -->
      <div
        v-if="errorMsg"
        class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
      >
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
          <template v-if="emptyHint">{{ emptyHint }}</template>
          <template v-else>
            左边粘贴代码，点「开始解析」。<br />
            这里会依次出现：逐词逐句 → 局部关系 → 整段作用 → 技术溯源。
          </template>
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
          <MarkdownBlock :text="s.body" :terms="terms" @term="onTerm" @cite="onCite" />
        </article>

        <!--
          输出撞到模型上限时的提示。
          它和「输入超过 5 万字符」是两件事：那个是没看到后半段文件，
          这个是看到了但模型没写完。放在四段之后，不打断正在读的正文。
        -->
        <p
          v-if="outputTruncated"
          class="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-700"
        >
          输出到达上限，后面的内容没有讲完。可以重试，或者把文件拆小一点再看。
        </p>

        <!-- 跨文件事实块：程序核对过才显示；只标“改动”，不替模型背书 -->
        <div
          v-if="facts || factsError"
          class="rounded-lg border p-2.5 text-xs leading-relaxed"
          :class="
            facts && facts.unverified > 0
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-slate-200 bg-slate-50 text-slate-600'
          "
        >
          <p v-if="facts">
            跨文件事实：{{ facts.verified }} 条已核实<template v-if="facts.unverified">
              ，{{ facts.unverified }} 条未核实</template
            >
          </p>
          <p v-if="factsError">{{ factsError }}</p>
          <details v-if="facts?.items.length" class="mt-1">
            <summary class="cursor-pointer select-none text-[10.5px] text-slate-500">
              查看核对明细
            </summary>
            <ul class="mt-1 space-y-1">
              <li v-for="(item, index) in facts.items" :key="`fact-${index}`">
                <span
                  class="mr-1 rounded px-1 text-[10px]"
                  :class="
                    item.status === 'verified'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  "
                >
                  {{ item.status === 'verified' ? '已核实' : '未核实' }}
                </span>
                <span class="font-mono text-[10px] text-slate-500">
                  {{ item.path }}:{{ item.line }}
                </span>
                <span v-if="item.claim"> · {{ item.claim }}</span>
                <span v-if="item.reason" class="text-slate-500">（{{ item.reason }}）</span>
              </li>
            </ul>
          </details>
        </div>

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
