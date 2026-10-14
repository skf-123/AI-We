<script setup lang="ts">
/**
 * 左栏：代码输入区。
 *
 * 只做输入这一件事：示例按钮、输入框、字数提醒、三个动作按钮。
 * 它不认识「解析结果」面板，也不发请求 —— 按钮只往上抛事件，
 * 由页面决定「开始解析」到底要干什么。
 *
 * ⚠️ 上限值由页面传进来，不要在这里写死：它必须与
 *    server/api/analyze.post.ts 里 zod 的 max(20000) 保持一致。
 */
const props = defineProps<{
  modelValue: string
  /** 是否正在解析（决定第三个按钮是「开始解析」还是「停止」） */
  loading: boolean
  /** 代码长度上限（与服务端 zod 同步） */
  maxLength: number
  /** 超过这个长度就醒目提醒（还没到上限） */
  warnAt: number
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

/** 外部传进来的值是只读 prop，要改必须显式往上抛事件 */
const text = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})
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

    <textarea
      v-model="text"
      spellcheck="false"
      :maxlength="maxLength"
      placeholder="把你想看懂的代码粘贴到这里，然后点下面的按钮。&#10;不需要写任何提示词。"
      class="font-mono-code min-h-[200px] flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-base leading-relaxed text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white sm:min-h-[280px] sm:text-sm lg:min-h-0"
    />

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
