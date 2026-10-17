<script setup lang="ts">
import dagre from 'dagre'
import { MarkerType, VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

import type { GraphNodeType } from '~/types/analysis'
import type { ProjectGraphData } from '~/types/project'
import { defaultCollapsed, resolveGraphEdges } from '~/utils/project-graph'

/**
 * 项目级知识框架图 —— 分组可展开 / 收起。
 *
 * 关键规则（快照第十一节第 30 条第 3 小节）：
 *   · 图数据只存文件级关系；展开 / 收起是渲染变换，不请求接口
 *   · 端点所在分组收起时，把端点换成分组节点 —— 不删边
 *   · 分组内部的关系在收起态不画（两端都落在同一个分组里，画出来是自环）
 *   · 只有分组节点计入 5~12 的上限；文件节点是展开后的子节点
 *
 * dagre 负责算位置（与 GraphView 一致），Vue Flow 负责渲染与交互。
 */

const props = defineProps<{ data: ProjectGraphData }>()

const NODE_W = 190
const NODE_H = 62
const HEADER_H = 48
const FILE_W = 230
const FILE_H = 42

const TYPE_STYLE: Record<GraphNodeType, { border: string; bg: string; text: string; tag: string }> =
  {
    code: { border: '#10b981', bg: 'rgba(16,185,129,0.08)', text: '#047857', tag: '代码' },
    tech: { border: '#3b82f6', bg: 'rgba(59,130,246,0.08)', text: '#1d4ed8', tag: '技术' },
    concept: { border: '#f59e0b', bg: 'rgba(245,158,11,0.10)', text: '#b45309', tag: '概念' },
  }

/** 展开中的分组 id。默认：JSP / 页面类收起，其余展开 */
const expanded = ref<Set<string>>(new Set())

watch(
  () => props.data,
  (data) => {
    expanded.value = new Set(
      data.nodes
        .filter((n) => n.files && n.files.length > 0 && !defaultCollapsed(n))
        .map((n) => n.id),
    )
  },
  { immediate: true },
)

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function expandAll() {
  expanded.value = new Set(
    props.data.nodes.filter((n) => n.files && n.files.length > 0).map((n) => n.id),
  )
}

function collapseAll() {
  expanded.value = new Set()
}

function styleOf(type: GraphNodeType) {
  return TYPE_STYLE[type] ?? TYPE_STYLE.concept
}

function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

const layout = computed(() => {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 20, ranksep: 90, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))

  interface DisplayNode {
    id: string
    w: number
    h: number
    data: Record<string, unknown>
    type: 'wb' | 'file'
  }

  const display: DisplayNode[] = []

  for (const node of props.data.nodes) {
    const isGroup = Boolean(node.files && node.files.length > 0)

    if (isGroup && expanded.value.has(node.id)) {
      const headerId = `n:${node.id}`
      display.push({
        id: headerId,
        w: NODE_W,
        h: HEADER_H,
        type: 'wb',
        data: {
          kind: 'header',
          nodeId: node.id,
          label: node.label,
          type: node.type,
          detail: node.detail,
          filesCount: node.files!.length,
          expanded: true,
        },
      })

      for (const file of node.files!) {
        display.push({
          id: `f:${file.path}`,
          w: FILE_W,
          h: FILE_H,
          type: 'file',
          data: {
            path: file.path,
            label: baseName(file.path),
            role: file.role,
          },
        })
        // 只用于排版的隐形边，不进 Vue Flow
        g.setEdge(headerId, `f:${file.path}`)
      }
    } else {
      display.push({
        id: `n:${node.id}`,
        w: NODE_W,
        h: NODE_H,
        type: 'wb',
        data: {
          kind: isGroup ? 'collapsed' : 'standalone',
          nodeId: node.id,
          label: node.label,
          type: node.type,
          detail: node.detail,
          filesCount: isGroup ? node.files!.length : 0,
          expanded: false,
        },
      })
    }
  }

  const displayIds = new Set(display.map((n) => n.id))

  for (const item of display) {
    g.setNode(item.id, { width: item.w, height: item.h })
  }

  const edges = resolveGraphEdges(props.data, expanded.value).filter(
    (e) => displayIds.has(e.from) && displayIds.has(e.to),
  )

  for (const edge of edges) g.setEdge(edge.from, edge.to)

  dagre.layout(g)

  const nodes = display.map((item) => {
    const p = g.node(item.id)
    return {
      id: item.id,
      type: item.type,
      position: {
        x: (p?.x ?? 0) - item.w / 2,
        y: (p?.y ?? 0) - item.h / 2,
      },
      data: item.data,
      draggable: true,
    }
  })

  const flowEdges = edges.map((edge, i) => ({
    id: `e-${i}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    animated: true,
    markerEnd: MarkerType.ArrowClosed,
    style: { stroke: '#cbd5e1' },
    labelStyle: { fill: '#64748b', fontSize: 10 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
  }))

  return { nodes, edges: flowEdges }
})

const hasGroups = computed(() => props.data.nodes.some((n) => n.files && n.files.length > 0))
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-white px-3 py-2 text-[11px] text-slate-500"
    >
      <span class="inline-flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm bg-emerald-500" />代码
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm bg-blue-500" />技术
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-2 w-2 rounded-sm bg-amber-500" />概念
      </span>
      <span class="text-slate-400">只数分组节点 · 展开出的文件不另计</span>

      <div v-if="hasGroups" class="ml-auto flex items-center gap-3 text-[11px]">
        <button type="button" class="text-slate-500 hover:text-emerald-700" @click="expandAll">
          全部展开
        </button>
        <span class="h-3 w-px bg-slate-200" />
        <button type="button" class="text-slate-500 hover:text-emerald-700" @click="collapseAll">
          全部收起
        </button>
      </div>
    </div>

    <div class="h-[520px] w-full">
      <ClientOnly>
        <VueFlow
          :nodes="layout.nodes"
          :edges="layout.edges"
          :fit-view-on-init="true"
          :min-zoom="0.2"
          :max-zoom="1.8"
          :nodes-connectable="false"
          :elements-selectable="true"
        >
          <Background :gap="18" pattern-color="#dbe2ea" />
          <Controls />

          <!-- 普通节点：独立节点 / 收起的分组 / 展开后的分组头 -->
          <template #node-wb="p">
            <div
              class="rounded-lg border px-3 py-2 shadow-sm"
              :style="{
                width: `${NODE_W}px`,
                minHeight: `${p.data.kind === 'header' ? HEADER_H : NODE_H}px`,
                borderColor: styleOf(p.data.type).border,
                background: styleOf(p.data.type).bg,
              }"
            >
              <div class="flex items-center gap-1.5">
                <span
                  class="text-[10px] font-medium tracking-wider"
                  :style="{ color: styleOf(p.data.type).text }"
                >
                  {{ styleOf(p.data.type).tag }}
                </span>

                <span
                  v-if="p.data.filesCount"
                  class="rounded-full border border-slate-200 bg-white/80 px-1.5 text-[9px] text-slate-500"
                >
                  {{ p.data.filesCount }} 个文件
                </span>

                <button
                  v-if="p.data.filesCount"
                  type="button"
                  class="ml-auto rounded-full border border-emerald-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 hover:bg-emerald-50"
                  @click.stop="toggle(p.data.nodeId)"
                >
                  {{ p.data.expanded ? '收起' : '展开' }}
                </button>
              </div>

              <div class="mt-0.5 truncate text-[13px] font-semibold leading-tight text-slate-800">
                {{ p.data.label }}
              </div>
              <div
                v-if="p.data.detail"
                class="mt-0.5 truncate text-[11px] leading-snug text-slate-500"
              >
                {{ p.data.detail }}
              </div>
            </div>
          </template>

          <!-- 展开后的文件卡片 -->
          <template #node-file="p">
            <div
              class="flex h-full items-center gap-2 rounded-lg border border-emerald-200 border-l-[3px] border-l-emerald-500 bg-white px-2.5 shadow-sm"
              :style="{ width: `${FILE_W}px`, height: `${FILE_H}px` }"
            >
              <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <div class="min-w-0">
                <div class="truncate font-mono text-[10.5px] text-slate-700">
                  {{ p.data.label }}
                </div>
                <div v-if="p.data.role" class="truncate text-[9.5px] text-slate-400">
                  {{ p.data.role }}
                </div>
              </div>
            </div>
          </template>
        </VueFlow>

        <template #fallback>
          <div class="flex h-full items-center justify-center text-sm text-slate-400">
            图加载中…
          </div>
        </template>
      </ClientOnly>
    </div>
  </div>
</template>
