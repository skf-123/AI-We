<script setup lang="ts">
/**
 * 代码关系图区域。
 *
 * 这个区域**始终渲染**（不用 v-if）：没数据时显示占位提示 ——
 * 好处是图出现时页面不会突然跳高，用户一进来也知道这里会有东西。
 *
 * 组件自己不解析数据、不取数据：图 JSON 由页面算好从 props 传进来。
 * 「输出末尾那个『查看 ↓』要滚到这里」这条跨区域的动线，也由页面转接，
 * 不让「解析结果」面板直接找到这个组件 —— 两个面板之间没有引用关系。
 */
import type { GraphData } from '~/types/analysis'

defineProps<{ data: GraphData | null; loading: boolean }>()

const panelRef = ref<HTMLElement | null>(null)

/** 滚到本区域。入口在「解析结果」面板末尾，由页面转接过来 */
function scrollIntoView() {
  panelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ scrollIntoView })
</script>

<template>
  <section ref="panelRef" class="mx-auto w-full max-w-[1400px] px-4 pb-4 sm:px-6 sm:pb-6">
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="text-base font-semibold text-slate-800">代码关系图</span>
        <div class="flex items-center gap-3 text-[11px] text-slate-500">
          <span class="inline-flex items-center gap-1.5">
            <span class="h-2.5 w-2.5 rounded-sm bg-emerald-500" />代码
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="h-2.5 w-2.5 rounded-sm bg-blue-500" />技术
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="h-2.5 w-2.5 rounded-sm bg-amber-500" />概念
          </span>
        </div>
        <span class="text-[11px] text-slate-400">可拖拽节点 · 滚轮 / 双指缩放</span>
      </div>

      <div :class="data ? 'h-[420px] sm:h-[520px]' : 'h-[240px] sm:h-[300px]'">
        <GraphView v-if="data" :data="data" />

        <!--
          正在解析：把占位文字换成「代码块 → 代码关系图」的动画。

          图正在被搭出来，这里就该演这个过程 —— 而不是摆一句静态说明。
          原来的说明文字整个消失，只在动画下面留一行小字。
        -->
        <div
          v-else-if="loading"
          class="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-[#fbfcfd] px-6"
        >
          <CodeToGraphHint />
          <p class="text-xs text-slate-400">缓冲中…</p>
        </div>

        <!-- 还没开始解析：说明这块地方将来会出现什么 -->
        <div
          v-else
          class="flex h-full flex-col items-center justify-center rounded-xl border border-transparent bg-white px-6 text-center"
        >
          <span
            class="grid h-16 w-16 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"
            aria-hidden="true"
          >
            <AppIcon name="graph" class="h-7 w-7" />
          </span>
          <p class="mt-4 text-lg font-semibold text-slate-800">代码关系图会显示在这里</p>
          <p class="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
            解析完成后，麦穗会根据代码内容整理相关知识点，并展示它们之间的联系。
          </p>
          <div class="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span class="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700"
              >代码</span
            >
            <span class="text-slate-300">↔</span>
            <span class="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">技术</span>
            <span class="text-slate-300">↔</span>
            <span class="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700">概念</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
