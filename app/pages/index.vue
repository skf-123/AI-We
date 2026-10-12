<script setup lang="ts">
/**
 * M0 主页面：贴代码 → 自动出四段解析。
 *
 * 这一版刻意保持很"窄"：没有知识框架图、没有伪视频、没有截图上传。
 * 目的只有一个 —— 把「零提示词 → 流式输出」这条主路打通、能演示。
 * 后面每一项都是在这条路上加挂件，而不是另起一条路。
 */

/**
 * 代码长度上限。
 * ⚠️ 必须与 server/api/analyze.post.ts 里 zod 的 max(20000) 保持一致，
 *    改了一边要同步改另一边 —— 前端只是提前提醒，真正把关的是服务端。
 */
const CODE_MAX = 20000

/** 超过这个长度就开始醒目提醒（还没到上限） */
const CODE_WARN_AT = 18000

/** 知识库检索到的引用来源（服务端通过响应头 X-Rag-Sources 传来） */
interface RagSource {
  id: string
  title: string
  label: string
  url: string
  score: number
}

const code = ref('')
const output = ref('')
const errorMsg = ref('')
const loading = ref(false)
const done = ref(false)
const sources = ref<RagSource[]>([])

/** 结果区。小屏上点完「开始解析」要滚到它，见 analyze() */
const resultRef = ref<HTMLElement | null>(null)

/** 输出面板的滚动容器（流式时自动跟到底部，见 scrollOutputToBottom） */
const outputBoxRef = ref<HTMLElement | null>(null)

let controller: AbortController | null = null

/** 四个文字小标题，必须与 server/utils/prompt.ts 里的约定一致 */
const SECTION_TITLES = [
  '一、逐词逐句',
  '二、局部关系与作用',
  '三、整段整体作用',
  '四、技术溯源',
] as const

/** 第五部分是给图用的 JSON，不当作正文渲染 */
const GRAPH_TITLE = '五、知识框架图'

/** 把流式返回的文本按四个小标题切成块，边流边渲染 */
const sections = computed(() => {
  const text = output.value
  const found: { title: string; body: string }[] = []
  // 切分边界 = 四个文字标题 + 图标题，避免图的 JSON 混进第四段正文
  const boundaries = [...SECTION_TITLES, GRAPH_TITLE]

  for (let i = 0; i < SECTION_TITLES.length; i++) {
    const title = SECTION_TITLES[i]!
    const start = text.indexOf(`## ${title}`)
    if (start === -1) continue

    const bodyStart = start + `## ${title}`.length
    const nextTitle = boundaries[i + 1]
    const end = nextTitle ? text.indexOf(`## ${nextTitle}`) : -1

    found.push({
      title,
      body: text.slice(bodyStart, end === -1 ? undefined : end).trim(),
    })
  }

  return found
})

/**
 * 从流式文本里把图 JSON 抠出来。
 *
 * 两种写法都兼容：
 *   1. 正常情况 —— 三个反引号包起来的 json 代码块
 *   2. 兜底 —— 模型忘了加代码围栏，就直接把标题后面的整段当 JSON 试
 *
 * 流式过程中 JSON 是不完整的，解析失败就返回 null，
 * 等它流完自然会解析成功，图到时候自己出现。
 */
const graphData = computed(() => {
  const start = output.value.indexOf(`## ${GRAPH_TITLE}`)
  if (start === -1) return null

  const rest = output.value.slice(start + `## ${GRAPH_TITLE}`.length)
  const fenced = rest.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced ? fenced[1] : rest).trim()

  // 没闭合围栏时，candidate 会带着后面的内容，先退一步只取到最后一个 }
  const trimmed = fenced ? candidate : candidate.slice(0, candidate.lastIndexOf('}') + 1)

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed?.nodes) || !Array.isArray(parsed?.edges)) return null
    if (parsed.nodes.length === 0) return null
    return parsed as { nodes: GraphNode[]; edges: GraphEdge[] }
  } catch {
    return null
  }
})

interface GraphNode {
  id: string
  label: string
  type: 'code' | 'tech' | 'concept'
  detail?: string
}
interface GraphEdge {
  from: string
  to: string
  label?: string
}

const isEmpty = computed(() => output.value.trim().length === 0)

/** 演示用示例代码（录视频和评委体验时一键可用） */
const SAMPLES: { label: string; code: string }[] = [
  {
    label: 'JS · 数组处理',
    code: [
      'const orders = [',
      '  { id: 1, amount: 120, paid: true },',
      '  { id: 2, amount: 80, paid: false },',
      '  { id: 3, amount: 300, paid: true },',
      '];',
      '',
      'const total = orders',
      '  .filter(o => o.paid)',
      '  .map(o => o.amount)',
      '  .reduce((sum, n) => sum + n, 0);',
      '',
      'console.log(`已付款合计: ${total}`);',
    ].join('\n'),
  },
  {
    label: 'Python · 装饰器',
    code: [
      'import time',
      'from functools import wraps',
      '',
      'def timer(func):',
      '    @wraps(func)',
      '    def wrapper(*args, **kwargs):',
      '        start = time.perf_counter()',
      '        result = func(*args, **kwargs)',
      '        cost = time.perf_counter() - start',
      '        print(f"{func.__name__} 耗时 {cost:.4f}s")',
      '        return result',
      '    return wrapper',
      '',
      '@timer',
      'def slow_sum(n):',
      '    return sum(i * i for i in range(n))',
      '',
      'slow_sum(1_000_000)',
    ].join('\n'),
  },
  {
    label: 'Python · 有安全隐患',
    code: [
      'def find_user(username):',
      '    sql = "SELECT * FROM users WHERE name = \'" + username + "\'"',
      '    cursor.execute(sql)',
      '    return cursor.fetchone()',
    ].join('\n'),
  },
]

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
 * 必须 await nextTick()：刚写进 output.value，DOM 还没更新，
 * 这时候读 scrollHeight 拿到的是旧值。
 */
