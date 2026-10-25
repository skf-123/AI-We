<script setup lang="ts">
/**
 * 只读的 token 用量页（开发期默认可用）。
 *
 * 数据来自本机 logs/llm-usage.jsonl；页面只展示汇总，不展示代码或提示词。
 */

interface UsageSummary {
  feature: string
  calls: number
  prompt: number
  completion: number
  total: number
  avgMs: number
  missing: number
}

interface UsageSession {
  id: string
  name: string
  savedAt: string
  startedAt: string | null
  endedAt: string | null
  calls: number
  total: number
}

interface UsageResponse {
  summaries: UsageSummary[]
  total: { calls: number; prompt: number; completion: number; total: number }
  last: { ts?: string; feature?: string } | null
  file: string
  selected: string | null
  sessions: UsageSession[]
  current: { calls: number; total: number }
  enabledInProduction: boolean
}

/** 每个 feature 的中文名、具体板块和当前代码里的上限 */
interface FeatureInfo {
  label: string
  detail: string
  limit: string
  /** 这个功能的单次输出上限 token；没有就按不适用处理 */
  outputLimit?: number
  /** 只有和别的请求/轮次/前缀共享上下文时才写；独立请求不标记 */
  context?: { label: string; detail: string }
}

const FEATURES: Record<string, FeatureInfo> = {
  'code/analyze': {
    label: '贴代码主链路',
    detail: '五段讲解：逐词逐句 → 局部关系 → 整段作用 → 技术溯源 → 知识框架图；带知识库引用',
    limit: '输入 ≤20,000 字符；输出 ≤100,000 token；检索 topK 4、阈值 0.38',
    outputLimit: 100_000,
  },
  'code/ask': {
    label: '贴代码追问',
    detail: '选中解析结果里的一段代码就地提问，可多轮',
    limit:
      '代码 ≤50,000 字符；选中 ≤2,000；刚生成的解析 ≤20,000；问题 ≤500；历史 ≤100,000 token；输出 ≤5,000 token',
    outputLimit: 5_000,
    context: {
      label: '多轮历史（前端重发）',
      detail: '每问一次是独立请求，服务端不存会话；历史由前端在每次请求里重新带上',
    },
  },
  'project/analyze': {
    label: '项目模式 · 逐文件四段解析',
    detail: '每个文件一次请求：逐词逐句 → 局部关系 → 整段作用 → 技术溯源；带项目结构结论与按文件检索',
    limit:
      '单文件 ≤50,000 字符；项目结构结论 ≤50,000；输出 ≤10,000 token；并发池 h1=5 / h2=100',
    outputLimit: 10_000,
    context: {
      label: '共用项目前缀',
      detail: '每个文件是独立请求，但都带同一份项目结构结论作为公共前缀，用于前缀缓存；不是同一段对话',
    },
  },
  'project/summary': {
    label: '项目模式 · 项目总览 + 项目图',
    detail: '一次请求同时写正文和唯一一张项目图；正文和图共用一个输出上限',
    limit:
      '结构结论 ≤50,000 字符；目录树 ≤200,000；文件 ≤2,000 个；输出 ≤300,000 token（正文和图共用）；超时 120 秒',
    outputLimit: 300_000,
    context: {
      label: '与项目图同一请求',
      detail: '项目总览正文和项目图 JSON 在同一次请求里生成，共用一个上下文和同一个 300,000 输出上限',
    },
  },
  'project/graph': {
    label: '项目模式 · 只重画项目图',
    detail: '不重跑正文，沿用上次汇总冻结的输入，只生成图 JSON',
    limit:
      '结构结论 ≤50,000 字符；目录树 ≤200,000；正文 ≤20,000；输出 ≤300,000 token；超时 120 秒',
    outputLimit: 300_000,
    context: {
      label: '沿用汇总输入',
      detail: '独立请求，不共享请求状态；只沿用上次汇总冻结的项目结构结论、目录树和文件清单',
    },
  },
  'project/agent:map': {
    label: '项目模式 · 地图侦查 Agent',
    detail: '解析前读目录、配置和关键文件，产出项目结构结论、跨文件线索和证据',
    limit:
      '最多 min(待解析文件数, 100) 轮；每轮输出 ≤50,000 token；消息 ≤10,000 条；工具调用 ≤20 个/轮；上下文 1.4M / 1.5M 字符；超时 90 秒/轮；5 个只读工具',
    outputLimit: 50_000,
    context: {
      label: '多轮共用对话',
      detail: '整段侦查的多轮工具调用共用同一个对话上下文，消息逐轮累积；和图自检、其他功能不共享',
    },
  },
  'project/agent:self-check': {
    label: '项目模式 · 图自检 Agent',
    detail: '图生成后检查浮着的节点、分组到分组的边、写反或编造的关系；可读文件确认',
    limit:
      '最多 min(待解析文件数, 100) 轮；整段不设固定次数上限（每轮最多 20 个）；消息 ≤10,000 条；每轮输出 ≤50,000 token；上下文 1.4M / 1.5M 字符；超时 90 秒/轮',
    outputLimit: 50_000,
    context: {
      label: '多轮共用对话',
      detail: '图自检的多轮工具调用共用同一个对话上下文，消息逐轮累积；和地图侦查、其他功能不共享',
    },
  },
  'project/map': {
    label: '项目模式 · 固定地图回退',
    detail: 'Agent 失败时，用目录树 + 每个文件头部几行生成目录说明和项目结构结论',
    limit: '目录树 ≤200,000 字符；文件头 ≤2,000 个；输出 ≤4,096 token；超时 60 秒',
    outputLimit: 4_096,
  },
  'project/vendor-review': {
    label: '项目模式 · 第三方库复核',
    detail: '对规则拿不准的疑似第三方库文件做一次小评审，只给建议，不自动勾选',
    limit: '输出 ≤1,536 token；超时 30 秒',
    outputLimit: 1_536,
  },
  'project/include-hint': {
    label: '项目模式 · 勾选系统文件前的说明',
    detail: '点选系统文件时用一两句话说明为什么默认不勾、勾了会占什么预算',
    limit: '输出 ≤160 token；超时 20 秒',
    outputLimit: 160,
  },
  'rag/embedding': {
    label: '知识库 · 向量化',
    detail: '把代码或检索问题变成向量，供知识库检索；与生成模型是两家服务',
    limit: '单次 ≤64 条；1024 维；查询超时 3 秒；检索 topK 4、阈值 0.38',
  },
}

