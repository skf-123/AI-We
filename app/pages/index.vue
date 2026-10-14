<script setup lang="ts">
import type { RagSource } from '~/types/analysis'
import { parseGraphData } from '~/utils/analysis-sections'

/**
 * 主页面。贴代码 → 自动出四段解析 + 知识框架图。
 *
 * 这个文件现在只干两件事：**排版**和**编排**。
 *   · 排版：顶栏 / 两栏主区 / 图区 / 页脚
 *   · 编排：三个面板之间的动线（按钮 → 解析 → 滚到结果 / 滚到图）
 *
 * 具体的事情都在组件里：
 *   CodePane       输入区（含示例、字数提醒、三个按钮）
 *   AnalysisPanel  右栏解析结果（含流式自动跟随）
 *   GraphPanel     知识框架图（含三种状态）
 *
 * 这样一来，「项目树」那个新页面只要用同样的组件拼一遍就行，
 * 不必把这套逻辑复制第二份。
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
const output = ref('')
const errorMsg = ref('')
const loading = ref(false)
const done = ref(false)
const sources = ref<RagSource[]>([])

/** 两个面板的实例引用。只用到它们暴露的 scrollIntoView —— 结构类型，不依赖组件内部 */
const analysisRef = ref<{ scrollIntoView: () => void } | null>(null)
const graphPanelRef = ref<{ scrollIntoView: () => void } | null>(null)

/** 图 JSON：由页面统一算一次，两个面板各自收结果，谁也不依赖谁 */
const graphData = computed(() => parseGraphData(output.value))

let controller: AbortController | null = null

async function analyze() {
  if (loading.value || !code.value.trim()) return

  output.value = ''
  errorMsg.value = ''
  sources.value = []
  loading.value = true
  done.value = false
  // 自动跟随的重置在 AnalysisPanel 内部（它 watch loading 的上升沿）

  controller = new AbortController()

  // 小屏是上下堆叠布局：输入区在上、结果区在下，点完按钮结果还在屏幕外，
  // 用户会以为"点了没反应"。桌面端是左右两栏、结果就在旁边，不需要滚。
  if (window.matchMedia('(max-width: 1023px)').matches) {
    nextTick(() => analysisRef.value?.scrollIntoView())
  }

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value }),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      // 服务端用 createError 返回的是 JSON，这里尽力把它读成人话
      let msg = `请求失败（HTTP ${res.status}）`
      try {
        const data = await res.json()
        msg = data?.statusMessage || data?.message || msg
      } catch {
        /* 保持默认提示 */
      }
      errorMsg.value = msg
      return
    }

    // 引用来源走响应头，读 body 之前先取出来 ——
    // 这样卡片在打字机刚开始输出时就能显示，不用等全文流完
    const rawSources = res.headers.get('X-Rag-Sources')
    if (rawSources) {
      try {
        sources.value = JSON.parse(decodeURIComponent(rawSources))
      } catch {
        sources.value = []
      }
    }

    // 逐块读取，读一块、显示一块 —— 这就是打字机效果的来源。
    // 「跟着滚到底部」不在这里做：那是 AnalysisPanel 自己 watch output 的事。
    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      output.value += decoder.decode(value, { stream: true })
    }

    done.value = true
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      done.value = true
    } else {
      errorMsg.value = `出错了：${err instanceof Error ? err.message : String(err)}`
    }
  } finally {
    loading.value = false
    controller = null
  }
}

function stop() {
  controller?.abort()
  loading.value = false
}

function clearAll() {
  stop()
  code.value = ''
  output.value = ''
  errorMsg.value = ''
  done.value = false
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
    <!-- 顶栏 -->
    <header class="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
      <div class="mx-auto flex max-w-[1400px] items-center justify-between">
        <div class="flex min-w-0 items-baseline gap-3">
          <h1 class="truncate text-lg font-semibold tracking-wide text-slate-900">
            麦穗 · 代码理解助手
          </h1>
          <span class="text-xs text-slate-400">WheatBend</span>
        </div>
        <span class="hidden text-xs text-slate-400 sm:block"> 贴代码 · 不用提问 · 自动讲解 </span>
      </div>
    </header>

    <main
      class="mx-auto grid w-full max-w-[1400px] gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-6 lg:grid-cols-2"
    >
      <!-- 左：输入 -->
      <CodePane
        v-model="code"
        :loading="loading"
        :max-length="CODE_MAX"
        :warn-at="CODE_WARN_AT"
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
      />
    </main>

    <!-- 知识框架图 -->
    <GraphPanel ref="graphPanelRef" :data="graphData" :loading="loading" />

    <footer class="shrink-0 px-4 pb-4 text-center text-xs text-slate-400 sm:px-6 sm:pb-6">
      麦穗团队 · 传智杯 AI Web 开发挑战赛
    </footer>
  </div>
</template>
