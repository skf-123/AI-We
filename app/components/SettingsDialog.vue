<script setup lang="ts">
/**
 * 设置弹窗：默认用我们的 key；评委可以填自己的 DeepSeek key。
 *
 * key 只存当前标签页的 sessionStorage，关闭标签页就清空；
 * 请求时放在 x-llm-api-key 头里，服务端只在这一次请求里用，不落盘。
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

interface SettingsInfo {
  provider: string
  model: string
  visionModel: string
  defaultKeyConfigured: boolean
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()

const { key, hasOwnKey, save, clear } = useLlmKey()

const draft = ref('')
const showKey = ref(false)
const info = ref<SettingsInfo | null>(null)
const ourBalance = ref<BalanceResult | null>(null)
const ownBalance = ref<BalanceResult | null>(null)
const loadingOur = ref(false)
const loadingOwn = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const notice = ref('')

function close() {
  emit('update:open', false)
}

function primaryBalance(result: BalanceResult | null): BalanceInfo | null {
  if (!result || result.balances.length === 0) return null
  return result.balances.find((item) => item.currency === 'CNY') ?? result.balances[0]!
}

function amountText(item: BalanceInfo | null): string {
  if (!item) return '—'
  return `${item.currency === 'CNY' ? '¥' : ''}${item.total}${item.currency === 'CNY' ? '' : ' ' + item.currency}`
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
    // 不带自定义 key，查的是我们自己的账户
    ourBalance.value = await $fetch<BalanceResult>('/api/settings/balance')
  } catch (err) {
    ourBalance.value = null
    errorMsg.value = errorText(err)
  } finally {
    loadingOur.value = false
  }
}

async function checkKey(value: string): Promise<BalanceResult> {
  return $fetch<BalanceResult>('/api/settings/balance', {
    headers: { 'x-llm-api-key': value },
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

function onOpen() {
  draft.value = key.value
  ownBalance.value = null
  errorMsg.value = ''
  notice.value = ''
  void loadInfo()
  void loadOurBalance()
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
              默认用我们的 key；你也可以填自己的 DeepSeek key，只对当前标签页生效。
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
              提供商：{{ info?.provider || 'DeepSeek' }}
            </span>
            <span class="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
              模型：{{ info?.model || 'deepseek-chat' }}
            </span>
            <span class="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
              默认 key：{{ info?.defaultKeyConfigured ? '已配置（只读）' : '未配置' }}
            </span>
          </div>

          <section class="rounded-xl border border-slate-200 bg-white p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs font-medium text-slate-500">我们的额度</p>
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
            <p class="mt-2 text-[11px] leading-relaxed text-slate-400">
              这是不填自己 key 时用的账户余额；连续点刷新会提示稍后再试。
            </p>
          </section>

          <section class="space-y-3">
            <div class="flex items-center justify-between gap-2">
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
                placeholder="sk-…（只保存在当前标签页）"
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
              只保存在当前标签页，关闭标签页就清空；不写服务器、不进日志。填了之后，解析、追问、截图识别和项目分析都会用你的
              key。
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

          <p class="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
            模型固定，不提供切换：提示词、关系图 JSON
            和检索阈值都按当前模型校准过，换模型可能让图解析失败。
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
