/**
 * 项目图的解析与渲染换算。
 *
 * 数据形态与「贴代码」入口不同：
 *   节点分两类 —— 带 files 的分组节点、不带 files 的独立节点
 *   边只存文件级关系，端点是 "n:<id>" 或 "f:<路径>"
 *
 * 展开 / 收起是**渲染变换**：同一份边，按分组当前是展开还是收起，
 * 把端点换成文件节点或分组节点。所以不存两套图，也不发请求。
 */

import type { ProjectGraphData, ProjectGraphEdge, ProjectGraphNode } from '~/types/project'
import { normalizePath } from './project-files'

/** 与 server/utils/project-prompt.ts 的 PROJECT_SUMMARY_TITLES 保持一致 */
export const PROJECT_TEXT_TITLE = '一、整个项目是什么'
export const PROJECT_GRAPH_TITLE = '二、项目知识框架图'

/** 从汇总输出里抠出图 JSON（流式过程中不完整时返回 null） */
function extractGraphJson(rest: string): unknown {
  const fenced = rest.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced ? fenced[1] : rest).trim()
  const trimmed = fenced ? candidate : candidate.slice(0, candidate.lastIndexOf('}') + 1)

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

/** 模型给的 id / 路径可能带空格、反斜杠、缺前缀 —— 这里做一次宽松归一 */
function endpointOf(raw: unknown, nodeIds: Set<string>, knownPaths: Set<string>): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null

  if (value.startsWith('n:')) {
    const id = value.slice(2).trim()
    return nodeIds.has(id) ? `n:${id}` : null
  }

  if (value.startsWith('f:')) {
    const path = normalizePath(value.slice(2).trim())
    return knownPaths.has(path) ? `f:${path}` : null
  }

  // 容忍模型漏写前缀
  if (nodeIds.has(value)) return `n:${value}`
  const path = normalizePath(value)
  return knownPaths.has(path) ? `f:${path}` : null
}

/**
 * 校验模型输出。
 *
 * 原则与主链路一致：**坏数据只丢那一条，不能让整张图崩**。
 *   · id 不存在 / 路径不存在的边 → 丢
 *   · 自己连自己的边 → 丢
 *   · 重复的边 → 去重
 *   · 节点超过 12 个 → 只留前 12 个（提示词要求 2~12）
 */
export function sanitizeProjectGraph(raw: unknown, knownPaths: string[]): ProjectGraphData | null {
  if (!raw || typeof raw !== 'object') return null

  const source = raw as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(source.nodes)) return null

  const pathSet = new Set(knownPaths.map(normalizePath))
  const nodes: ProjectGraphNode[] = []
  const usedIds = new Set<string>()

  for (const item of source.nodes) {
    if (nodes.length >= 12) break
    if (!item || typeof item !== 'object') continue

    const row = item as {
      id?: unknown
      label?: unknown
      type?: unknown
      detail?: unknown
      files?: unknown
    }

    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!id || usedIds.has(id)) continue
    usedIds.add(id)

    const type =
      row.type === 'tech' || row.type === 'concept' || row.type === 'code' ? row.type : 'code'

    const files: { path: string; role?: string }[] = []
    if (Array.isArray(row.files)) {
      const seen = new Set<string>()
      for (const f of row.files) {
        if (!f || typeof f !== 'object') continue
        const fileRow = f as { path?: unknown; role?: unknown }
        if (typeof fileRow.path !== 'string') continue
        const path = normalizePath(fileRow.path.trim())
        if (!pathSet.has(path) || seen.has(path)) continue
        seen.add(path)
        files.push({
          path,
          role: typeof fileRow.role === 'string' ? fileRow.role.trim().slice(0, 30) : undefined,
        })
      }
    }

    nodes.push({
      id,
      label: typeof row.label === 'string' && row.label.trim() ? row.label.trim().slice(0, 30) : id,
      type,
      detail: typeof row.detail === 'string' ? row.detail.trim().slice(0, 60) : undefined,
      files: files.length > 0 ? files : undefined,
    })
  }

  if (nodes.length === 0) return null

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges: ProjectGraphEdge[] = []
  const seenEdges = new Set<string>()

  if (Array.isArray(source.edges)) {
    for (const item of source.edges) {
      if (!item || typeof item !== 'object') continue
      const row = item as { from?: unknown; to?: unknown; label?: unknown }

      const from = endpointOf(row.from, nodeIds, pathSet)
      const to = endpointOf(row.to, nodeIds, pathSet)
      if (!from || !to || from === to) continue

      const label = typeof row.label === 'string' ? row.label.trim().slice(0, 40) : ''
      const key = `${from}->${to}->${label}`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)

      edges.push({ from, to, label: label || undefined })
    }
  }

  return { nodes, edges }
}

/** 汇总输出 → 项目文字 + 项目图。图 JSON 还没流完时 graph 为 null */
export function parseProjectSummary(
  text: string,
  knownPaths: string[],
): { text: string; graph: ProjectGraphData | null } {
  const start = text.indexOf(`## ${PROJECT_GRAPH_TITLE}`)

  if (start === -1) {
    return { text: stripTextTitle(text), graph: null }
  }

  const body = text.slice(0, start)
  const rest = text.slice(start + `## ${PROJECT_GRAPH_TITLE}`.length)

  return {
    text: stripTextTitle(body),
    graph: sanitizeProjectGraph(extractGraphJson(rest), knownPaths),
  }
}

function stripTextTitle(text: string): string {
  return text.replace(`## ${PROJECT_TEXT_TITLE}`, '').trim()
}

/** 这个分组默认收起吗？设计稿：JSP 类收起，Servlet / Service / DAO 展开 */
export function defaultCollapsed(node: ProjectGraphNode): boolean {
  if (!node.files || node.files.length === 0) return false
  return /jsp|页面|视图|模板|view|page/i.test(node.label)
}

/**
 * 把一条边的端点换算成渲染时的节点 id。
 *
 *   文件所在分组展开 → f:<路径>
 *   文件所在分组收起 → n:<分组 id>
 *   独立节点         → n:<id>（原样）
 */
export function resolveEndpoint(
  endpoint: string,
  graph: ProjectGraphData,
  expanded: Set<string>,
): string {
  if (!endpoint.startsWith('f:')) return endpoint

  const path = endpoint.slice(2)
  const group = graph.nodes.find((n) => n.files?.some((f) => f.path === path))

  if (group && group.files && group.files.length > 0) {
    return expanded.has(group.id) ? `f:${path}` : `n:${group.id}`
  }

  return endpoint
}

/** 渲染用的边：端点换算后自己连自己的边丢掉（分组内部关系在收起态不画） */
export function resolveGraphEdges(
  graph: ProjectGraphData,
  expanded: Set<string>,
): ProjectGraphEdge[] {
  const seen = new Set<string>()
  const result: ProjectGraphEdge[] = []

  for (const edge of graph.edges) {
    const from = resolveEndpoint(edge.from, graph, expanded)
    const to = resolveEndpoint(edge.to, graph, expanded)
    if (from === to) continue

    const key = `${from}->${to}->${edge.label ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ from, to, label: edge.label })
  }

  return result
}
