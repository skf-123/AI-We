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
const TYPE_STYLE: Record<GraphNodeType, { border: string; bg: string; text: string; tag: string }> = {
  code: { border: '#34d399', bg: 'rgba(52,211,153,0.10)', text: '#6ee7b7', tag: '代码' },
  tech: { border: '#60a5fa', bg: 'rgba(96,165,250,0.10)', text: '#93c5fd', tag: '技术' },
  concept: { border: '#fbbf24', bg: 'rgba(251,191,36,0.10)', text: '#fcd34d', tag: '概念' },
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
    (e) => props.data.nodes.some((n) => n.id === e.from) && props.data.nodes.some((n) => n.id === e.to),
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
    style: { stroke: '#475569' },
    labelStyle: { fill: '#94a3b8', fontSize: 11 },
    labelBgStyle: { fill: '#0b1020', fillOpacity: 0.9 },
  }))

  return { nodes, edges }
})

function styleOf(type: GraphNodeType) {
  return TYPE_STYLE[type] ?? TYPE_STYLE.concept
}
</script>

<template>
  <div class="h-[440px] w-full overflow-hidden rounded-lg border border-white/10 bg-black/30">
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
        <Background :gap="18" pattern-color="#1e293b" />
        <Controls />

        <template #node-wb="p">
          <div
            class="rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm"
            :style="{
              width: `${NODE_W}px`,
              minHeight: `${NODE_H}px`,
              borderColor: styleOf(p.data.type).border,
              background: styleOf(p.data.type).bg,
            }"
          >
            <div class="text-[10px] font-medium tracking-wider" :style="{ color: styleOf(p.data.type).text }">
              {{ styleOf(p.data.type).tag }}
            </div>
            <div class="mt-0.5 text-[13px] font-semibold leading-tight text-slate-100">
              {{ p.data.label }}
            </div>
            <div v-if="p.data.detail" class="mt-0.5 text-[11px] leading-snug text-slate-400">
              {{ p.data.detail }}
            </div>
          </div>
        </template>
      </VueFlow>

      <template #fallback>
        <div class="flex h-full items-center justify-center text-sm text-slate-600">图加载中…</div>
      </template>
    </ClientOnly>
  </div>
</template>