function featureInfo(key: string): FeatureInfo {
  return FEATURES[key] ?? { label: key, detail: '未登记的中文说明', limit: '—' }
}

const data = ref<UsageResponse | null>(null)
const error = ref('')
const pending = ref(false)
const actionPending = ref(false)
const notice = ref('')
const selected = ref('')
const name = ref('')

const sessions = computed(() => data.value?.sessions ?? [])
const rows = computed(() => data.value?.summaries ?? [])
const current = computed(() => data.value?.current ?? { calls: 0, total: 0 })
const selectedSession = computed(
  () => sessions.value.find((item) => item.id === selected.value) ?? null,
)

async function load(sessionId = ''): Promise<void> {
  pending.value = true
  error.value = ''
  try {
    const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''
    data.value = await $fetch<UsageResponse>(`/api/usage${query}`)
    selected.value = data.value.selected ?? ''
  } catch {
    data.value = null
    error.value = '读不到用量数据。开发期默认开放；生产环境要设置 NUXT_USAGE_PAGE=1。'
  } finally {
    pending.value = false
  }
}

onMounted(() => {
  void load()
})

async function saveCurrent(): Promise<void> {
  if (actionPending.value) return
  if (current.value.calls === 0) {
    notice.value = '当前没有记录，先跑一次功能再保留'
    return
  }

  actionPending.value = true
  error.value = ''
  try {
    const res = await $fetch<{ session: { id: string; name: string } }>('/api/usage/save', {
      method: 'POST',
      body: { name: name.value },
    })
    name.value = ''
    await load(res.session.id)
    notice.value = `已保留「${res.session.name}」；当前记录从 0 重新开始`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保留失败'
  } finally {
    actionPending.value = false
  }
}

async function removeSelected(): Promise<void> {
  if (!selectedSession.value || actionPending.value) return
  if (!window.confirm(`删除保留记录「${selectedSession.value.name}」？删除后不能恢复。`)) return

  actionPending.value = true
  error.value = ''
  try {
    await $fetch(`/api/usage/session/${encodeURIComponent(selectedSession.value.id)}`, {
      method: 'DELETE',
    })
    await load()
    notice.value = '保留记录已删除'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  } finally {
    actionPending.value = false
  }
}

async function clearCurrentRecords(): Promise<void> {
  if (actionPending.value) return
  if (!window.confirm('清空当前记录？不会生成保留文件，清空后不能恢复。')) return

  actionPending.value = true
  error.value = ''
  try {
    await $fetch('/api/usage/clear', { method: 'POST' })
    await load()
    notice.value = '当前记录已清空'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '清空失败'
  } finally {
    actionPending.value = false
  }
}

