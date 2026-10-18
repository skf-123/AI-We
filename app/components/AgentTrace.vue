<script setup lang="ts">
import type { AgentStep } from '~/composables/useProjectAgent'

/**
 * 项目侦查 Agent 的轨迹。
 *
 * 纯展示：每一步都是模型真实发起的工具调用与工具结果，不是编造的思考链。
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
}>()

const emit = defineEmits<{
  (e: 'stop'): void
}>()
</script>

<template>
  <section class="shrink-0 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-[11px] font-medium text-slate-600">Agent 侦查</span>

      <span
        v-if="props.running"
        class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-700"
      >
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        正在决定下一步
      </span>
      <span v-else-if="props.error" class="text-[10.5px] text-rose-600">
        未完成，已回退到固定地图
      </span>
      <span v-else-if="props.stopped" class="text-[10.5px] text-amber-700">已停止</span>
      <span v-else-if="props.fallback" class="text-[10.5px] text-amber-700">
        已回退到固定地图
      </span>
      <span v-else class="text-[10.5px] text-slate-400">已完成</span>

      <span class="text-[10px] text-slate-400">工具在浏览器里执行，文件没有上传</span>

      <span class="ml-auto text-[10px] text-slate-400">
        {{ props.round }} / {{ props.maxRounds }} 轮
      </span>
      <button
        v-if="props.running"
        type="button"
        class="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] text-slate-600 transition hover:bg-slate-50"
        @click="emit('stop')"
      >
        停止
      </button>
    </div>

    <p v-if="props.error" class="mt-1.5 text-[11px] leading-relaxed text-rose-600">
      {{ props.error }}
    </p>

    <ol v-if="props.steps.length" class="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
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
  </section>
</template>
