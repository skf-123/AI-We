<script setup lang="ts">
/**
 * 访问统计（只读）。
 *
 * 数据来自 Caddy 的 access.log；页面和 /api/admin/traffic 都由服务器上的
 * Caddy Basic Auth 保护，站点导航里不放入口。
 */

interface TrafficRecord {
  ts: number
  time: string
  ip: string
  method: string
  path: string
  status: number
  durationMs: number
  ua: string
  host: string
  proto: string
}

interface IpRow {
  ip: string
  count: number
  first: string
  last: string
}

interface PathRow {
  path: string
  count: number
}

interface TrafficResponse {
  available: boolean
  message?: string
  generatedAt: string
  windowHours: number
  total: number
  uniqueIps: number
  errorCount: number
  excludedOwn: number
  records: TrafficRecord[]
  byIp: IpRow[]
  byPath: PathRow[]
}

interface DeepSeekBalance {
  usingOwnKey: boolean
  isAvailable: boolean
  balances: {
    currency: string
    total: string
    granted: string
    toppedUp: string
  }[]
}

interface ZhipuBalance {
  usingOwnKey: boolean
  currency: string
  balance: string
  availableBalance: string
}

useHead({
  title: '访问统计 · 麦穗',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
})

const data = ref<TrafficResponse | null>(null)
const loading = ref(false)
const error = ref('')
const rangeHours = ref(24)
const autoRefresh = ref(true)
const excludeOwn = ref(true)
const ipQuery = ref('')
const pathQuery = ref('')
const deepseekBalance = ref<DeepSeekBalance | null>(null)
const zhipuBalance = ref<ZhipuBalance | null>(null)
const balanceLoading = ref(false)
const balanceError = ref('')
const balanceUpdatedAt = ref('')

let timer: ReturnType<typeof setInterval> | undefined

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    // 如果用户把账号密码写进了地址栏，fetch 会拒绝带 credentials 的 URL；
    // 这里把 URL 里的账号密码去掉，Basic Auth 仍由浏览器缓存的凭据负责。
    const endpoint = new URL('/api/admin/traffic', window.location.href)
    endpoint.username = ''
    endpoint.password = ''
    data.value = await $fetch<TrafficResponse>(endpoint.toString(), {
      query: {
        hours: rangeHours.value,
        limit: 500,
        excludeOwn: excludeOwn.value ? 1 : 0,
      },
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '读取访问日志失败'
  } finally {
    loading.value = false
  }
}

async function loadBalances(): Promise<void> {
  balanceLoading.value = true
  balanceError.value = ''
  const [deepseek, zhipu] = await Promise.allSettled([
    $fetch<DeepSeekBalance>('/api/settings/balance'),
    $fetch<ZhipuBalance>('/api/settings/embedding-balance'),
  ])
  if (deepseek.status === 'fulfilled') {
    deepseekBalance.value = deepseek.value
  } else {
    balanceError.value = 'DeepSeek 余额查询失败'
  }
  if (zhipu.status === 'fulfilled') {
    zhipuBalance.value = zhipu.value
  } else {
    balanceError.value = balanceError.value
      ? `${balanceError.value}；智谱余额查询失败`
      : '智谱余额查询失败'
  }
  balanceUpdatedAt.value = new Date().toISOString()
  balanceLoading.value = false
}

async function refreshAll(): Promise<void> {
  await Promise.all([load(), loadBalances()])
}

