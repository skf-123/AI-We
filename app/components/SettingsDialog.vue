<script setup lang="ts">
/**
 * 设置弹窗：默认用我们的 key；评委可以分别填自己的 DeepSeek key 和智谱 key。
 *
 * 两个 key 都只存当前标签页的 sessionStorage，关闭标签页就清空；
 * 请求时分别放在 x-llm-api-key 和 x-embedding-api-key 头里，服务端只在这一次请求里用。
 */
interface BalanceInfo {
  currency: string
  total: string
  granted: string
  toppedUp: string
}

interface BalanceResult {
  usingOwnKey: boolean
  isAvailable: boolean
  balances: BalanceInfo[]
}

interface EmbeddingBalanceResult {
  usingOwnKey: boolean
  currency: string
  balance: string
  availableBalance: string
}

interface SettingsInfo {
  provider: string
  model: string
  visionModel: string
  defaultKeyConfigured: boolean
  embedding: {
    provider: string
    model: string
    dimensions: number
    defaultKeyConfigured: boolean
  }
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const {
  key,
  embeddingKey,
  hasOwnKey,
  hasOwnEmbeddingKey,
  save,
  clear,
  saveEmbedding,
  clearEmbedding,
  syncFromStorage,
} = useLlmKey()

const draft = ref('')
const showKey = ref(false)
const embeddingDraft = ref('')
const showEmbeddingKey = ref(false)

const info = ref<SettingsInfo | null>(null)
const ourBalance = ref<BalanceResult | null>(null)
const ownBalance = ref<BalanceResult | null>(null)
const ourEmbeddingBalance = ref<EmbeddingBalanceResult | null>(null)
const ownEmbeddingBalance = ref<EmbeddingBalanceResult | null>(null)

const loadingOur = ref(false)
const loadingOwn = ref(false)
const loadingOurEmbedding = ref(false)
const loadingOwnEmbedding = ref(false)
const saving = ref(false)
const savingEmbedding = ref(false)

const errorMsg = ref('')
const notice = ref('')
const embeddingError = ref('')
const embeddingNotice = ref('')

function close() {
  emit('update:open', false)
}

function primaryBalance(result: BalanceResult | null): BalanceInfo | null {
  if (!result || result.balances.length === 0) return null
  return result.balances.find((item) => item.currency === 'CNY') ?? result.balances[0]!
}

function money(value: string): string {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(2) : value
}

function amountText(item: BalanceInfo | null): string {
  if (!item) return '—'
  return `${item.currency === 'CNY' ? '¥' : ''}${money(item.total)}${item.currency === 'CNY' ? '' : ' ' + item.currency}`
}

function embeddingAmountText(result: EmbeddingBalanceResult | null): string {
  if (!result) return '—'
  return `${result.currency === 'CNY' ? '¥' : ''}${money(result.availableBalance)}`
}

function errorText(err: unknown): string {
  const message = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
  return message || '请求失败，稍后再试'
}

async function loadInfo() {
  try {
    info.value = await $fetch<SettingsInfo>('/api/settings/info')
  } catch {
    info.value = null
  }
}

async function loadOurBalance() {
  loadingOur.value = true
  try {
    // 不带自定义 key，查的是我们自己的 DeepSeek 账户
    ourBalance.value = await $fetch<BalanceResult>('/api/settings/balance')
  } catch (err) {
    ourBalance.value = null
    errorMsg.value = errorText(err)
  } finally {
    loadingOur.value = false
  }
}

async function loadOurEmbeddingBalance() {
  loadingOurEmbedding.value = true
  try {
    // 不带自定义 key，查的是我们自己的智谱账户
    ourEmbeddingBalance.value = await $fetch<EmbeddingBalanceResult>(
      '/api/settings/embedding-balance',
    )
  } catch {
    ourEmbeddingBalance.value = null
  } finally {
    loadingOurEmbedding.value = false
  }
}

async function checkKey(value: string): Promise<BalanceResult> {
  return $fetch<BalanceResult>('/api/settings/balance', {
    headers: { 'x-llm-api-key': value },
  })
}

async function verifyEmbeddingKey(value: string): Promise<{ dimensions: number }> {
  return $fetch<{ dimensions: number }>('/api/settings/verify-embedding', {
    method: 'POST',
    headers: { 'x-embedding-api-key': value },
    body: {},
  })
}

async function onSave() {
  const value = draft.value.trim()
  if (!value) {
    errorMsg.value = '先填一个 key；想继续用我们的 key，点下面的“清除我的 key”。'
    return
  }

  saving.value = true
  errorMsg.value = ''
  notice.value = ''

  try {
    const result = await checkKey(value)
    save(value)
    ownBalance.value = result
    notice.value = '已保存。这个标签页里的请求会改用你的 key。'
  } catch (err) {
    errorMsg.value = errorText(err)
  } finally {
    saving.value = false
  }
}

function onClear() {
  clear()
  draft.value = ''
  ownBalance.value = null
  errorMsg.value = ''
  notice.value = '已清除，之后的请求改回我们的 key。'
}

async function queryOwnBalance() {
  if (!key.value || loadingOwn.value) return

  loadingOwn.value = true
  errorMsg.value = ''
  try {
    ownBalance.value = await checkKey(key.value)
  } catch (err) {
    errorMsg.value = errorText(err)
  } finally {
    loadingOwn.value = false
  }
}

async function onSaveEmbedding() {
  const value = embeddingDraft.value.trim()
  if (!value) {
    embeddingError.value = '先填一个智谱 key；想继续用我们的 key，点下面的“清除我的智谱 key”。'
    return
  }

  savingEmbedding.value = true
  embeddingError.value = ''
  embeddingNotice.value = ''

  try {
    const result = await verifyEmbeddingKey(value)
    saveEmbedding(value)
    embeddingNotice.value = `已验证通过（${result.dimensions} 维），之后的检索会用你的智谱 key。`
  } catch (err) {
    embeddingError.value = errorText(err)
    savingEmbedding.value = false
    return
  }

  savingEmbedding.value = false
  await queryOwnEmbeddingBalance()
}

function onClearEmbedding() {
  clearEmbedding()
  embeddingDraft.value = ''
  ownEmbeddingBalance.value = null
  embeddingError.value = ''
  embeddingNotice.value = '已清除，之后的检索改回我们的智谱 key。'
}

async function queryOwnEmbeddingBalance() {
  if (!embeddingKey.value || loadingOwnEmbedding.value) return

  loadingOwnEmbedding.value = true
  try {
    ownEmbeddingBalance.value = await $fetch<EmbeddingBalanceResult>(
      '/api/settings/embedding-balance',
      { headers: { 'x-embedding-api-key': embeddingKey.value } },
    )
  } catch {
    ownEmbeddingBalance.value = null
  } finally {
    loadingOwnEmbedding.value = false
  }
}

function onOpen() {
  syncFromStorage()
  draft.value = key.value
  embeddingDraft.value = embeddingKey.value
  ownBalance.value = null
  ownEmbeddingBalance.value = null
  errorMsg.value = ''
  notice.value = ''
  embeddingError.value = ''
  embeddingNotice.value = ''
  void loadInfo()
  void loadOurBalance()
  void loadOurEmbeddingBalance()
}

watch(
  () => props.open,
  (open) => {
    if (open) onOpen()
  },
)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4"
      @click.self="close"
    >
      <div
        class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div
          class="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6"
        >
          <div>
            <h2 id="settings-title" class="text-base font-semibold text-slate-900">设置</h2>
            <p class="mt-1 text-xs leading-relaxed text-slate-500">
              默认用我们的 key；你也可以填自己的 key，对全局生效。
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭设置"
            @click="close"
          >
            ✕
          </button>
        </div>

