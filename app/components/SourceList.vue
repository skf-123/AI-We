<script setup lang="ts">
/**
 * 引用来源卡片列表。
 *
 * 数据来自响应头 X-Rag-Sources，是服务端检索完就定下来的事实，
 * 所以这些卡片在正文开始流式输出之前就已经能显示了。
 *
 * 编号 [1][2] 与正文里模型标注的编号一一对应 ——
 * 两边用的是同一份数组的下标，天然对齐。
 */

interface RagSource {
  id: string
  title: string
  label: string
  url: string
  score: number
}

defineProps<{ sources: RagSource[] }>()
</script>

<template>
  <section class="rounded-lg border border-sky-400/25 bg-sky-500/[0.06] p-3.5">
    <div class="mb-2.5 flex flex-wrap items-center gap-2">
      <span class="text-sm font-semibold text-sky-300">引用来源</span>
      <span class="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-200">
        知识库检索到 {{ sources.length }} 条
      </span>
      <span class="text-[11px] text-slate-500">点击标题可查看原始出处</span>
    </div>

    <ol class="space-y-2">
      <li
        v-for="(item, index) in sources"
        :key="item.id"
        class="flex gap-2.5 rounded-md border border-white/5 bg-black/25 p-2.5"
      >
        <span
          class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-sky-500/20 text-[11px] font-medium text-sky-300"
        >
          {{ index + 1 }}
        </span>

        <div class="min-w-0 flex-1">
          <a
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[13px] font-medium text-slate-200 underline decoration-slate-600 underline-offset-2 transition hover:text-sky-300 hover:decoration-sky-400"
          >
            {{ item.title }}
          </a>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500">
            <span>{{ item.label }}</span>
            <span class="text-slate-600">相似度 {{ item.score.toFixed(3) }}</span>
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>
