/**
 * 把分批自检的 decisions 合并回项目图。
 *
 * 只做确定性的结构改动：keep / remove / reverse / relabel / unknown。
 * 节点、文件归属一律不动；端点是否合法、重复边由这里统一校验。
 */
import type { ProjectGraphData, ProjectGraphEdge, ProjectGraphNode } from '~/types/project'
import type {
  SelfCheckCoverage,
  SelfCheckDecision,
  SelfCheckItem,
} from '~/types/self-check'

function edgeKey(edge: Pick<ProjectGraphEdge, 'from' | 'to' | 'label'>): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.label ?? ''}`
}

function endpointOf(value: string): string {
  return value.startsWith('n:') ? value.slice(2) : value
}

function validEndpoint(
  value: string,
  nodeIds: Set<string>,
  paths: Set<string>,
): boolean {
  if (value.startsWith('n:')) return nodeIds.has(value.slice(2))
  if (value.startsWith('f:')) return paths.has(value.slice(2))
  return false
}

export interface MergeResult {
  graph: ProjectGraphData
  coverage: SelfCheckCoverage
  /** 账本里每条边的最终状态，供页面/导出用 */
  applied: {
    id: string
    action: SelfCheckDecision['action'] | 'missing'
    from: string
    to: string
    label?: string
    reason?: string
  }[]
}

export function mergeSelfCheckDecisions(
  graph: ProjectGraphData,
  items: SelfCheckItem[],
  decisions: SelfCheckDecision[],
  supported: number,
  knownPaths: string[] = [],
): MergeResult {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const decisionById = new Map(decisions.map((decision) => [decision.id, decision]))
  const resultEdges: ProjectGraphEdge[] = []
  const seen = new Set<string>()
  const applied: MergeResult['applied'] = []
  const structuralItems = items.filter((item) => item.edgeIndex < 0)
  const nodes: ProjectGraphNode[] = graph.nodes.map((node) => ({
    ...node,
    files: node.files?.map((file) => ({ ...file })),
  }))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const paths = new Set<string>([
    ...nodes.flatMap((node) => node.files?.map((file) => file.path) ?? []),
    ...(graph.unownedFiles ?? []),
    ...knownPaths,
  ])
  let conflict = 0
  let checked = supported
  let unknown = 0
  let structuralChecked = 0

  function addEdge(edge: ProjectGraphEdge): void {
    const key = edgeKey(edge)
    if (seen.has(key)) return
    seen.add(key)
    resultEdges.push(edge)
  }

  function canConnect(from: string, to: string): boolean {
    return (
      from !== to &&
      validEndpoint(from, nodeIds, paths) &&
      validEndpoint(to, nodeIds, paths)
    )
  }

  graph.edges.forEach((edge, index) => {
    const item = items.find((row) => row.edgeIndex === index)
    if (!item) {
      addEdge(edge)
      return
    }

    const decision = decisionById.get(item.id)
    if (!decision) {
      unknown++
      applied.push({
        id: item.id,
        action: 'missing',
        from: edge.from,
        to: edge.to,
        label: edge.label,
        reason: '模型没有给出决定',
      })
      addEdge(edge)
      return
    }

    const action = decision.action
    applied.push({
      id: item.id,
      action,
      from: action === 'reverse' ? edge.to : edge.from,
      to: action === 'reverse' ? edge.from : edge.to,
      label: decision.label ?? edge.label,
      reason: decision.reason,
    })

    if (action === 'unknown') {
      unknown++
      addEdge(edge)
      return
    }

    if (action === 'connect' || action === 'move-file' || action === 'add-node') {
      conflict++
      addEdge(edge)
      return
    }

    checked++
    if (action === 'remove') return

    if (action === 'split') {
      const pairs = decision.pairs ?? item.pairs ?? []
      if (pairs.length === 0) {
        conflict++
        addEdge(edge)
        return
      }
      for (const pair of pairs) {
        if (!paths.has(pair.from) || !paths.has(pair.to)) {
          conflict++
          continue
        }
        addEdge({
          from: `f:${pair.from}`,
          to: `f:${pair.to}`,
          label: decision.label ?? edge.label,
          confidence: 'partial',
          note: '自检拆分分组边',
        })
      }
      return
    }

    const next: ProjectGraphEdge =
      action === 'reverse'
        ? {
            ...edge,
            from: edge.to,
            to: edge.from,
            label: decision.label ?? edge.label,
            note: '自检把方向改回来了',
          }
        : {
            ...edge,
            label: decision.label ?? edge.label,
          }

    addEdge(next)
  })

  for (const decision of decisions) {
    if (!itemById.has(decision.id)) conflict++
  }

  for (const item of structuralItems) {
    const decision = decisionById.get(item.id)
    if (!decision || decision.action === 'unknown') continue
    structuralChecked++
    const source = item.from
    if (decision.action === 'connect') {
      const to = decision.to ?? ''
      if (!canConnect(source, to)) {
        conflict++
        continue
      }
      addEdge({
        from: source,
        to,
        label: decision.label ?? item.label,
        confidence: 'inferred',
        note: '自检补充关系',
      })
      applied.push({
        id: item.id,
        action: decision.action,
        from: source,
        to,
        label: decision.label ?? item.label,
        reason: decision.reason,
      })
      continue
    }

    if (decision.action === 'add-node') {
      const next = decision.node
      if (
        !next ||
        nodeIds.has(next.id) ||
        nodes.length >= 12 ||
        !['code', 'tech', 'concept'].includes(next.type ?? 'code') ||
        !next.files?.length ||
        next.files.some((path) => !paths.has(path))
      ) {
        conflict++
        continue
      }
      nodes.push({
        id: next.id,
        label: next.label,
        type: (next.type ?? 'code') as ProjectGraphNode['type'],
        files: [...new Set(next.files)].map((path) => ({ path })),
      })
      nodeIds.add(next.id)
      applied.push({
        id: item.id,
        action: decision.action,
        from: source,
        to: next.id,
        label: next.label,
        reason: decision.reason,
      })
      continue
    }

    if (decision.action === 'move-file') {
      const path = decision.path ?? item.paths?.[0]
      const target = endpointOf(decision.toNode ?? '')
      if (!path || !paths.has(path) || !nodeIds.has(target)) {
        conflict++
        continue
      }
      for (const node of nodes) {
        if (!node.files) continue
        const nextFiles = node.files.filter((file) => file.path !== path)
        node.files = nextFiles.length ? nextFiles : undefined
      }
      const targetNode = nodes.find((node) => node.id === target)
      if (!targetNode) {
        conflict++
        continue
      }
      targetNode.files = [...(targetNode.files ?? []), { path }]
      applied.push({
        id: item.id,
        action: decision.action,
        from: `f:${path}`,
        to: `n:${target}`,
        reason: decision.reason,
      })
      continue
    }

    if (decision.action === 'split') {
      conflict++
      continue
    }
  }

  const floatingCount = nodes.filter((node) => node.floating).length
  const groupOnlyCount = graph.edges.filter(
    (edge) => Boolean(edge.filePairs?.length) || Boolean(edge.note?.includes('分组关系')),
  ).length

  return {
    graph: { ...graph, nodes, edges: resultEdges },
    coverage: {
      total: graph.edges.length,
      checked,
      unknown,
      conflict,
      supported,
      ...(floatingCount ? { floating: floatingCount } : {}),
      ...(groupOnlyCount ? { groupOnly: groupOnlyCount } : {}),
      ...(graph.unownedFiles?.length ? { unowned: graph.unownedFiles.length } : {}),
      ...(graph.duplicateFiles?.length ? { duplicate: graph.duplicateFiles.length } : {}),
      ...(structuralItems.length
        ? { structural: structuralItems.length, structuralChecked }
        : {}),
    },
    applied,
  }
}