        <div class="space-y-5 px-5 py-5 sm:px-6">
          <div class="flex flex-wrap items-center gap-2 text-[11px]">
            <span class="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              DeepSeek：{{ info?.model || 'deepseek-chat' }}
            </span>
            <span class="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
              智谱：{{ info?.embedding.model || 'embedding-3' }} ·
              {{ info?.embedding.dimensions || 1024 }} 维
            </span>
            <span class="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
              默认 key：{{ info?.defaultKeyConfigured ? '已配置（只读）' : '未配置' }}
            </span>
          </div>

          <!-- DeepSeek：生成与识图 -->
          <section class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs font-medium text-slate-500">DeepSeek · 默认 key 的余额</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {{ amountText(primaryBalance(ourBalance)) }}
                </p>
                <p v-if="ourBalance && !ourBalance.isAvailable" class="mt-1 text-xs text-rose-600">
                  余额不足，调用会被拒绝
                </p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                :disabled="loadingOur"
                @click="loadOurBalance"
              >
                {{ loadingOur ? '查询中…' : '刷新' }}
              </button>
            </div>
            <p class="text-[11px] leading-relaxed text-slate-400">用于解析、追问和截图识别。</p>

            <div class="flex items-center justify-between gap-2 pt-1">
              <h3 class="text-sm font-semibold text-slate-800">你的 DeepSeek key（可选）</h3>
              <span
                class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="
                  hasOwnKey ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                "
              >
                {{ hasOwnKey ? '当前：你的 key' : '当前：我们的 key' }}
              </span>
            </div>

