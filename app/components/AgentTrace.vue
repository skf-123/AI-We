<script setup lang="ts">
import type { AgentStep } from '~/types/project'
import {
  describeTool,
  formatStepArgs,
  formatStepResult,
  groupTraceSteps,
  summarizeToolCalls,
} from '~/utils/agent-trace'

/**
 * 项目侦查 / 图自检的轨迹。
 *
 * 只有一份数据：steps。两种看法：
 *   · 阅读版：把同一批工具调用翻译成人话，按轮分组；
 *   · 开发者版：原样显示工具名、原始参数和结果。
 *
 * 不展示、也不编造模型的隐藏思考；模型某轮带了文字说明才显示「模型说明」。
 * 运行中可以打断；失败时由页面回退到固定地图。
 */

const props = defineProps<{
  steps: AgentStep[]
  running: boolean
  stopped: boolean
  error: string
  round: number
  maxRounds: number
  fallback?: boolean
  /** 组件标题：项目侦查 / 图自检 */
  title?: string
  /** 失败时显示的说明 */
  errorText?: string
  /** 是否显示「重新运行」按钮（由页面判断什么时候可以重跑） */
  rerun?: boolean
  /** 重新运行按钮的文案 */
  rerunLabel?: string
  /** 收尾产出摘要，例如「概述 1 条 · 文件说明 37 条」 */
  outcome?: string
}>()

const emit = defineEmits<{
  (e: 'stop' | 'rerun'): void
}>()

const view = ref<'reading' | 'raw'>('reading')
const rounds = computed(() => groupTraceSteps(props.steps))
const totalCalls = computed(() => props.steps.length)

function stepSummary(step: AgentStep): string {
  return step.summary || formatStepResult(step)
}
</script>

<template>
  <section class="shrink-0 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-[11px] font-medium text-slate-600">
        {{ props.title || 'Agent 侦查' }}
      </span>

      <span
        v-if="props.running"
        class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-700"
      >
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        正在决定下一步
      </span>
      <span v-else-if="props.error" class="text-[10.5px] text-rose-600">
        {{ props.errorText || '未完成，已回退到固定地图' }}
      </span>
      <span v-else-if="props.stopped" class="text-[10.5px] text-amber-700">已停止</span>
      <span v-else-if="props.fallback" class="text-[10.5px] text-amber-700">
        已回退到固定地图
      </span>
      <span v-else class="text-[10.5px] text-slate-400">已完成</span>

      <span class="text-[10px] text-slate-400">工具在浏览器里执行，文件没有上传</span>

      <div class="ml-auto flex items-center gap-2">
        <span class="text-[10px] text-slate-400">
          {{ props.round }} / {{ props.maxRounds }} 轮 · {{ totalCalls }} 次工具调用
        </span>

        <div
          class="inline-flex items-center rounded-md border border-slate-200 bg-white p-0.5 text-[10px]"
        >
          <button
            type="button"
            class="rounded px-1.5 py-0.5"
            :class="
              view === 'reading' ? 'bg-slate-100 font-medium text-slate-700' : 'text-slate-400'
            "
            @click="view = 'reading'"
          >
            阅读版
          </button>
          <button
            type="button"
            class="rounded px-1.5 py-0.5"
            :class="view === 'raw' ? 'bg-slate-100 font-medium text-slate-700' : 'text-slate-400'"
            @click="view = 'raw'"
          >
            开发者
          </button>
        </div>

        <button
          v-if="props.running"
          type="button"
          class="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] text-slate-600 transition hover:bg-slate-50"
          @click="emit('stop')"
        >
          停止
        </button>
        <button
          v-else-if="props.rerun"
          type="button"
          class="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] text-slate-600 transition hover:bg-slate-50"
          @click="emit('rerun')"
        >
          {{ props.rerunLabel || '重新运行' }}
        </button>
      </div>
    </div>

    <p v-if="props.error" class="mt-1.5 text-[11px] leading-relaxed text-rose-600">
      {{ props.error }}
    </p>

    <!-- 阅读版：同一批工具调用的人话翻译，按轮分组 -->
    <div
      v-if="view === 'reading' && rounds.length"
      class="mt-2 max-h-64 space-y-2.5 overflow-y-auto pr-1"
    >
      <div v-for="group in rounds" :key="group.round">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-slate-400">
          <span class="rounded bg-white px-1.5 text-[10px]">第 {{ group.round }} 轮</span>
          <span>{{ group.steps.length }} 次调用</span>
          <span class="min-w-0 truncate font-mono text-[10px] text-slate-400">
            {{ summarizeToolCalls(group.steps) }}
          </span>
        </div>

        <p v-if="group.note" class="mt-0.5 text-[10.5px] leading-relaxed text-slate-500">
          模型说明：{{ group.note }}
        </p>

        <ol class="mt-1 space-y-1">
          <li v-for="(step, i) in group.steps" :key="`r${group.round}-${step.name}-${i}`">
            <div class="flex min-w-0 items-center gap-2 text-[11px]">
              <span class="shrink-0 text-slate-700">{{ describeTool(step.name).zh }}</span>
              <span class="shrink-0 font-mono text-[10px] text-slate-400">{{ step.name }}</span>
              <span class="min-w-0 truncate text-slate-500">{{ formatStepArgs(step) }}</span>
              <span class="ml-auto shrink-0 text-[10.5px] text-slate-400">
                {{ stepSummary(step) }}
              </span>
            </div>
            <details class="ml-1 mt-0.5">
              <summary class="cursor-pointer select-none text-[10.5px] text-slate-400">
                原始参数和结果
              </summary>
              <pre
                class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[10.5px] leading-relaxed text-slate-600"
                >{{ step.name }} {{ step.args }}

{{ step.result }}</pre>
            </details>
          </li>
        </ol>
      </div>
    </div>

    <!-- 开发者版：原样保留工具名、原始 JSON 参数和结果 -->
    <ol
      v-else-if="view === 'raw' && props.steps.length"
      class="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1"
    >
      <li v-for="(step, i) in props.steps" :key="`${step.round}-${step.name}-${i}`">
        <div class="flex min-w-0 items-center gap-2 text-[11px]">
          <span class="shrink-0 rounded bg-white px-1.5 text-[10px] text-slate-400">
            #{{ step.round }}
          </span>
          <span class="shrink-0 font-mono text-slate-700">{{ step.name }}</span>
          <span class="min-w-0 truncate text-slate-400">{{ step.args }}</span>
        </div>
        <details class="ml-6 mt-0.5">
          <summary class="cursor-pointer select-none text-[10.5px] text-slate-400">看结果</summary>
          <pre
            class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[10.5px] leading-relaxed text-slate-600"
            >{{ step.result }}</pre>
        </details>
      </li>
    </ol>

    <p v-else-if="props.running" class="mt-1.5 text-[11px] text-slate-400">
      正在看目录和配置，决定先读哪个文件…
    </p>

    <p v-if="props.outcome" class="mt-2 text-[10.5px] text-slate-500">产出：{{ props.outcome }}</p>
  </section>
</template>
