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
  /**
   * 选区的 Range 副本。
   *
   * 为什么不用"快照矩形"：气泡要**跟着选区走**（滚动时重算位置），
   * 而快照一算出来就定死了，滚一下就脱开。Range 对象在浏览器把选区
   * 清掉之后依然能算出坐标，正好满足这个需求。
   */
  range: Range | null
  /** 整段原始代码 —— 追问得有上下文，"这两行"才指得清 */
  code: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'close'): void
}>()

/**
 * 气泡宽度：写死，但**大小屏分档**。
 *
 * 手机上的 CSS 视口只有 360~430（机型数据：安卓基准 360、苹果 390/414），
 * 380px 的气泡会顶满两边、不留边，所以要窄一档。
 * 用 vu 这个 ref 而不是直接读 innerWidth —— 旋转/改窗口大小时宽度才跟得上。
 */
const vw = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const bubbleW = computed(() => (vw.value < 640 ? 300 : 380))

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

// ---------------- 锚点：跟着选区走 ----------------

const anchorRect = ref<{ left: number; right: number; top: number; bottom: number } | null>(null)

/**
 * 锚点取**选区里第一个还在视口内的那一行**。
 *
 * 为什么不能拿整个选区的 getBoundingClientRect()：全选的时候那是个横跨
 * 几千像素的外接框，它的 top 早跑到屏幕外了 —— 拿它当锚点，气泡只能贴到
 * "选区的最后一行"（也就是拖选的落点）旁边。用户看到的就是"怎么还在最下面"。
 */
function computeAnchor() {
  const r = props.range
  if (!r) {
    anchorRect.value = null
    return
  }

  const u = r.getBoundingClientRect()
  if (u.width === 0 && u.height === 0) {
    anchorRect.value = null
    return
  }

  // 取选区**顶边**；如果顶部已经滚出屏幕，就夹进视口。
  //
  // 为什么不按 getClientRects() 找"第一个可见行"：右栏是**内部滚动**的容器，
  // 被它裁掉的那些行，坐标可能还落在视口范围内 —— 于是会选中一个用户根本
  // 看不见的行，气泡跟着乱跑。夹取顶边更简单，结果也稳定。
  //
  // "全选"这种情况正是靠它修正的：整个选区的外接框顶边早在屏幕外，
  // 夹取之后气泡落在**看得见的那段选区的顶部**，而不是拖选的落点（最下面）。
  const top = Math.min(Math.max(u.top, 8), Math.max(8, window.innerHeight - 40))

  // 底边也要看着点：全选时外接框的底边在屏幕外很远（几千像素），
  // 一旦"上方放不下、翻到下面"就会拿它当参照，把气泡扔到选区最下面去。
  // 底边超出视口时，就按"一行"算，而不是按整个选区算。
  const bottomOffScreen = u.bottom > window.innerHeight
  const bottom = bottomOffScreen ? top + 24 : u.bottom

  const next = { left: u.left, right: u.left + 1, top, bottom }

  // 位移不到 0.5px 就不更新 —— 否则每帧都会触发一次组件重渲染。
  // 锚点是 rAF 循环里每帧算的，这个判断不能省。
  const cur = anchorRect.value
  if (cur && Math.abs(cur.top - next.top) < 0.5 && Math.abs(cur.left - next.left) < 0.5) return

  anchorRect.value = next
}

/**
 * 跟随循环：只要还有选区（按钮可见或面板开着），就**每帧**重算一次锚点。
 *
 * 为什么不用 scroll 监听：右栏是**内部滚动**的容器，页面里能滚动的东西不止一处，
 * 监听谁都不全 —— 实测就漏了（框滚了 200px，锚点纹丝不动）。
 * 每帧算一次 getBoundingClientRect 很便宜，而且任何滚动、布局变化、
 * 动画移动都自动跟得上，不用关心"是谁滚的"。
 */
let followRaf = 0