            <div class="flex items-center gap-2">
              <input
                v-model="draft"
                :type="showKey ? 'text' : 'password'"
                autocomplete="off"
                spellcheck="false"
                placeholder="sk-…（对全局生效）"
                class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none transition focus:border-emerald-500"
              />
              <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 transition hover:bg-slate-50"
                @click="showKey = !showKey"
              >
                {{ showKey ? '隐藏' : '显示' }}
              </button>
            </div>

            <p class="text-[11px] leading-relaxed text-slate-400">
              不写服务器、不进日志。填了之后，解析、追问、截图识别和项目分析都会用你的 key。
            </p>

            <p
              v-if="errorMsg"
              class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
              role="alert"
            >
              {{ errorMsg }}
            </p>
            <p
              v-else-if="notice"
              class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
              role="status"
            >
              {{ notice }}
            </p>

            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!hasOwnKey"
                @click="onClear"
              >
                清除我的 key
              </button>
              <button
                type="button"
                class="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="saving"
                @click="onSave"
              >
                {{ saving ? '验证并保存…' : '验证并保存' }}
              </button>
            </div>

            <div
              v-if="hasOwnKey"
              class="flex items-center justify-between gap-2 border-t border-slate-100 pt-3"
            >
              <p class="text-xs text-slate-500">
                你的余额：<span class="font-medium tabular-nums text-slate-800">{{
                  amountText(primaryBalance(ownBalance))
                }}</span>
              </p>
              <button
                type="button"
                class="text-xs text-emerald-700 transition hover:text-emerald-800 disabled:opacity-50"
                :disabled="loadingOwn"
                @click="queryOwnBalance"
              >
                {{ loadingOwn ? '查询中…' : '查询我的余额' }}
              </button>
            </div>
          </section>

          <!-- 智谱：检索向量化 -->
          <section class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs font-medium text-slate-500">智谱 · 默认 key 的余额</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {{ embeddingAmountText(ourEmbeddingBalance) }}
                </p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                :disabled="loadingOurEmbedding"
                @click="loadOurEmbeddingBalance"
              >
                {{ loadingOurEmbedding ? '查询中…' : '刷新' }}
              </button>
            </div>
            <p class="text-[11px] leading-relaxed text-slate-400">
              只用于检索的向量化；智谱的余额接口不是公开文档里的正式接口，查不到时不影响主流程。
            </p>

            <div class="flex items-center justify-between gap-2 pt-1">
              <h3 class="text-sm font-semibold text-slate-800">你的智谱 key（可选）</h3>
              <span
                class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="
                  hasOwnEmbeddingKey
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                "
              >
                {{ hasOwnEmbeddingKey ? '当前：你的 key' : '当前：我们的 key' }}
              </span>
            </div>

            <div class="flex items-center gap-2">
              <input
                v-model="embeddingDraft"
                :type="showEmbeddingKey ? 'text' : 'password'"
                autocomplete="off"
                spellcheck="false"
                placeholder="智谱 key（id.secret）"
                class="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none transition focus:border-emerald-500"
              />
              <button
                type="button"
                class="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 transition hover:bg-slate-50"
                @click="showEmbeddingKey = !showEmbeddingKey"
              >
                {{ showEmbeddingKey ? '隐藏' : '显示' }}
              </button>
            </div>

            <p class="text-[11px] leading-relaxed text-slate-400">
              必须使用智谱 embedding-3；模型和 1024
              维由服务端固定，不能改。保存前会真的做一次向量化，确认 key 能用。
            </p>

            <p
              v-if="embeddingError"
              class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
              role="alert"
            >
              {{ embeddingError }}
            </p>
            <p
              v-else-if="embeddingNotice"
              class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
              role="status"
            >
              {{ embeddingNotice }}
            </p>

            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!hasOwnEmbeddingKey"
                @click="onClearEmbedding"
              >
                清除我的智谱 key
              </button>
              <button
                type="button"
                class="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="savingEmbedding"
                @click="onSaveEmbedding"
              >
                {{ savingEmbedding ? '验证并保存…' : '验证并保存' }}
              </button>
            </div>

            <div
              v-if="hasOwnEmbeddingKey"
              class="flex items-center justify-between gap-2 border-t border-slate-100 pt-3"
            >
              <p class="text-xs text-slate-500">
                你的余额：<span class="font-medium tabular-nums text-slate-800">{{
                  embeddingAmountText(ownEmbeddingBalance)
                }}</span>
              </p>
              <button
                type="button"
                class="text-xs text-emerald-700 transition hover:text-emerald-800 disabled:opacity-50"
                :disabled="loadingOwnEmbedding"
                @click="queryOwnEmbeddingBalance"
              >
                {{ loadingOwnEmbedding ? '查询中…' : '查询我的余额' }}
              </button>
            </div>
          </section>

          <p class="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
            模型固定，不提供切换：提示词、关系图 JSON
            和检索阈值都按当前模型校准过，换模型可能让图解析失败。
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