async function scrollOutputToBottom() {
  if (!followTail) return
  await nextTick()
  const box = outputBoxRef.value
  if (box) box.scrollTop = box.scrollHeight
}

async function analyze() {
  if (loading.value || !code.value.trim()) return

  output.value = ''
  errorMsg.value = ''
  sources.value = []
  loading.value = true
  done.value = false
  followTail = true // 新一轮解析，重新开始跟随

  controller = new AbortController()

  // 小屏是上下堆叠布局：输入区在上、结果区在下，点完按钮结果还在屏幕外，
  // 用户会以为"点了没反应"。桌面端是左右两栏、结果就在旁边，不需要滚。
  if (window.matchMedia('(max-width: 1023px)').matches) {
    nextTick(() => {
      resultRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
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

    // 逐块读取，读一块、显示一块 —— 这就是打字机效果的来源
    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      output.value += decoder.decode(value, { stream: true })
      await scrollOutputToBottom()
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
      <section
        class="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:h-[calc(100vh-200px)] lg:min-h-[420px] lg:overflow-hidden"
      >
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <span class="text-sm text-slate-500">示例：</span>
          <button
            v-for="s in SAMPLES"
            :key="s.label"
            class="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:border-emerald-500 hover:text-emerald-600"
            @click="code = s.code"
          >
            {{ s.label }}
          </button>
        </div>

        <textarea
          v-model="code"
          spellcheck="false"
          :maxlength="CODE_MAX"
          placeholder="把你想看懂的代码粘贴到这里，然后点下面的按钮。&#10;不需要写任何提示词。"
          class="font-mono-code min-h-[200px] flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-base leading-relaxed text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white sm:min-h-[280px] sm:text-sm lg:min-h-0"
        />

        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span
            class="text-xs tabular-nums transition-colors"
            :class="code.length >= CODE_WARN_AT ? 'font-medium text-amber-600' : 'text-slate-400'"
          >
            {{ code.length }} / {{ CODE_MAX }}
            <template v-if="code.length >= CODE_WARN_AT">· 接近上限，建议只贴关键片段</template>
          </span>
          <div class="flex gap-2">
            <button
              class="rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
              @click="clearAll"
            >
              清空
            </button>
            <button
              v-if="!loading"
              class="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!code.trim()"
              @click="analyze"
            >
              开始解析
            </button>
            <button
              v-else
              class="rounded-lg border border-rose-300 px-5 py-2.5 text-sm text-rose-600 transition hover:bg-rose-50"
              @click="stop"
            >
              停止
            </button>
          </div>
        </div>
      </section>

      <!-- 右：输出 -->
      <section
        ref="resultRef"
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
          <div
            v-if="errorMsg"
            class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {{ errorMsg }}
          </div>

          <!-- 空状态 -->
          <div v-else-if="isEmpty" class="flex h-full items-center justify-center px-6 text-center">
            <p class="text-sm leading-relaxed text-slate-400">
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
              <MarkdownBlock :text="s.body" />
            </article>

            <!-- 知识库检索到的引用来源，紧跟在四段解释之后 -->
            <SourceList v-if="sources.length" :sources="sources" />

            <span v-if="loading" class="inline-block h-4 w-2 animate-pulse bg-emerald-500" />
          </div>
        </div>
      </section>
    </main>

    <!--
      知识框架图
      这个区域**始终存在**（不用 v-if）：没数据时显示占位提示。
      好处是图出现时页面不会突然跳高，用户一进来也知道这里会有东西。
    -->
    <section class="mx-auto w-full max-w-[1400px] px-4 pb-4 sm:px-6 sm:pb-6">
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span class="text-sm text-slate-500">知识框架图</span>
          <div class="flex items-center gap-3 text-[11px] text-slate-500">
            <span class="inline-flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-sm bg-emerald-500" />代码
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-sm bg-blue-500" />技术
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-sm bg-amber-500" />概念
            </span>
          </div>
          <span class="text-[11px] text-slate-400">可拖拽节点 · 滚轮 / 双指缩放</span>
        </div>

        <div class="h-[300px] sm:h-[400px]">
          <GraphView v-if="graphData" :data="graphData" />

          <div
            v-else
            class="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-6 text-center"
          >
            <p class="text-sm leading-relaxed text-slate-400">
              解析完成后，这里会画出这段代码的知识框架图<br />
              <span class="text-[13px]">
                节点分三类：
                <span class="text-emerald-600">代码</span>、
                <span class="text-blue-600">技术</span>、
                <span class="text-amber-600">概念</span>
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>

    <footer class="shrink-0 px-4 pb-4 text-center text-xs text-slate-400 sm:px-6 sm:pb-6">
      麦穗团队 · 传智杯 AI Web 开发挑战赛
    </footer>
  </div>
</template>
