/**
 * 把项目图里的边和源码里的候选边做确定性比较。
 *
 * 只回答“图里的这条边在 import 里有没有依据 / 方向是不是反的”，
 * 不判断业务语义，也不自动删边。程序给出的差异交给自检模型核对。
 */

import type { ProjectGraphData } from '~/types/project'
import type { CandidateScan } from './project-candidate-edges'
import type { GraphLike } from './project-graph-diff'

export type GraphSuspicionKind = 'unsupported' | 'reversed' | 'floating' | 'group-only'

export interface GraphSuspicion {
  kind: GraphSuspicionKind
  from: string
  to: string
  label?: string
  detail: string
}

export interface GraphCandidateReport {
  suspicions: GraphSuspicion[]
  supported: number
  unknown: number
  totalEdges: number
}

function endpointFiles(
  endpoint: string,
  nodeFiles: Map<string, Set<string>>,
): Set<string> {
  if (endpoint.startsWith('f:')) {
    return new Set([endpoint.slice(2)])
  }
  if (endpoint.startsWith('n:')) {
    return nodeFiles.get(endpoint.slice(2)) ?? new Set()
  }
  return new Set()
}

function shortList(paths: Iterable<string>): string {
  const list = [...paths]
  if (list.length === 0) return ''
  return list.length > 2 ? `${list.slice(0, 2).join('、')} 等 ${list.length} 个文件` : list.join('、')
}

export function compareGraphToCandidates(
  graph: GraphLike,
  scan: CandidateScan,
): GraphCandidateReport {
  const nodeFiles = new Map<string, Set<string>>()
  const pathToNode = new Map<string, string>()
  for (const node of graph.nodes) {
    const files = new Set((node.files ?? []).map((file) => file.path))
    nodeFiles.set(node.id, files)
    for (const path of files) pathToNode.set(path, node.id)
  }

  const incidentNodes = new Set<string>()
  for (const edge of graph.edges) {
    for (const endpoint of [edge.from, edge.to]) {
      if (endpoint.startsWith('n:')) {
        incidentNodes.add(endpoint.slice(2))
      } else if (endpoint.startsWith('f:')) {
        const nodeId = pathToNode.get(endpoint.slice(2))
        if (nodeId) incidentNodes.add(nodeId)
      }
    }
  }

  const parsedPaths = new Set(scan.paths)
  const suspicions: GraphSuspicion[] = []
  let supported = 0
  let unknown = 0

  for (const edge of graph.edges) {
    const fromFiles = endpointFiles(edge.from, nodeFiles)
    const toFiles = endpointFiles(edge.to, nodeFiles)

    if (fromFiles.size === 0 || toFiles.size === 0) {
      unknown++
      continue
    }

    const fromParsed = [...fromFiles].filter((path) => parsedPaths.has(path))
    const toParsed = [...toFiles].filter((path) => parsedPaths.has(path))
    if (fromParsed.length === 0 || toParsed.length === 0) {
      unknown++
      continue
    }

    const same = scan.edges.find(
      (candidate) => fromFiles.has(candidate.from) && toFiles.has(candidate.to),
    )
    if (same) {
      supported++
      continue
    }

    const reverse = scan.edges.find(
      (candidate) => toFiles.has(candidate.from) && fromFiles.has(candidate.to),
    )
    if (reverse) {
      suspicions.push({
        kind: 'reversed',
        from: edge.from,
        to: edge.to,
        label: edge.label,
        detail: `图上是 ${shortList(fromFiles)} → ${shortList(toFiles)}，但 import 是反的：${reverse.from}:${reverse.line} ${reverse.evidence}`,
      })
      continue
    }

    // 有文件没解析过时，缺候选边可能只是没读到，不能判成“没有关系”
    if (fromParsed.length < fromFiles.size || toParsed.length < toFiles.size) {
      unknown++
      continue
    }

    suspicions.push({
      kind: 'unsupported',
      from: edge.from,
      to: edge.to,
      label: edge.label,
      detail: `候选 import 里没有找到 ${shortList(fromFiles)} → ${shortList(toFiles)} 的关系`,
    })
  }

  // 两端都是分组、而且有文件级候选支撑的边：可以落到文件，也可以保留分组级；
  // 只作为“可选核对”，不跟“找不到依据”混在一起。
  for (const edge of graph.edges) {
    if (!edge.from.startsWith('n:') || !edge.to.startsWith('n:')) continue
    const fromId = edge.from.slice(2)
    const toId = edge.to.slice(2)
    const fromFiles = nodeFiles.get(fromId)
    const toFiles = nodeFiles.get(toId)
    if (!fromFiles?.size || !toFiles?.size) continue

    const supported = scan.edges.some(
      (candidate) => fromFiles.has(candidate.from) && toFiles.has(candidate.to),
    )
    if (!supported) continue

    suspicions.push({
      kind: 'group-only',
      from: edge.from,
      to: edge.to,
      label: edge.label,
      detail: `「${fromId}」→「${toId}」两端都是分组，但 import 里已有文件级依据；有预算时可以落到具体文件，没有就保留分组级并标注`,
    })
  }

  for (const node of graph.nodes) {
    if (incidentNodes.has(node.id)) continue
    suspicions.push({
      kind: 'floating',
      from: `n:${node.id}`,
      to: '',
      label: node.label,
      detail: `节点「${node.label ?? node.id}」没有任何连线；要么补一条真实关系，要么在角色里标注「无外部调用」`,
    })
  }

  return {
    suspicions,
    supported,
    unknown,
    totalEdges: graph.edges.length,
  }
}

/** 程序已经用事实核实过的边，不再交给旧路径重复审 */
export function filterVerifiedSuspicions(
  graph: ProjectGraphData,
  suspicions: GraphSuspicion[],
): GraphSuspicion[] {
  const key = (edge: { from: string; to: string; label?: string }) =>
    `${edge.from}\u0000${edge.to}\u0000${edge.label ?? ''}`
  const verified = new Set(
    graph.edges.filter((edge) => edge.confidence === 'verified').map(key),
  )
  return suspicions.filter((item) => !verified.has(key(item)))
}
