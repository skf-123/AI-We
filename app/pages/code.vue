<script setup lang="ts">
import { useAnalysis } from '~/composables/useAnalysis'
import { useSelectionAsk, type SelectionPayload } from '~/composables/useSelectionAsk'
import { parseGraphData } from '~/utils/analysis-sections'
import { resolveLines } from '~/utils/locate-lines'

useHead({ title: '贴代码 · 麦穗 · 代码理解助手' })

/**
 * 主页面。贴代码 → 自动出四段解析 + 知识框架图。
 *
 * 这个文件现在只干两件事：**排版**和**编排**。
 *   · 排版：顶栏 / 两栏主区 / 图区 / 页脚
 *   · 编排：三个面板之间的动线（按钮 → 解析 → 滚到结果 / 滚到图）
 *
 * 具体的事情都在别处：
 *   CodePane       输入区（含示例、字数提醒、三个按钮）
 *   AnalysisPanel  右栏解析结果（含流式自动跟随）
 *   GraphPanel     知识框架图（含三种状态）
 *   useAnalysis    请求与状态（怎么调接口、怎么拆流、引用来源藏在哪个响应头）
 *
 * 这样一来，「项目树」那个新页面只要用同样的组件和同一个 composable
 * 拼一遍就行，不必把这套逻辑复制第二份。
 */

/**
 * 代码长度上限。
 * ⚠️ 必须与 server/api/analyze.post.ts 里 zod 的 max(20000) 保持一致，
 *    改了一边要同步改另一边 —— 前端只是提前提醒，真正把关的是服务端。
 */
const CODE_MAX = 20000

/** 超过这个长度就开始醒目提醒（还没到上限） */
const CODE_WARN_AT = 18000

const code = ref('')

/** 解析链路的状态与请求，全在 composable 里 */
const { output, sources, errorMsg, loading, done, run, stop, reset } = useAnalysis()

/** 两个面板的实例引用。只用到它们暴露的 scrollIntoView / focusLines —— 结构类型，不依赖组件内部 */
const analysisRef = ref<{ scrollIntoView: () => void } | null>(null)
const graphPanelRef = ref<{ scrollIntoView: () => void } | null>(null)
const codePaneRef = ref<{ focusLines: (lines: number[]) => void } | null>(null)

/** 图 JSON：由页面统一算一次，两个面板各自收结果，谁也不依赖谁 */
const graphData = computed(() => parseGraphData(output.value))

/** 左栏要高亮的代码行号（1 起）。由「在解析结果里选中一段」驱动 */
const highlightLines = ref<number[]>([])

/**
 * 追问的页面级状态：选中了什么、气泡开没开。
 * 对话、请求、流式仍由 SelectionAsk 自己持有；这里只放页面之间共用的那部分。
 */
const {
  open: askOpen,
  selection: askSelection,
  range: askRange,
  setSelection,
  openAsk,
  close: closeAsk,
} = useSelectionAsk()

/**
 * 右栏把"选中了什么"抛上来，这里做两件事：
 *
 *   1. 换算成原始代码的行号、让左栏亮起来 —— 换算需要**原始代码**，
 *      而代码只有页面手上有，所以这一步留在页面，面板不必认识左栏。
 *   2. 把选区交给 useSelectionAsk —— 只是点一下（没选中东西）就清空，
 *      相当于"点空白处取消选中"。
 */
function onSelection(payload: SelectionPayload) {
  const hit = resolveLines(payload.text, payload.anchorLines, code.value)
  highlightLines.value = hit.lines

  if (hit.lines.length > 0) {
    nextTick(() => codePaneRef.value?.focusLines(hit.lines))
  }

  setSelection(payload)
}

async function analyze() {
  if (loading.value || !code.value.trim()) return

  highlightLines.value = []
  closeAsk()

  // 小屏是上下堆叠布局：输入区在上、结果区在下，点完按钮结果还在屏幕外，
  // 用户会以为"点了没反应"。桌面端是左右两栏、结果就在旁边，不需要滚。
  if (window.matchMedia('(max-width: 1023px)').matches) {
    analysisRef.value?.scrollIntoView()
  }

  await run(code.value)
}

function clearAll() {
  stop()
  code.value = ''
  reset()
  highlightLines.value = []
  closeAsk()
}
</script>

<template>
  <div class="min-h-dvh bg-[#f5f6f8] text-slate-800">
    <!--
      布局说明（桌面端 lg 以上）：
        整页可以正常滚动（右侧有整页滚动条），从上到下依次是：
        顶栏 / 两栏主区 / 知识框架图。

        两栏各自锁定高度（约一屏减去顶栏），内容在面板内部滚动 ——
        所以右侧解释再长，撑高的也只是它自己的滚动区，不会把页面无限拉长。

        知识框架图区域**始终渲染**，没数据时显示占位提示 ——
        这样图出现时页面不会突然跳高，评委第一眼也能看到还有这个功能。

        小屏（< lg）不锁高度，退回普通文档流，否则手机上会挤成一团。
    -->
    <!-- 顶栏（三个页面共用） -->
    <SiteHeader active="code" />

    <main
      class="mx-auto grid w-full max-w-[1400px] gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6 lg:grid-cols-2"
    >
      <!-- 左：输入 -->
      <CodePane
        ref="codePaneRef"
        v-model="code"
        :loading="loading"
        :max-length="CODE_MAX"
        :warn-at="CODE_WARN_AT"
        :highlight-lines="highlightLines"
        @analyze="analyze"
        @stop="stop"
        @clear="clearAll"
      />

      <!-- 右：输出 -->
      <AnalysisPanel
        ref="analysisRef"
        :output="output"
        :sources="sources"
        :error-msg="errorMsg"
        :loading="loading"
        :done="done"
        :graph-ready="Boolean(graphData)"
        @request-graph="graphPanelRef?.scrollIntoView()"
        @selection="onSelection"
      />
    </main>

    <!-- 知识框架图 -->
    <GraphPanel ref="graphPanelRef" :data="graphData" :loading="loading" />

    <!--
      手机端的固定追问入口。选过内容就出现，位置不跟选区走 ——
      原来那个贴着选区的小浮标会被浏览器原生的选中菜单压住；
      而这个按钮固定在视口右下角，分析结果再长、页面滚到哪都够得着。
      桌面端（≥lg）不显示，仍用鼠标选完就地浮出的「提问」。
    -->
    <button
      v-if="askSelection && !askOpen"
      type="button"
      class="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 rounded-full bg-emerald-600 px-4 py-3 text-[13.5px] font-medium whitespace-nowrap text-white shadow-lg transition active:bg-emerald-700 lg:hidden"
      @click="openAsk"
    >
      追问选中内容
    </button>

    <!-- 追问气泡（Teleport 到 body，不受面板 overflow 裁剪） -->
    <SelectionAsk
      v-model:open="askOpen"
      :selection="askSelection"
      :range="askRange"
      :code="code"
      @close="closeAsk"
    />

    <footer class="shrink-0 px-4 pb-4 text-center text-xs text-slate-400 sm:px-6 sm:pb-6">
      麦穗团队 · 传智杯 AI Web 开发挑战赛
    </footer>
  </div>
</template>