function onSelectSession(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void load(value)
}

/**
 * 所有登记过的功能都列出来；还没有调用记录的补 0。
 * 这样即使刚打开页面，也能看到每个功能的中文名和上限。
 */
function makeTableRow(feature: string, row?: UsageSummary) {
  const calls = row?.calls ?? 0
  const total = row?.total ?? 0
  const completion = row?.completion ?? 0
  const info = featureInfo(feature)

  return {
    feature,
    calls,
    prompt: row?.prompt ?? 0,
    completion,
    total,
    avgMs: row?.avgMs ?? 0,
    missing: row?.missing ?? 0,
    avgTotal: calls ? total / calls : 0,
    avgCompletion: calls ? completion / calls : 0,
    pct1m: calls ? `${(((total / calls) / 1_000_000) * 100).toFixed(2)}%` : '—',
    pctOutput:
      calls && info.outputLimit
        ? `${(((completion / calls) / info.outputLimit) * 100).toFixed(2)}%`
        : '—',
    info,
  }
}

const tableRows = computed(() => {
  const byFeature = new Map(rows.value.map((row) => [row.feature, row]))
  const known = Object.keys(FEATURES).map((feature) => makeTableRow(feature, byFeature.get(feature)))
  const unknown = rows.value
    .filter((row) => !FEATURES[row.feature])
    .map((row) => makeTableRow(row.feature, row))

  return [...known, ...unknown].sort((a, b) => b.total - a.total)
})

function statsOf(row: ReturnType<typeof makeTableRow>): { label: string; value: string }[] {
  return [
    { label: '调用次数', value: num(row.calls) },
    { label: '输入 token', value: num(row.prompt) },
    { label: '输出 token', value: num(row.completion) },
    { label: '合计 token', value: num(row.total) },
    { label: '平均每次', value: num(Math.round(row.avgTotal)) },
    { label: '占 1M', value: row.pct1m },
    { label: '占输出上限', value: row.pctOutput },
    { label: '平均耗时', value: `${num(row.avgMs)} ms` },
    { label: '缺 usage', value: num(row.missing) },
  ]
}
const total = computed(() => data.value?.total ?? { calls: 0, prompt: 0, completion: 0, total: 0 })
const last = computed(() => data.value?.last ?? null)
const lastText = computed(() => {
  if (!last.value?.ts) return '还没有记录'
  const time = new Date(last.value.ts).toLocaleString('zh-CN')
  return `${time} · ${last.value.feature ?? ''}`
})

function num(value: number): string {
  return value.toLocaleString('zh-CN')
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN')
}

function formatRange(session: UsageSession): string {
  const start = session.startedAt ? formatTime(session.startedAt) : '—'
  const end = session.endedAt ? formatTime(session.endedAt) : '—'
  return `${start} → ${end}`
}
</script>