onMounted(() => {
  void refreshAll()
  timer = setInterval(() => {
    if (autoRefresh.value) void load()
  }, 10_000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

watch([rangeHours, excludeOwn], () => {
  void load()
})

const filteredRecords = computed(() => {
  const ip = ipQuery.value.trim().toLowerCase()
  const path = pathQuery.value.trim().toLowerCase()
  return (data.value?.records ?? []).filter((record) => {
    if (ip && !record.ip.toLowerCase().includes(ip)) return false
    if (path && !record.path.toLowerCase().includes(path)) return false
    return true
  })
})

const filteredByIp = computed(() => {
  const ip = ipQuery.value.trim().toLowerCase()
  return (data.value?.byIp ?? []).filter((row) => !ip || row.ip.toLowerCase().includes(ip))
})

const topPath = computed(() => data.value?.byPath[0] ?? null)
const lastSeen = computed(() => data.value?.records[0]?.time ?? '')
const deepseekRow = computed(() => deepseekBalance.value?.balances[0] ?? null)
const zhipuAmount = computed(
  () => zhipuBalance.value?.availableBalance || zhipuBalance.value?.balance || '—',
)

function formatMoney(value: string): string {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(2) : value
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  })
}

function statusClass(status: number): string {
  if (status >= 500) return 'bg-rose-50 text-rose-700'
  if (status >= 400) return 'bg-amber-50 text-amber-700'
  if (status >= 300) return 'bg-sky-50 text-sky-700'
  return 'bg-emerald-50 text-emerald-700'
}

function methodClass(method: string): string {
  if (method === 'POST') return 'bg-violet-50 text-violet-700'
  if (method === 'GET') return 'bg-slate-100 text-slate-600'
  return 'bg-sky-50 text-sky-700'
}
</script>

<template>
  <div class="min-h-dvh bg-[#f5f6f8] text-slate-800">
    <main class="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <div class="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <p class="text-[11px] uppercase tracking-[0.18em] text-slate-400">Admin</p>
          <h1 class="mt-1 text-xl font-semibold">访问统计</h1>
          <p class="mt-1 text-xs text-slate-500">只读 Caddy 访问日志，不展示请求正文或代码内容。</p>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-1.5 text-xs text-slate-500">
            <input v-model="autoRefresh" type="checkbox" class="accent-emerald-600" />
            自动刷新
          </label>
          <button
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs transition"
            :class="
              excludeOwn
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            "
            :aria-pressed="excludeOwn"
            @click="excludeOwn = !excludeOwn"
          >
            {{ excludeOwn ? '已省略我们的访问' : '显示全部访问' }}
          </button>
          <select
            v-model.number="rangeHours"
            class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          >
            <option :value="1">最近 1 小时</option>
            <option :value="24">最近 24 小时</option>
            <option :value="168">最近 7 天</option>
            <option :value="720">最近 30 天</option>
          </select>
          <button
            type="button"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            :disabled="loading || balanceLoading"
            @click="refreshAll"
          >
            {{ loading || balanceLoading ? '刷新中…' : '刷新' }}
          </button>
        </div>
      </div>

      <div v-if="error" class="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
        {{ error }}
      </div>

      <div
        v-if="data && !data.available"
        class="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-800"
      >
        {{ data.message }}
        <p class="mt-2 text-xs text-amber-700">
          确认 Caddy 已打开 access.log，并允许 aiweb 用户读取日志文件。
        </p>
      </div>

      <template v-else-if="data">
        <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-[11px] text-slate-400">请求数</p>
            <p class="mt-1 text-xl font-semibold">{{ data.total.toLocaleString('zh-CN') }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-[11px] text-slate-400">独立 IP</p>
            <p class="mt-1 text-xl font-semibold">{{ data.uniqueIps.toLocaleString('zh-CN') }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-[11px] text-slate-400">错误请求</p>
            <p class="mt-1 text-xl font-semibold">{{ data.errorCount.toLocaleString('zh-CN') }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-[11px] text-slate-400">最近访问</p>
            <p class="mt-1 text-sm font-medium">{{ formatTime(lastSeen) }}</p>
          </div>
        </div>

        <div class="mb-4 grid gap-3 sm:grid-cols-2">
          <div class="rounded-xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between gap-2">
              <div>
                <p class="text-[11px] text-slate-400">DeepSeek 默认 key</p>
                <p class="mt-1 text-lg font-semibold">
                  <template v-if="deepseekRow">
                    ¥ {{ formatMoney(deepseekRow.total) }}
                    <span class="text-xs font-normal text-slate-400">{{ deepseekRow.currency }}</span>
                  </template>
                  <span v-else class="text-sm font-normal text-slate-400">
                    {{ balanceLoading ? '查询中…' : '暂时查不到' }}
                  </span>
                </p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 transition hover:bg-slate-50 disabled:text-slate-300"
                :disabled="balanceLoading"
                @click="loadBalances"
              >
                刷新余额
              </button>
            </div>
            <p v-if="deepseekBalance && !deepseekBalance.isAvailable" class="mt-2 text-[11px] text-amber-600">
              账户当前不可用
            </p>
          </div>

          <div class="rounded-xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between gap-2">
              <div>
                <p class="text-[11px] text-slate-400">智谱默认 key</p>
                <p class="mt-1 text-lg font-semibold">
                  <template v-if="zhipuBalance">
                    ¥ {{ formatMoney(zhipuAmount) }}
                    <span class="text-xs font-normal text-slate-400">{{ zhipuBalance.currency }}</span>
                  </template>
                  <span v-else class="text-sm font-normal text-slate-400">
                    {{ balanceLoading ? '查询中…' : '暂时查不到' }}
                  </span>
                </p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-500 transition hover:bg-slate-50 disabled:text-slate-300"
                :disabled="balanceLoading"
                @click="loadBalances"
              >
                刷新余额
              </button>
            </div>
          </div>
        </div>

        <p v-if="balanceError" class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          {{ balanceError }}<span v-if="balanceUpdatedAt"> · {{ formatTime(balanceUpdatedAt) }}</span>
        </p>

        <div class="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <input
            v-model="ipQuery"
            type="search"
            placeholder="筛选 IP"
            class="w-[180px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-emerald-400"
          />
          <input
            v-model="pathQuery"
            type="search"
            placeholder="筛选路径，例如 /project"
            class="w-[240px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-emerald-400"
          />
          <span class="text-[11px] text-slate-400">
            当前显示 {{ filteredRecords.length }} 条；汇总按最近 {{ data.windowHours }} 小时计算
            <template v-if="excludeOwn && data.excludedOwn > 0">
              · 已省略我们的访问 {{ data.excludedOwn }} 条
            </template>
          </span>
          <span v-if="topPath" class="ml-auto text-[11px] text-slate-500">
            访问最多：{{ topPath.path }} · {{ topPath.count }} 次
          </span>
        </div>

        <div class="mb-4 grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <section class="rounded-xl border border-slate-200 bg-white p-3">
            <h2 class="mb-2 text-xs font-semibold text-slate-700">按 IP 汇总</h2>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-[11px]">
                <thead class="border-b border-slate-100 text-slate-400">
                  <tr>
                    <th class="py-1.5 pr-2 font-medium">IP</th>
                    <th class="py-1.5 pr-2 font-medium">次数</th>
                    <th class="py-1.5 pr-2 font-medium">首次</th>
                    <th class="py-1.5 font-medium">最后</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in filteredByIp.slice(0, 10)" :key="row.ip" class="border-b border-slate-50 last:border-0">
                    <td class="py-1.5 pr-2 font-mono text-slate-700">{{ row.ip || '—' }}</td>
                    <td class="py-1.5 pr-2">{{ row.count }}</td>
                    <td class="py-1.5 pr-2 text-slate-500">{{ formatTime(row.first) }}</td>
                    <td class="py-1.5 text-slate-500">{{ formatTime(row.last) }}</td>
                  </tr>
                  <tr v-if="filteredByIp.length === 0">
                    <td colspan="4" class="py-4 text-center text-slate-400">没有匹配的记录</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 bg-white p-3">
            <h2 class="mb-2 text-xs font-semibold text-slate-700">按路径汇总</h2>
            <div class="grid gap-1.5 sm:grid-cols-2">
              <div
                v-for="row in data.byPath.slice(0, 12)"
                :key="row.path"
                class="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px]"
              >
                <span class="min-w-0 flex-1 truncate font-mono text-slate-600">{{ row.path }}</span>
                <span class="shrink-0 text-slate-400">{{ row.count }}</span>
              </div>
            </div>
          </section>
        </div>

        <section class="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div class="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
            <h2 class="text-xs font-semibold text-slate-700">最近请求</h2>
            <span class="text-[10px] text-slate-400">时间按 Asia/Shanghai 显示；路径已去掉查询参数</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[980px] text-left text-[11px]">
              <thead class="border-b border-slate-100 bg-slate-50 text-slate-400">
                <tr>
                  <th class="px-3 py-2 font-medium">时间</th>
                  <th class="px-3 py-2 font-medium">IP</th>
                  <th class="px-3 py-2 font-medium">方法</th>
                  <th class="px-3 py-2 font-medium">路径</th>
                  <th class="px-3 py-2 font-medium">状态</th>
                  <th class="px-3 py-2 font-medium">耗时</th>
                  <th class="px-3 py-2 font-medium">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in filteredRecords" :key="`${row.ts}-${index}`" class="border-b border-slate-50 last:border-0">
                  <td class="whitespace-nowrap px-3 py-2 text-slate-500">{{ formatTime(row.time) }}</td>
                  <td class="whitespace-nowrap px-3 py-2 font-mono text-slate-700">{{ row.ip || '—' }}</td>
                  <td class="px-3 py-2">
                    <span :class="['rounded px-1.5 py-0.5 text-[10px]', methodClass(row.method)]">{{ row.method }}</span>
                  </td>
                  <td class="max-w-[320px] break-all px-3 py-2 font-mono text-slate-700">{{ row.path }}</td>
                  <td class="px-3 py-2">
                    <span :class="['rounded px-1.5 py-0.5 text-[10px]', statusClass(row.status)]">{{ row.status }}</span>
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-slate-500">{{ row.durationMs }} ms</td>
                  <td class="max-w-[300px] truncate px-3 py-2 text-slate-500" :title="row.ua">{{ row.ua || '—' }}</td>
                </tr>
                <tr v-if="filteredRecords.length === 0">
                  <td colspan="7" class="px-3 py-10 text-center text-slate-400">这段时间没有匹配的访问记录</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <p class="mt-3 text-[11px] text-slate-400">
          页面只读；日志保留和轮转由 Caddy 管理。最后读取：{{ formatTime(data.generatedAt) }}
        </p>
      </template>

      <div v-else-if="loading" class="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        正在读取访问日志…
      </div>
    </main>
  </div>
</template>
