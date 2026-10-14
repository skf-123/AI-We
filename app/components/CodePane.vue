<script setup lang="ts">
/**
 * 左栏：代码输入区。
 *
 * 只做输入这一件事：示例按钮、输入框、字数提醒、三个动作按钮，
 * 外加「被选中时高亮对应行」。
 *
 * ── 行高亮为什么需要一个"镜像层" ──
 * 原生 `<textarea>` **没法只给某几行加背景色**（它的内容不由 DOM 节点构成）。
 * 所以底下垫一层和它**同字体、同字号、同行距、同内边距**的 div，里面是
 * **同一份文本**（文字透明），只给命中的行上背景色 —— textarea 压在它上面。
 *
 * 为什么是"镜像同一份文本"而不是算 `top = (行号-1) × 行高`：
 * 长代码行在框里会**折行**，折行之后"逻辑第 N 行"在屏幕上占了几行就不确定了，
 * 算出来的位置必错。镜像层的文本和 textarea 同源同度量，折行位置自然一致。
 *
 * ⚠️ 唯一的坑是**内容宽度**：textarea 一旦出现纵向滚动条，它的内容区会窄
 *    一个滚动条宽，镜像层却不会 —— 两边宽度不等，折行位置就漂。
 *    这里的做法是**实测**滚动条的宽度（offsetWidth - clientWidth），
 *    用它把镜像层右边缘往里收，让两者的内容区严格相等。
 */
const props = defineProps<{
  modelValue: string
  /** 是否正在解析（决定第三个按钮是「开始解析」还是「停止」） */
  loading: boolean
  /** 代码长度上限（与服务端 zod 同步） */
  maxLength: number
  /** 超过这个长度就醒目提醒（还没到上限） */
  warnAt: number
  /** 要高亮的原始代码行号（1 起）。空数组表示不高亮 */
  highlightLines: number[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'analyze' | 'stop' | 'clear'): void
}>()

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

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const mirrorRef = ref<HTMLElement | null>(null)

/** 外部传进来的值是只读 prop，要改必须显式往上抛事件 */
const text = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})

/** 镜像层按行切开渲染，这样能给某一行加背景色 */
const mirrorLines = computed(() => props.modelValue.split('\n'))

const hitSet = computed(() => new Set(props.highlightLines))

/**
 * 滚动条的实测宽度。用它把镜像层右边缘往里收，
 * 使镜像层的内容区和 textarea 的内容区**严格相等** —— 折行位置才会一致。
 */
const scrollbarW = ref(0)

function measureScrollbar() {
  const ta = textareaRef.value
  if (!ta) return
  scrollbarW.value = ta.offsetWidth - ta.clientWidth
}

/** textarea 滚动时，镜像层跟着走 */
function syncScroll() {
  const ta = textareaRef.value
  const mirror = mirrorRef.value
  if (ta && mirror) mirror.scrollTop = ta.scrollTop
}

/**
 * 把高亮的第一行滚进视野。
 * 位置取自**镜像层里那个 span 的 offsetTop**，而不是
 * `(行号-1) × 行高` —— 前面有折行的行时，后者会算错。
 */
function focusLines(lines: number[]) {
  const ta = textareaRef.value
  const mirror = mirrorRef.value
  const first = lines[0]
  if (!ta || !mirror || first === undefined) return

  const span = mirror.children[first - 1] as HTMLElement | undefined
  if (!span) return

  ta.scrollTop = Math.max(0, span.offsetTop - ta.clientHeight / 3)
  syncScroll()
}

defineExpose({ focusLines })

onMounted(() => {
  measureScrollbar()
  window.addEventListener('resize', measureScrollbar)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureScrollbar)
})

// 代码换了（比如点了示例按钮）要重新量一次：滚动条可能因此出现或消失
watch(
  () => props.modelValue,
  () => nextTick(measureScrollbar),
)
</script>

<template>
  <section
    class="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:h-[calc(100vh-200px)] lg:min-h-[420px] lg:overflow-hidden"
  >
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <span class="text-sm text-slate-500">示例：</span>
      <button
        v-for="s in SAMPLES"
        :key="s.label"
        class="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:border-emerald-500 hover:text-emerald-600"
        @click="text = s.code"
      >
        {{ s.label }}
      </button>
    </div>

    <!-- 输入区：底下是镜像层，上面压着真正可编辑的 textarea -->
    <div
      class="relative min-h-[200px] flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition focus-within:border-emerald-500 focus-within:bg-white sm:min-h-[280px] lg:min-h-0"
    >
      <!--
        镜像层：纯装饰，对读屏器隐藏。
        右边缘内收一个滚动条宽度，和 textarea 的内容区对齐。
      -->
      <div
        ref="mirrorRef"
        class="mirror font-mono-code absolute inset-y-0 left-0 overflow-y-scroll p-3 text-base leading-relaxed break-words whitespace-pre-wrap text-transparent sm:text-sm"
        :style="{ right: `${scrollbarW}px` }"
        aria-hidden="true"
      >
        <span
          v-for="(line, i) in mirrorLines"
          :key="i"
          :class="{ 'line-hit': hitSet.has(i + 1) }"
        >{{ line }}{{ i < mirrorLines.length - 1 ? '\n' : '' }}</span>
      </div>

      <textarea
        ref="textareaRef"
        v-model="text"
        spellcheck="false"
        :maxlength="maxLength"
        placeholder="把你想看懂的代码粘贴到这里，然后点下面的按钮。&#10;不需要写任何提示词。"
        class="font-mono-code absolute inset-0 h-full w-full resize-none border-0 bg-transparent p-3 text-base leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 sm:text-sm"
        @scroll.passive="syncScroll"
      />
    </div>

    <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
      <span
        class="text-xs tabular-nums transition-colors"
        :class="modelValue.length >= warnAt ? 'font-medium text-amber-600' : 'text-slate-400'"
      >
        {{ modelValue.length }} / {{ maxLength }}
        <template v-if="modelValue.length >= warnAt">· 接近上限，建议只贴关键片段</template>
      </span>
      <div class="flex gap-2">
        <button
          class="rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50"
          @click="emit('clear')"
        >
          清空
        </button>
        <button
          v-if="!loading"
          class="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!modelValue.trim()"
          @click="emit('analyze')"
        >
          开始解析
        </button>
        <button
          v-else
          class="rounded-lg border border-rose-300 px-5 py-2.5 text-sm text-rose-600 transition hover:bg-rose-50"
          @click="emit('stop')"
        >
          停止
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * 镜像层的滚动条要藏起来：它只是为了跟 textarea 的滚动位置同步，
 * 露出来会在输入框右侧压出一条多余的槽。
 */
.mirror {
  scrollbar-width: none;
}
.mirror::-webkit-scrollbar {
  display: none;
}

/* 命中的行：一条很淡的绿色背景带 */
.mirror .line-hit {
  background-color: rgb(16 185 129 / 16%);
  box-shadow: inset 2px 0 0 #10b981;
}
</style>
