/**
 * 把分批自检的 decisions 合并回项目图。
 *
 * 只做确定性的结构改动：keep / remove / reverse / relabel / unknown。
 * 节点、文件归属一律不动；端点是否合法、重复边由这里统一校验。
 */
import type { ProjectGraphData, ProjectGraphEdge } from '~/types/project'
import type {
  SelfCheckCoverage,
  SelfCheckDecision,
  SelfCheckItem,
} from '~/types/self-check'

function edgeKey(edge: Pick<ProjectGraphEdge, 'from' | 'to' | 'label'>): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.label ?? ''}`
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
): MergeResult {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const decisionById = new Map(decisions.map((decision) => [decision.id, decision]))
  const resultEdges: ProjectGraphEdge[] = []
  const seen = new Set<string>()
  const applied: MergeResult['applied'] = []
  let conflict = 0
  let checked = supported
  let unknown = 0

  graph.edges.forEach((edge, index) => {
    const item = items.find((row) => row.edgeIndex === index)
    if (!item) {
      // 程序已支持或不在本批清单里：原样保留
      const key = edgeKey(edge)
      if (!seen.has(key)) {
        seen.add(key)
        resultEdges.push(edge)
      }
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
      const key = edgeKey(edge)
      if (!seen.has(key)) {
        seen.add(key)
        resultEdges.push(edge)
      }
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
      const key = edgeKey(edge)
      if (!seen.has(key)) {
        seen.add(key)
        resultEdges.push(edge)
      }
      return
    }

    checked++
    if (action === 'remove') return

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

    const key = edgeKey(next)
    if (seen.has(key)) {
      // 反向/改标签后和已有边重复：不再重复画，但不当作错误
      return
    }
    seen.add(key)
    resultEdges.push(next)
  })

  // 防御：模型给了不存在的 id
  for (const decision of decisions) {
    if (!itemById.has(decision.id)) conflict++
  }

  return {
    graph: { ...graph, edges: resultEdges },
    coverage: {
      total: graph.edges.length,
      checked,
      unknown,
      conflict,
      supported,
    },
    applied,
  }
}
