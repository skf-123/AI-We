<script setup lang="ts">
/**
 * 知识框架图区域。
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
    <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="text-sm text-slate-500">知识框架图</span>
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

      <div class="h-[300px] sm:h-[400px]">
        <GraphView v-if="data" :data="data" />

        <!--
          正在解析：把占位文字换成「代码块 → 知识框架图」的动画。

          图正在被搭出来，这里就该演这个过程 —— 而不是摆一句静态说明。
          原来的说明文字整个消失，只在动画下面留一行小字。
        -->
        <div
          v-else-if="loading"
          class="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-6"
        >
          <CodeToGraphHint />
          <p class="text-xs text-slate-400">缓冲中…</p>
        </div>

        <!-- 还没开始解析：说明这块地方将来会出现什么 -->
        <div
          v-else
          class="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-6 text-center"
        >
          <p class="text-sm leading-relaxed text-slate-400">
            解析完成后，这里会画出这段代码的知识框架图<br />
            <span class="text-[13px]">
              节点分三类：
              <span class="text-emerald-600">代码</span>、
              <span class="text-blue-600">技术</span>、
              <span class="text-amber-600">概念</span>
            </span>
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
