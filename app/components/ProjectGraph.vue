<script setup lang="ts">
import dagre from 'dagre'
import { MarkerType, VueFlow, useVueFlow } from '@vue-flow/core'
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
 *   · 只有分组节点计入 2~12 的上限；文件节点是展开后的子节点
 *
 * 适配几种极端情况：
 *   · 一个分组文件太多 → 展开只画前 12 个，其余用一张「还有 N 个」的卡片兜住，
 *     指向被折叠文件的边改接到分组节点上，关系不丢
 *   · 模型没给出可用的边 → 节点照画，工具栏明确提示
 *   · 坏数据在 utils/project-graph.ts 已经过滤，这里只处理合法图
 *   · 窗口尺寸变化 / 全屏 → 重新 fit view
 *
 * dagre 负责算位置（与 GraphView 一致），Vue Flow 负责渲染与交互。
 */

const props = defineProps<{
  data: ProjectGraphData
  /** 当前选中的分组节点 */
  selectedGroup?: string | null
  /** 当前展示的文件 */
  activePath?: string | null
}>()

const emit = defineEmits<{
  (e: 'select-file' | 'select-group', value: string): void
}>()

const GRAPH_ID = 'project-graph'

const NODE_W = 190
const NODE_H = 62
const HEADER_H = 48
const FILE_W = 230
const FILE_H = 42
const MORE_H = 36

/** 一个分组展开后最多画多少个文件卡片 */
const MAX_EXPANDED_FILES = 12

const TYPE_STYLE: Record<GraphNodeType, { border: string; bg: string; text: string; tag: string }> =
  {
    code: { border: '#10b981', bg: 'rgba(16,185,129,0.08)', text: '#047857', tag: '代码' },
    tech: { border: '#3b82f6', bg: 'rgba(59,130,246,0.08)', text: '#1d4ed8', tag: '技术' },
    concept: { border: '#f59e0b', bg: 'rgba(245,158,11,0.10)', text: '#b45309', tag: '概念' },
  }

/** 展开中的分组 id。默认：JSP / 页面类收起，其余展开 */
const expanded = ref<Set<string>>(new Set())

const containerRef = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)
const mounted = ref(false)

const { fitView } = useVueFlow(GRAPH_ID)

async function refit() {
  if (!mounted.value) return
  await nextTick()
  await fitView({ padding: 0.12 })
}

function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
  void refit()
}

function expandAll() {
  expanded.value = new Set(
    props.data.nodes.filter((n) => n.files && n.files.length > 0).map((n) => n.id),
  )
  void refit()
}

function collapseAll() {
  expanded.value = new Set()
  void refit()
}

function styleOf(type: GraphNodeType) {
  return TYPE_STYLE[type] ?? TYPE_STYLE.concept
}

function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

watch(
  () => props.data,
  (data) => {
    expanded.value = new Set(
      data.nodes
        .filter((n) => n.files && n.files.length > 0 && !defaultCollapsed(n))
        .map((n) => n.id),
    )
    void refit()
  },
  { immediate: true },
)

// ---------------------------------------------------------------- 布局

const layout = computed(() => {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 20, ranksep: 90, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))

  interface DisplayNode {
    id: string
    w: number
    h: number
    data: Record<string, unknown>
    type: 'wb' | 'file' | 'more'
  }

  const display: DisplayNode[] = []
  /** 展开的分组：分组头 + 它下面显示出来的文件 / 更多卡片 */
  const groupChildren: { headerId: string; childIds: string[] }[] = []

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
          active: Boolean(node.files?.some((f) => f.path === props.activePath)),
        },
      })

      const childIds: string[] = []
      const shown = node.files!.slice(0, MAX_EXPANDED_FILES)
      for (const file of shown) {
        const fileId = `f:${file.path}`
        childIds.push(fileId)
        display.push({
          id: fileId,
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
        g.setEdge(headerId, fileId)
      }

      // 文件太多：只画前 12 个，其余关系改接到分组节点上
      if (node.files!.length > MAX_EXPANDED_FILES) {
        const moreId = `m:${node.id}`
        childIds.push(moreId)
        display.push({
          id: moreId,
          w: FILE_W,
          h: MORE_H,
          type: 'more',
          data: {
            label: `还有 ${node.files!.length - MAX_EXPANDED_FILES} 个文件`,
          },
        })
        g.setEdge(headerId, moreId)
      }

      groupChildren.push({ headerId, childIds })
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
          active: Boolean(node.files?.some((f) => f.path === props.activePath)),
        },
      })
    }
  }

  const displayIds = new Set(display.map((n) => n.id))

  for (const item of display) {
    g.setNode(item.id, { width: item.w, height: item.h })
  }

  /**
   * 被「还有 N 个」折叠掉的文件，边不能丢：
   * 端点换成它所属的分组节点。其余不存在的端点直接丢掉。
   */
  function remapEndpoint(endpoint: string): string {
    if (displayIds.has(endpoint)) return endpoint
    if (endpoint.startsWith('f:')) {
      const path = endpoint.slice(2)
      const group = props.data.nodes.find((n) => n.files?.some((f) => f.path === path))
      if (group) return `n:${group.id}`
    }
    return endpoint
  }

  const realEdges = resolveGraphEdges(props.data, expanded.value)
    .map((edge) => ({
      ...edge,
      from: remapEndpoint(edge.from),
      to: remapEndpoint(edge.to),
    }))
    .filter((edge) => displayIds.has(edge.from) && displayIds.has(edge.to) && edge.from !== edge.to)

  // 每个展开出来的子节点都要有连线；源码里确实没有外部关系的，补一条虚线「归属」，
  // 只表示它属于这个分组，不冒充调用关系。
  const connected = new Set<string>()
  for (const edge of realEdges) {
    connected.add(edge.from)
    connected.add(edge.to)
  }

  const edges: { from: string; to: string; label?: string; structural: boolean }[] = realEdges.map(
    (edge) => ({ ...edge, structural: false }),
  )

  for (const group of groupChildren) {
    for (const childId of group.childIds) {
      if (!connected.has(childId)) {
        edges.push({ from: group.headerId, to: childId, label: '归属', structural: true })
      }
    }

    // 子文件都有真实边时，上面的循环一条归属线也不会画，组头就单独悬浮着。
    // 组头自己没有真实边时，补一条到第一个子文件；只画一条，避免十几条线糊成一片。
    if (!connected.has(group.headerId) && group.childIds.length > 0) {
      const first = group.childIds[0]
      const exists = edges.some((e) => e.from === group.headerId && e.to === first)
      if (!exists) {
        edges.push({ from: group.headerId, to: first, label: '归属', structural: true })
      }
    }
  }

  // 只有真实关系参与 dagre 排版；归属线只负责可见连接
  for (const edge of realEdges) g.setEdge(edge.from, edge.to)

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
    animated: !edge.structural,
    markerEnd: MarkerType.ArrowClosed,
    style: edge.structural ? { stroke: '#cbd5e1', strokeDasharray: '5 4' } : { stroke: '#cbd5e1' },
    labelStyle: { fill: edge.structural ? '#94a3b8' : '#64748b', fontSize: 10 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
  }))

  return { nodes, edges: flowEdges, realEdgeCount: realEdges.length }
})