function startFollow() {
  if (followRaf) return
  const tick = () => {
    // 只在**面板还没打开**时才跟着走 —— 那是给那个小按钮用的：
    // 它要一直贴着选区，用户滚到哪它跟到哪。
    //
    // 面板一旦打开就**冻住**：用户正在读、正在问，这时窗口或选区一动
    // 面板就跟着跳，很烦；何况他还能自己拖。
    if (!props.open) computeAnchor()
    followRaf = requestAnimationFrame(tick)
  }
  followRaf = requestAnimationFrame(tick)
}

function stopFollow() {
  if (followRaf) {
    cancelAnimationFrame(followRaf)
    followRaf = 0
  }
}

// ---------------- 拖动：记的是"相对锚点的偏移" ----------------

/**
 * 拖动产生的是**偏移量**而不是绝对位置 —— 这样它和"跟着选区走"就不打架：
 * 滚动时锚点重算、面板跟着走，**同时保留**用户拖出来的那段偏移。
 * 如果拖动记的是绝对坐标，滚动一跟随就会把用户摆好的位置冲掉。
 */
const dragOffset = ref({ x: 0, y: 0 })
let dragFrom: { x: number; y: number } | null = null

function startDrag(e: PointerEvent) {
  dragFrom = { x: e.clientX - dragOffset.value.x, y: e.clientY - dragOffset.value.y }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onDrag(e: PointerEvent) {
  if (!dragFrom) return
  dragOffset.value = { x: e.clientX - dragFrom.x, y: e.clientY - dragFrom.y }
}

function endDrag() {
  dragFrom = null
}

const panelEl = ref<HTMLElement | null>(null)

/** 面板高度实测不到时（首帧）用的估值 */
const PANEL_H_FALLBACK = 260

/** 顶部那个拖动把手的高度（夹取时只保证它露在屏幕里） */
const HEADER_H = 44

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * 「基准位置」= 不含拖动偏移时面板该待的 top。
 *
 * 算它要用到**面板自己的高度**（贴在选区上方 = 选区顶边 − 面板高 − 8），
 * 而面板高是 `20dvh` —— **会随窗口/缩放变**。
 *
 * ⚠️ 所以基准必须**在打开的那一刻定一次、之后冻住**。
 *    早先是每帧现算的，于是缩放时高度一变、基准跟着变，
 *    手指没动面板却"跳一段"（抓着像抓空）。
 *    冻住之后：高度照样跟着窗口变，但**顶边不动**，面板只会往下长或往上缩。
 */
const baseTop = ref<number | null>(null)

function computeBaseTop(): number {
  const a = anchorRect.value
  if (!a || typeof window === 'undefined') return 8
  const h = panelEl.value?.offsetHeight || PANEL_H_FALLBACK
  const above = a.top - 8 - h
  return above < 8 ? a.top + 28 : above
}

const panelStyle = computed(() => {
  const a = anchorRect.value
  if (!a || typeof window === 'undefined') return {}

  const { x: dx, y: dy } = dragOffset.value

  const left = clamp(a.left + dx, 8, Math.max(8, window.innerWidth - bubbleW.value - 8))

  // 基准：面板开着时用**打开那一刻冻住**的值，否则现算。
  // 这样缩放导致高度变化时，面板只是变高变矮，**顶边不会跳**。
  const base = props.open && baseTop.value !== null ? baseTop.value : computeBaseTop()

  // ⚠️ 拖动偏移是 **+ dy**：这里是"往上长"的写法，写成减号会让往下拖变成往上跑。
  //    （这里必须是 let —— 下面还要夹取。先前写成 const 又赋值，
  //      渲染函数直接抛 TypeError，面板根本出不来，而 lint 没抓到。）
  let top = base + dy

  // 夹取的对象是**拖动把手（标题栏）**，不是整个面板。
  //
  // ⚠️ 这里踩过坑：原来夹的是整个面板（上界 = 视口高 − 面板高 − 8）。
  //    缩小浏览器比例、把面板撑到高度上限、再恢复比例之后，面板高会接近视口高，
  //    那个上界就掉到 8 以下、被 Math.max 兜成 8 —— 夹取范围塌成 [8, 8]，
  //    **面板被钉死，怎么拖都不动**（"向某处依附、拖不动"就是它）。
  //    改成只保证把手露在屏幕里，面板再高也永远拖得动。
  top = clamp(top, 8, Math.max(8, window.innerHeight - HEADER_H - 8))

  return { left: `${left}px`, top: `${top}px`, width: `${bubbleW.value}px` }
})

/**
 * 那个小按钮的位置：贴在选区右下角。
 *
 * 为什么不直接弹面板：用户选中一段文字，最常见的意思是"我要复制"。
 * 一选就弹一个大面板会打断这件事 —— 所以先给一个可以无视的小按钮。
 */
const triggerStyle = computed(() => {
  const a = anchorRect.value
  if (!a || typeof window === 'undefined') return {}

  const W = 64
  const H = 26 // 按钮高度（估）
  const left = clamp(a.right + 6, 8, Math.max(8, window.innerWidth - W - 8))

  // 和面板一致：以**选区顶边**为参照，优先放在它上方
  const above = a.top - H - 4
  const top = above >= 4 ? above : a.top + 4

  return { left: `${left}px`, top: `${clamp(top, 4, Math.max(4, window.innerHeight - H - 4))}px` }
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

function onResize() {
  vw.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('resize', onResize)
  stopFollow()
})

// 有选区就开始跟随（按钮可见时也要跟），选区没了就停 —— 别让这个循环空转
watch(
  () => props.range,
  (r) => {
    // 换了新选区 → 偏移归零。否则"上一次拖到哪"会跟着带到下一次，
    // 用户会看到气泡莫名其妙地偏着出现。
    dragOffset.value = { x: 0, y: 0 }

    if (r) {
      computeAnchor()
    } else {
      anchorRect.value = null
    }
  },
  { immediate: true },
)

/**
 * 跟随循环只在「有选区 **且** 面板没打开」时跑。
 *
 * ⚠️ 面板打开时锚点是冻住的，循环却还在每帧调 `range.getBoundingClientRect()`
 *    —— 那玩意儿**会强制浏览器同步重排**，白白做 60 次/秒，正是
 *    "刚打开有点顿"的嫌疑。面板一开就整个停掉。
 */
watch(
  [() => props.range, () => props.open],
  () => {
    if (props.range && !props.open) startFollow()
    else stopFollow()
  },
  { immediate: true },
)

// 面板开合：
//   · 开 → 先定位一次（落在按钮刚才待的地方），再**把基准钉住**
//   · 关 → 松开基准，下次开再定
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      baseTop.value = null
      return
    }
    computeAnchor()
    // 等面板真正挂上再量高度 —— 这一帧之前量到的是兜底估值
    await nextTick()
    baseTop.value = computeBaseTop()
  },
)
</script>

