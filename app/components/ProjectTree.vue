<script setup lang="ts">
import type { ConfigMode, FileProgress, ProjectTreeNode } from '~/types/project'

/**
 * 目录树的外壳：图例 + 递归节点 + 说明状态。
 * 卡片头部、底部统计与「开始解析」按钮在页面里 —— 那是页面级的编排。
 */

defineProps<{
  nodes: ProjectTreeNode[]
  progress: Record<string, FileProgress>
  loadingNotes?: boolean
  notesDegraded?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-file' | 'open-file' | 'retry', path: string): void
  (e: 'toggle-folder', node: ProjectTreeNode): void
  (e: 'config-mode', path: string, mode: ConfigMode): void
}>()
</script>

<template>
  <div>
    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] text-slate-500"
    >
      <span class="inline-flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm bg-emerald-500" />用户代码 · 读内容
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm bg-indigo-400" />配置 · 默认仅作上下文
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm bg-slate-300" />依赖 / 产物 · 只登记位置
      </span>
      <span class="ml-auto text-slate-400">勾选可手动取消或补勾</span>
    </div>

    <div class="px-2 py-2">
      <p v-if="loadingNotes" class="px-2 py-1 text-[11.5px] text-slate-400">正在生成目录说明…</p>
      <p v-else-if="notesDegraded" class="px-2 py-1 text-[11.5px] text-amber-700">
        目录说明没生成成功，不影响下面的逐文件解析。
      </p>

      <ul>
        <ProjectTreeNode
          v-for="node in nodes"
          :key="node.path"
          :node="node"
          :progress="progress"
          :depth="0"
          @toggle-file="(p) => emit('toggle-file', p)"
          @toggle-folder="(n) => emit('toggle-folder', n)"
          @config-mode="(p, m) => emit('config-mode', p, m)"
          @open-file="(p) => emit('open-file', p)"
          @retry="(p) => emit('retry', p)"
        />
      </ul>
    </div>
  </div>
</template>
