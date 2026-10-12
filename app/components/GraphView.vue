<script setup lang="ts">
/**
 * 知识框架图 —— 把 AI 输出的图数据渲染成节点 + 连线。
 *
 * 分工很明确：
 *   - dagre 负责"算位置"：给它节点和连线，它自动算出每个节点该摆在哪
 *   - Vue Flow 负责"画出来"：渲染、拖拽、缩放、平移
 * 我们自己只负责把 AI 给的数据喂给它们。
 */
import dagre from 'dagre'
import { MarkerType, VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

/** 节点类型，必须与 server/utils/prompt.ts 里约定的三种一致 */
type GraphNodeType = 'code' | 'tech' | 'concept'

interface GraphNode {
  id: string
  label: string
  type: GraphNodeType
  detail?: string
}
interface GraphEdge {
  from: string
  to: string
  label?: string
}
interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const props = defineProps<{ data: GraphData }>()

/** 节点卡片的尺寸，dagre 要靠它算间距 */
const NODE_W = 190
const NODE_H = 62

/** 三种节点类型的配色 */
const TYPE_STYLE: Record<GraphNodeType, { border: string; bg: string; text: string; tag: string }> =
  {
    code: { border: '#10b981', bg: 'rgba(16,185,129,0.08)', text: '#047857', tag: '代码' },
    tech: { border: '#3b82f6', bg: 'rgba(59,130,246,0.08)', text: '#1d4ed8', tag: '技术' },
    concept: { border: '#f59e0b', bg: 'rgba(245,158,11,0.10)', text: '#b45309', tag: '概念' },
  }

const layout = computed(() => {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 45, ranksep: 85, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of props.data.nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H })
  }
  // 只连两端都存在的线，防止 AI 偶尔给出对不上的 id 直接把图画崩
  const validEdges = props.data.edges.filter(
    (e) =>
      props.data.nodes.some((n) => n.id === e.from) && props.data.nodes.some((n) => n.id === e.to),
  )
  for (const e of validEdges) g.setEdge(e.from, e.to)

  dagre.layout(g)

  const nodes = props.data.nodes.map((n) => {
    const p = g.node(n.id)
    return {
      id: n.id,
      // 全部用同一个自定义节点类型，具体长什么样由 data.type 决定
      type: 'wb',
      position: { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
      data: n,
      draggable: true,
    }
  })

  const edges = validEdges.map((e, i) => ({
    id: `e-${i}`,
    source: e.from,
    target: e.to,
    label: e.label,
    animated: true,
    markerEnd: MarkerType.ArrowClosed,
    style: { stroke: '#cbd5e1' },
    labelStyle: { fill: '#64748b', fontSize: 11 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
  }))

  return { nodes, edges }
})

function styleOf(type: GraphNodeType) {
  return TYPE_STYLE[type] ?? TYPE_STYLE.concept
}
</script>

<template>
  <div class="h-full w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
    <!-- Vue Flow 依赖浏览器 API，必须只在客户端渲染 -->
    <ClientOnly>
      <VueFlow
        :nodes="layout.nodes"
        :edges="layout.edges"
        :fit-view-on-init="true"
        :min-zoom="0.25"
        :max-zoom="1.8"
        :nodes-connectable="false"
        :elements-selectable="true"
      >
        <Background :gap="18" pattern-color="#dbe2ea" />
        <Controls />

        <template #node-wb="p">
          <div
            class="rounded-lg border px-3 py-2 shadow-sm"
            :style="{
              width: `${NODE_W}px`,
              minHeight: `${NODE_H}px`,
              borderColor: styleOf(p.data.type).border,
              background: styleOf(p.data.type).bg,
            }"
          >
            <div
              class="text-[10px] font-medium tracking-wider"
              :style="{ color: styleOf(p.data.type).text }"
            >
              {{ styleOf(p.data.type).tag }}
            </div>
            <div class="mt-0.5 text-[13px] font-semibold leading-tight text-slate-800">
              {{ p.data.label }}
            </div>
            <div v-if="p.data.detail" class="mt-0.5 text-[11px] leading-snug text-slate-500">
              {{ p.data.detail }}
            </div>
          </div>
        </template>
      </VueFlow>

      <template #fallback>
        <div class="flex h-full items-center justify-center text-sm text-slate-400">图加载中…</div>
      </template>
    </ClientOnly>
  </div>
</template>