const hasGroups = computed(() => props.data.nodes.some((n) => n.files && n.files.length > 0))
const hasEdges = computed(() => layout.value.realEdgeCount > 0)

// ---------------------------------------------------------------- 全屏与尺寸

let resizeTimer: ReturnType<typeof setTimeout> | null = null

function onResize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => void fitView({ padding: 0.1 }), 120)
}

let observer: ResizeObserver | null = null

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement)
  void refit()
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await containerRef.value?.requestFullscreen()
    }
  } catch {
    // 浏览器拒绝全屏（权限 / 环境）时不影响图形本身
  }
}

onMounted(() => {
  mounted.value = true

  if (containerRef.value) {
    observer = new ResizeObserver(onResize)
    observer.observe(containerRef.value)
  }

  document.addEventListener('fullscreenchange', onFullscreenChange)
  void refit()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (resizeTimer) clearTimeout(resizeTimer)
})
</script>

<template>
  <div
    ref="containerRef"
    class="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
    :class="isFullscreen ? 'h-screen rounded-none border-0 bg-white' : ''"
  >
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
      <span class="hidden text-slate-400 sm:inline">虚线「归属」表示源码里没有外部调用</span>

      <span v-if="!hasEdges" class="text-amber-700">模型没有给出可用的关系线</span>

      <div class="ml-auto flex items-center gap-3 text-[11px]">
        <button
          v-if="hasGroups"
          type="button"
          class="text-slate-500 hover:text-emerald-700"
          @click="expandAll"
        >
          全部展开
        </button>
        <span v-if="hasGroups" class="h-3 w-px bg-slate-200" />
        <button
          v-if="hasGroups"
          type="button"
          class="text-slate-500 hover:text-emerald-700"
          @click="collapseAll"
        >
          全部收起
        </button>
        <span class="h-3 w-px bg-slate-200" />
        <button
          type="button"
          class="text-slate-500 hover:text-emerald-700"
          @click="toggleFullscreen"
        >
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </button>
      </div>
    </div>

    <div :class="isFullscreen ? 'h-[calc(100vh-44px)] w-full' : 'h-[420px] w-full sm:h-[520px]'">
      <ClientOnly>
        <VueFlow
          :id="GRAPH_ID"
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
              class="rounded-lg border px-3 py-2 shadow-sm transition"
              :class="{
                'ring-2 ring-emerald-400 ring-offset-1':
                  p.data.filesCount && (p.data.nodeId === selectedGroup || p.data.active),
                'cursor-pointer': p.data.filesCount,
              }"
              :style="{
                width: `${NODE_W}px`,
                minHeight: `${p.data.kind === 'header' ? HEADER_H : NODE_H}px`,
                borderColor: styleOf(p.data.type).border,
                background: styleOf(p.data.type).bg,
              }"
              @click.stop="p.data.filesCount && emit('select-group', p.data.nodeId)"
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
              class="flex h-full cursor-pointer items-center gap-2 rounded-lg border border-emerald-200 border-l-[3px] border-l-emerald-500 bg-white px-2.5 shadow-sm transition"
              :class="{ 'ring-2 ring-emerald-400 ring-offset-1': p.data.path === activePath }"
              :style="{ width: `${FILE_W}px`, height: `${FILE_H}px` }"
              @click.stop="emit('select-file', p.data.path)"
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

          <!-- 文件过多时的兜底卡片 -->
          <template #node-more="p">
            <div
              class="flex h-full items-center justify-center rounded-lg border border-dashed border-emerald-300 bg-emerald-50/60 px-2 text-[10px] text-emerald-700"
              :style="{ width: `${FILE_W}px`, height: `${MORE_H}px` }"
            >
              {{ p.data.label }}
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
