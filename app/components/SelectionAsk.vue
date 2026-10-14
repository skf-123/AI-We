<script setup lang="ts">
/**
 * 追问气泡：在解析结果里选中一段代码，就地接着问。
 *
 * 这是「看懂 → 还不懂 → 就地追问 → 懂了」这条自学闭环的最后一环。
 * 所以它**可以接着往下问**，而不是一问一答就结束 ——
 * 看不懂一个函数的人，通常不是一个问题就能解决的。
 *
 * Teleport 到 body 的原因同 TermCard：右栏是 `lg:overflow-hidden`，
 * 气泡留在面板内部会被裁掉。
 *
 * 对话历史由前端保存并随每次请求带上，服务端不存会话（见 server/api/ask.post.ts）。
 * 关掉气泡即丢弃这一轮对话 —— 它服务的是一次"就地解惑"，不是长期会话。
 */
interface Turn {
  role: 'user' | 'assistant'
  content: string
}

const props = defineProps<{
  /** 面板是否展开。收起时若还有选区，就只显示那个小按钮 */
  open: boolean
  /** 用户选中的那一小段 */
  selection: string
  /** 选区位置（视口坐标），气泡贴着它出现 */
  anchor: { left: number; right: number; top: number; bottom: number } | null
  /** 整段原始代码 —— 追问得有上下文，"这两行"才指得清 */
  code: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'close'): void
}>()

const BUBBLE_W = 380

/** 预设问题。产品卖点是"零提示词"，所以不能让用户到这里卡在"我该问什么" */
const PRESETS = ['这几行在干什么？', '为什么这么写？', '有什么风险？']

const turns = ref<Turn[]>([])
const question = ref('')
const loading = ref(false)
const errorMsg = ref('')

/**
 * 有多少轮对话被裁掉了（不再带给模型）。
 * 由服务端在响应头 X-Ask-History 里告知 —— 前端不算这个数，
 * 免得两边各算一套迟早漂移。0 表示没裁。
 */
const trimmedRounds = ref(0)

const inputRef = ref<HTMLTextAreaElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)

let controller: AbortController | null = null

const panelStyle = computed(() => {
  const r = props.anchor
  if (!r || typeof window === 'undefined') return {}

  const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - BUBBLE_W - 8))

  // 默认贴在选区**上方**（面板底边离选区顶边 8px）。
  // 用 bottom 定位而不是 top：面板高度是不定的（对话越长越高），
  // 用 bottom 才能保证它"底边贴着选区上方"、往上长，而不是把选区盖住。
  const above = { left: `${left}px`, bottom: `${window.innerHeight - r.top + 8}px`, width: `${BUBBLE_W}px` }

  // 上方放不下就翻到下面 —— 否则贴在视口顶边之外就看不见了
  const roomAbove = r.top - 8
  if (roomAbove >= 240) return above

  return { left: `${left}px`, top: `${r.bottom + 8}px`, width: `${BUBBLE_W}px` }
})

/**
 * 那个小按钮的位置：贴在选区右下角。
 *
 * 为什么不直接弹面板：用户选中一段文字，最常见的意思是"我要复制"。
 * 一选就弹一个大面板会打断这件事 —— 所以先给一个可以无视的小按钮。
 */
const triggerStyle = computed(() => {
  const r = props.anchor
  if (!r || typeof window === 'undefined') return {}

  const W = 64
  const H = 26 // 按钮高度（估），用来算"放在选区上方"的位置
  const left = Math.min(Math.max(8, r.right + 6), Math.max(8, window.innerWidth - W - 8))

  // 和面板一致：默认贴选区**上方**
  const top = r.top - H - 6
  return top >= 4
    ? { left: `${left}px`, top: `${top}px` }
    : { left: `${left}px`, top: `${Math.min(r.bottom + 6, window.innerHeight - H - 8)}px` }
})

/** 回答是流式的，得跟着往下滚，否则后半截看不见 */
async function scrollToBottom() {
  await nextTick()
  const box = scrollRef.value
  if (box) box.scrollTop = box.scrollHeight
}

function appendToLast(chunk: string) {
  const last = turns.value[turns.value.length - 1]
  if (last) last.content += chunk
}

async function ask(text: string) {
  if (loading.value || !text.trim()) return

  // 先取历史（这时还没把本轮塞进去），历史里只会有已完成的问答
  const history = turns.value.map((t) => ({ role: t.role, content: t.content }))

  turns.value.push({ role: 'user', content: text })
  turns.value.push({ role: 'assistant', content: '' })
  loading.value = true
  errorMsg.value = ''
  void scrollToBottom()

  controller = new AbortController()

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: props.code,
        selection: props.selection,
        question: text,
        history,
      }),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      let msg = `请求失败（HTTP ${res.status}）`
      try {
        const data = await res.json()
        msg = data?.statusMessage || data?.message || msg
      } catch {
        /* 保持默认提示 */
      }
      // 把占位的空回答撤掉，别留一个空气泡
      turns.value.pop()
      errorMsg.value = msg
      return
    }

    // 服务端可能裁掉了更早的几轮。它把这件事放在响应头里告诉我们，
    // 而不是让前端自己按预算算一遍 —— 预算在服务端，前端算不出权威答案。
    const rawHistory = res.headers.get('X-Ask-History')
    if (rawHistory) {
      try {
        const info = JSON.parse(decodeURIComponent(rawHistory))
        trimmedRounds.value = Math.max(0, (info.totalRounds ?? 0) - (info.usedRounds ?? 0))
      } catch {
        trimmedRounds.value = 0
      }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      appendToLast(decoder.decode(value, { stream: true }))
      void scrollToBottom()
    }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') {
      errorMsg.value = `出错了：${err instanceof Error ? err.message : String(err)}`
    }
  } finally {
    loading.value = false
    controller = null
  }
}

