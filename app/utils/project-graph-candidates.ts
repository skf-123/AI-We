/**
 * 把项目图里的边和源码里的候选边做确定性比较。
 *
 * 只回答“图里的这条边在 import 里有没有依据 / 方向是不是反的”，
 * 不判断业务语义，也不自动删边。程序给出的差异交给自检模型核对。
 */

import type { CandidateScan } from './project-candidate-edges'
import type { GraphLike } from './project-graph-diff'

export type GraphSuspicionKind = 'unsupported' | 'reversed'

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
  for (const node of graph.nodes) {
    nodeFiles.set(node.id, new Set((node.files ?? []).map((file) => file.path)))
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

  return {
    suspicions,
    supported,
    unknown,
    totalEdges: graph.edges.length,
  }
}