<template>
  <div class="min-h-dvh bg-[#f5f6f8] text-slate-800">
    <main class="w-full px-4 py-6 sm:px-6">
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <h1 class="text-lg font-semibold">Token 用量</h1>
        <p class="text-xs text-slate-400">只统计本机 logs/llm-usage.jsonl</p>
        <div class="ml-auto flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            :disabled="pending"
            @click="load(selected)"
          >
            {{ pending ? '刷新中…' : '刷新' }}
          </button>
          <NuxtLink
            to="/"
            class="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
          >
            返回首页
          </NuxtLink>
        </div>
      </div>

      <div
        class="mb-4 rounded-xl border border-slate-200 bg-white p-3"
      >
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1 text-[11px] text-slate-500">
            查看
            <select
              :value="selected"
              class="min-w-[260px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
              @change="onSelectSession"
            >
              <option value="">当前（未保留）</option>
              <option v-for="session in sessions" :key="session.id" :value="session.id">
                {{ session.name }} · {{ formatRange(session) }} · {{ session.calls }} 次
              </option>
            </select>
          </label>

          <label class="flex flex-col gap-1 text-[11px] text-slate-500">
            保留当前记录，命名
            <input
              v-model="name"
              type="text"
              maxlength="40"
              placeholder="例如：187 文件第一次"
              class="w-[260px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
            />
          </label>

          <button
            type="button"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            :disabled="actionPending || current.calls === 0"
            @click="saveCurrent"
          >
            保留当前记录
          </button>

          <button
            v-if="selectedSession"
            type="button"
            class="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300"
            :disabled="actionPending"
            @click="removeSelected"
          >
            删除这条保留记录
          </button>
          <button
            v-else
            type="button"
            class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            :disabled="actionPending || current.calls === 0"
            @click="clearCurrentRecords"
          >
            清空当前
          </button>
        </div>

        <p class="mt-2 text-[11px] text-slate-500">
          当前未保留：{{ current.calls }} 次调用 · {{ num(current.total) }} token
          <template v-if="selectedSession"> · 正在看：{{ selectedSession.name }}</template>
        </p>
        <p v-if="selectedSession" class="mt-1 text-[11px] text-slate-500">
          这段记录的时间段：{{ formatRange(selectedSession) }}
        </p>
        <p v-if="notice" class="mt-1 text-[11px] text-emerald-700">{{ notice }}</p>
      </div>

      <div v-if="error" class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {{ error }}
      </div>

      <template v-else>
        <div class="mb-4 grid gap-3 sm:grid-cols-4">
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-[11px] text-slate-400">调用次数</p>
            <p class="mt-1 text-xl font-semibold">{{ num(total.calls) }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-[11px] text-slate-400">输入 token</p>
            <p class="mt-1 text-xl font-semibold">{{ num(total.prompt) }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-[11px] text-slate-400">输出 token</p>
            <p class="mt-1 text-xl font-semibold">{{ num(total.completion) }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-[11px] text-slate-400">合计 token</p>
            <p class="mt-1 text-xl font-semibold">{{ num(total.total) }}</p>
          </div>
        </div>

        <p
          v-if="rows.length === 0"
          class="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-700"
        >
          还没有调用记录。下面是全部功能和当前上限；正常用一次前端后，再回来刷新就能看到 token。
        </p>

        <div class="space-y-2">
          <section
            v-for="row in tableRows"
            :key="row.feature"
            class="rounded-xl border border-slate-200 bg-white p-3"
          >
            <div class="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-xs font-semibold text-slate-800">{{ row.info.label }}</h2>
                  <span
                    v-if="row.info.context"
                    class="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700"
                  >
                    {{ row.info.context.label }}
                  </span>
                </div>
                <p class="mt-0.5 text-[10.5px] leading-relaxed text-slate-500">
                  {{ row.info.detail }}
                </p>
                <p class="mt-0.5 font-mono text-[10px] text-slate-400">{{ row.feature }}</p>
                <p
                  v-if="row.info.context"
                  class="mt-1 text-[10px] leading-relaxed text-slate-500"
                >
                  {{ row.info.context.detail }}
                </p>
              </div>
              <div class="w-full text-[10.5px] leading-relaxed text-slate-500 sm:w-[380px]">
                <span class="text-slate-400">限制：</span>{{ row.info.limit }}
              </div>
            </div>

            <div
              class="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2 sm:grid-cols-4 lg:grid-cols-9"
            >
              <div v-for="stat in statsOf(row)" :key="stat.label">
                <p class="text-[10px] text-slate-400">{{ stat.label }}</p>
                <p class="text-xs font-medium text-slate-700">{{ stat.value }}</p>
              </div>
            </div>
          </section>
        </div>

        <p class="mt-3 text-[11px] leading-relaxed text-slate-500">
          百分比按平均每次调用算：项目总览和项目图共用一次请求，合在一起算；Agent 每轮一次请求，上下文随轮次增长；embedding 没有输出上限，占输出上限显示 —。
        </p>

        <details class="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-[11px] leading-relaxed text-slate-600">
          <summary class="cursor-pointer select-none text-slate-500">上下文标记怎么算</summary>
          <ul class="mt-2 space-y-1">
            <li>与项目图同一请求：项目总览（正文和图 JSON 一次生成，共用一个上下文）。</li>
            <li>多轮共用对话：地图侦查、图自检（各自多轮累积，互不共享）。</li>
            <li>共用项目前缀：逐文件解析（每个文件独立请求，但都带同一份项目结构结论）。</li>
            <li>沿用汇总输入：只重画图（独立请求，沿用上次汇总冻结的数据）。</li>
            <li>多轮历史（前端重发）：贴代码追问（服务端不存会话）。</li>
            <li>其他功能是独立请求，不标记。</li>
          </ul>
        </details>

        <p class="mt-3 text-[11px] text-slate-400">最近一次：{{ lastText }}</p>
      </template>
    </main>
  </div>
</template>