function submit() {
  const q = question.value.trim()
  if (!q) return
  question.value = ''
  void ask(q)
}

/** 输入框里回车直接发送，Shift+Enter 换行 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function stop() {
  controller?.abort()
  loading.value = false
}

function close() {
  stop()
  emit('update:open', false)
  emit('close')
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

// 关掉就丢弃这一轮对话；打开时把焦点给输入框，省得再点一下
watch(
  () => props.open,
  (open) => {
    if (!open) {
      turns.value = []
      question.value = ''
      errorMsg.value = ''
      trimmedRounds.value = 0
      return
    }
    nextTick(() => inputRef.value?.focus())
  },
)

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <Teleport to="body">
    <!-- 第一步：只是个小按钮。用户不理它，就当没出现过 -->
    <button
      v-if="!open && selection && anchor"
      type="button"
      class="ask-trigger"
      :style="triggerStyle"
      @click="emit('update:open', true)"
    >
      提问
    </button>

    <!-- 第二步：点了按钮才展开的问答面板 -->
    <div
      v-if="open"
      class="ask-bubble"
      :style="panelStyle"
      role="dialog"
      aria-label="针对选中代码追问"
    >
      <!-- 顶部：选中了什么 -->
      <div class="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div class="min-w-0">
          <div class="text-[11px] text-slate-400">已选中</div>
          <div class="truncate font-mono-code text-[12px] text-slate-600">
            {{ selection || '（未选中具体代码）' }}
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 rounded px-1 text-slate-400 transition hover:text-slate-600"
          aria-label="关闭"
          @click="close"
        >
          ✕
        </button>
      </div>

      <!-- 对话流 -->
      <div ref="scrollRef" class="max-h-[46vh] overflow-y-auto overscroll-contain px-3 py-2.5">
        <!--
          裁切提示。用户往回翻还能看到那些轮次，但模型已经不记得了 ——
          不说清楚，用户会以为它记得，然后被一个"答非所问"困惑。
        -->
        <p
          v-if="trimmedRounds > 0"
          class="mb-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] leading-4 text-slate-500"
        >
          更早的 {{ trimmedRounds }} 轮已不再带给模型（仍显示在这里）
        </p>

        <!-- 还没开始问：给三个预设问题，别让用户卡在"我该问什么" -->
        <div v-if="turns.length === 0" class="space-y-2">
          <p class="text-[12px] text-slate-500">选中的这几行有疑问？直接问：</p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="p in PRESETS"
              :key="p"
              type="button"
              class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
              @click="ask(p)"
            >
              {{ p }}
            </button>
          </div>
        </div>

        <div v-else class="space-y-2.5">
          <div
            v-for="(t, i) in turns"
            :key="i"
            :class="t.role === 'user' ? 'flex justify-end' : ''"
          >
            <div
              v-if="t.role === 'user'"
              class="max-w-[85%] rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[12.5px] leading-5 text-white"
            >
              {{ t.content }}
            </div>
            <div v-else class="rounded-lg bg-slate-50 px-2.5 py-2">
              <MarkdownBlock v-if="t.content" :text="t.content" />
              <span v-else class="inline-flex items-center gap-1.5 text-[12px] text-slate-400">
                <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                正在想…
              </span>
            </div>
          </div>
        </div>

        <p v-if="errorMsg" class="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[12px] text-rose-700">
          {{ errorMsg }}
        </p>
      </div>

      <!-- 输入区 -->
      <div class="border-t border-slate-100 px-3 py-2">
        <textarea
          ref="inputRef"
          v-model="question"
          rows="1"
          :maxlength="500"
          placeholder="继续问…（回车发送，Shift+回车换行）"
          class="max-h-24 w-full resize-none rounded-md border border-slate-200 px-2 py-1.5 text-[12.5px] leading-5 text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-emerald-500"
          @keydown="onKeydown"
        />
        <div class="mt-1 flex items-center justify-between gap-2">
          <span class="text-[10.5px] text-slate-400">回答由模型即时生成，非知识库原文</span>
          <div class="flex gap-1.5">
            <button
              v-if="loading"
              type="button"
              class="rounded-md border border-rose-300 px-2.5 py-1 text-[12px] text-rose-600 transition hover:bg-rose-50"
              @click="stop"
            >
              停止
            </button>
            <button
              v-else
              type="button"
              class="rounded-md bg-emerald-600 px-3 py-1 text-[12px] font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!question.trim()"
              @click="submit"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 选中后浮出的那个小按钮：小、贴着选区，不抢戏 */
.ask-trigger {
  position: fixed;
  z-index: 60;
  border-radius: 0.375rem;
  border: 1px solid #a7f3d0;
  background: #fff;
  padding: 0.15rem 0.5rem;
  font-size: 12px;
  color: #047857;
  box-shadow: 0 4px 12px rgb(15 23 42 / 12%);
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.ask-trigger:hover {
  background: #ecfdf5;
  border-color: #6ee7b7;
}

.ask-bubble {
  position: fixed;
  z-index: 60;
  border-radius: 0.625rem;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow:
    0 12px 32px rgb(15 23 42 / 14%),
    0 2px 8px rgb(15 23 42 / 8%);
}
</style>