<template>
  <Teleport to="body">
    <!-- 第一步：只是个小按钮。用户不理它，就当没出现过 -->
    <button
      v-if="!open && selection && anchorRect"
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
      ref="panelEl"
      class="ask-bubble"
      :style="panelStyle"
      role="dialog"
      aria-label="针对选中代码追问"
    >
      <!--
        顶部：选中了什么，同时兼作**拖动把手**。
        拖动改的是相对锚点的偏移，所以"拖到别处"和"跟着选区走"可以同时成立。
      -->
      <div
        class="flex cursor-move touch-none items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 select-none"
        title="按住拖动"
        @pointerdown.prevent="startDrag"
        @pointermove="onDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
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
          @pointerdown.stop
          @click="close"
        >
          ✕
        </button>
      </div>

      <!-- 对话流 -->
      <div ref="scrollRef" class="ask-conversation overflow-y-auto overscroll-contain px-3 py-2.5">
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
/*
 * 对话区高度 = **当前可见窗口的 20%**。
 *
 * 注意是固定 `height`，不是 `max-height` —— 原来用上限，导致"还没问"时
 * 只占 74px、一有回答就撑到 369px，面板整个跳一截。写死之后前后一样高。
 *
 * 用 **dvh** 而不是 vh：移动浏览器的地址栏会吃掉高度，vh 会算多
 * （机型数据里明确列的三个高频坑之一）。@supports 兜底，老浏览器退回 vh。
 */
.ask-conversation {
  height: 20vh;
}

@supports (height: 20dvh) {
  .ask-conversation {
    height: 20dvh;
  }
}

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
