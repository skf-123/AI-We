<script setup lang="ts">
/**
 * M0 主页面：贴代码 → 自动出四段解析。
 *
 * 这一版刻意保持很"窄"：没有知识框架图、没有伪视频、没有截图上传。
 * 目的只有一个 —— 把「零提示词 → 流式输出」这条主路打通、能演示。
 * 后面每一项都是在这条路上加挂件，而不是另起一条路。
 */

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

async function analyze() {
  if (loading.value || !code.value.trim()) return

  output.value = ''
  errorMsg.value = ''
  sources.value = []
  loading.value = true
  done.value = false

  controller = new AbortController()

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
  <div class="min-h-screen bg-[#0b1020] text-slate-200">
    <!-- 顶栏 -->
    <header class="border-b border-white/10 px-6 py-4">
      <div class="mx-auto flex max-w-[1400px] items-center justify-between">
        <div class="flex items-baseline gap-3">
          <h1 class="text-lg font-semibold tracking-wide text-white">麦穗 · 代码理解助手</h1>
          <span class="text-xs text-slate-500">WheatBend</span>
        </div>
        <span class="hidden text-xs text-slate-500 sm:block">
          贴代码 · 不用提问 · 自动讲解
        </span>
      </div>
    </header>

    <main class="mx-auto grid max-w-[1400px] gap-5 px-6 py-6 lg:grid-cols-2">
      <!-- 左：输入 -->
      <section class="flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <span class="text-sm text-slate-400">示例：</span>
          <button
            v-for="s in SAMPLES"
            :key="s.label"
            class="rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-300 transition hover:border-emerald-400/50 hover:text-emerald-300"
            @click="code = s.code"
          >
            {{ s.label }}
          </button>
        </div>

        <textarea
          v-model="code"
          spellcheck="false"
          placeholder="把你想看懂的代码粘贴到这里，然后点下面的按钮。&#10;不需要写任何提示词。"
          class="font-mono-code min-h-[380px] flex-1 resize-y rounded-lg border border-white/10 bg-black/40 p-3 text-sm leading-relaxed text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-emerald-400/50"
        />

        <div class="mt-3 flex items-center justify-between">
          <span class="text-xs text-slate-600">{{ code.length }} 字符</span>
          <div class="flex gap-2">
            <button
              class="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5"
              @click="clearAll"
            >
              清空
            </button>
            <button
              v-if="!loading"
              class="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!code.trim()"
              @click="analyze"
            >
              开始解析
            </button>
            <button
              v-else
              class="rounded-lg border border-rose-400/40 px-5 py-2 text-sm text-rose-300 transition hover:bg-rose-500/10"
              @click="stop"
            >
              停止
            </button>
          </div>
        </div>
      </section>

      <!-- 右：输出 -->
      <section class="flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div class="mb-3 flex items-center gap-2">
          <span class="text-sm text-slate-400">解析结果</span>
          <span
            v-if="loading"
            class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300"
          >
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            正在解析
          </span>
          <span
            v-else-if="done && !errorMsg"
            class="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400"
          >
            已完成
          </span>
        </div>

        <div class="min-h-[420px] flex-1 overflow-y-auto pr-1">
          <!-- 出错 -->
          <div
            v-if="errorMsg"
            class="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200"
          >
            {{ errorMsg }}
          </div>

          <!-- 空状态 -->
          <div v-else-if="isEmpty" class="flex h-full items-center justify-center px-6 text-center">
            <p class="text-sm leading-relaxed text-slate-600">
              左边粘贴代码，点「开始解析」。<br />
              这里会依次出现：逐词逐句 → 局部关系 → 整段作用 → 技术溯源。
            </p>
          </div>

          <!-- 流式渲染的四段 -->
          <div v-else class="space-y-4">
            <article
              v-for="s in sections"
              :key="s.title"
              class="rounded-lg border border-white/5 bg-black/20 p-3.5"
            >
              <h2 class="mb-2 text-sm font-semibold text-emerald-300">{{ s.title }}</h2>
              <p class="whitespace-pre-wrap text-sm leading-7 text-slate-300">{{ s.body }}</p>
            </article>

            <!-- 知识库检索到的引用来源，紧跟在四段解释之后 -->
            <SourceList v-if="sources.length" :sources="sources" />

            <span v-if="loading" class="inline-block h-4 w-2 animate-pulse bg-emerald-400" />
          </div>
        </div>
      </section>
    </main>

    <!-- 知识框架图：等 AI 把 JSON 流完之后自动出现 -->
    <section v-if="graphData" class="mx-auto max-w-[1400px] px-6 pb-2">
      <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span class="text-sm text-slate-400">知识框架图</span>
          <div class="flex items-center gap-3 text-[11px] text-slate-500">
            <span class="inline-flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-sm bg-emerald-400" />代码
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-sm bg-blue-400" />技术
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-sm bg-amber-400" />概念
            </span>
          </div>
          <span class="text-[11px] text-slate-600">可拖拽节点 · 滚轮缩放</span>
        </div>

        <GraphView :data="graphData" />
      </div>
    </section>

    <footer class="px-6 pb-6 text-center text-xs text-slate-600">
      麦穗团队 · 传智杯 AI Web 开发挑战赛 · M0
    </footer>
  </div>
</template>
