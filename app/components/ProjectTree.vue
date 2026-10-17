<script setup lang="ts">
import type { ConfigMode, FileProgress, ProjectTreeNode } from '~/types/project'
import { allSystem } from '~/utils/project-files'

/**
 * 目录树的外壳：图例 + 递归节点 + 说明状态。
 * 卡片头部、底部统计与「开始解析」按钮在页面里 —— 那是页面级的编排。
 *
 * 文件夹的展开 / 收起状态统一放在这里（openMap），这样顶层才能一次全展开 /
 * 全收起；单个节点只读状态、往上报事件，自己不再持有展开状态。
 */

const props = defineProps<{
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

const openMap = reactive<Record<string, boolean>>({})

/** 新出现的文件夹给默认值：系统分支收起，其余展开。已有的不覆盖用户操作 */
function initOpen(nodes: ProjectTreeNode[]) {
  for (const node of nodes) {
    if (node.type !== 'folder') continue
    if (!(node.path in openMap)) openMap[node.path] = !allSystem(node)
    initOpen(node.children ?? [])
  }
}

watch(
  () => props.nodes,
  (nodes) => initOpen(nodes),
  { immediate: true },
)

function toggleOpen(path: string) {
  openMap[path] = !openMap[path]
}

function setAllOpen(value: boolean) {
  const walk = (nodes: ProjectTreeNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'folder') continue
      openMap[node.path] = value
      walk(node.children ?? [])
    }
  }
  walk(props.nodes)
}
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
      <div class="ml-auto flex items-center gap-2 text-slate-400">
        <span class="hidden sm:inline">勾选可手动取消或补勾</span>
        <span class="hidden h-3 w-px bg-slate-200 sm:inline-block" />
        <button type="button" class="hover:text-emerald-700" @click="setAllOpen(true)">
          全部展开
        </button>
        <button type="button" class="hover:text-emerald-700" @click="setAllOpen(false)">
          全部收起
        </button>
      </div>
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
          :open="openMap[node.path] ?? true"
          :open-map="openMap"
          @toggle-file="(p) => emit('toggle-file', p)"
          @toggle-folder="(n) => emit('toggle-folder', n)"
          @config-mode="(p, m) => emit('config-mode', p, m)"
          @open-file="(p) => emit('open-file', p)"
          @retry="(p) => emit('retry', p)"
          @toggle-open="toggleOpen"
        />
      </ul>
    </div>
  </div>
</template>
