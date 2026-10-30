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
  /** 账本里每条边 / 结构项的最终状态，供页面/导出用 */
  applied: {
    id: string
    action: SelfCheckDecision['action'] | 'missing'
    from: string
    to: string
    label?: string
    reason?: string
    accepted: boolean
    conflictReason?: string
    pairs?: { from: string; to: string }[]
    path?: string
    toNode?: string
    node?: SelfCheckDecision['node']
    /** 节点动作的目标节点 id（不带 n: 前缀） */
    nodeId?: string
    /** remove-node 时文件的去处 */
    moveFilesTo?: string
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
        accepted: false,
        conflictReason: '模型没有给出决定',
      })
      addEdge(edge)
      return
    }

    const action = decision.action
    const entry: MergeResult['applied'][number] = {
      id: item.id,
      action,
      from: action === 'reverse' ? edge.to : edge.from,
      to: action === 'reverse' ? edge.from : edge.to,
      label: decision.label ?? edge.label,
      reason: decision.reason,
      accepted: true,
      pairs: decision.pairs,
    }
    applied.push(entry)

    if (action === 'unknown') {
      unknown++
      addEdge(edge)
      return
    }

    if (
      action === 'connect' ||
      action === 'move-file' ||
      action === 'add-node' ||
      action === 'remove-node' ||
      action === 'rename-node' ||
      action === 'update-node'
    ) {
      conflict++
      entry.accepted = false
      entry.conflictReason = '这个动作只能用在结构项上'
      addEdge(edge)
      return
    }

    if (action === 'split') {
      const pairs = decision.pairs ?? item.pairs ?? []
      if (pairs.length === 0) {
        conflict++
        entry.accepted = false
        entry.conflictReason = 'split 没有文件对'
        addEdge(edge)
        return
      }
      if (pairs.some((pair) => !paths.has(pair.from) || !paths.has(pair.to))) {
        conflict++
        entry.accepted = false
        entry.conflictReason = 'split 文件对里有未知路径'
        addEdge(edge)
        return
      }
      checked++
      entry.pairs = pairs
      for (const pair of pairs) {
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

    addEdge(next)
  })

  for (const decision of decisions) {
    if (!itemById.has(decision.id)) conflict++
  }

  for (const item of structuralItems) {
    const decision = decisionById.get(item.id)
    if (!decision) {
      applied.push({
        id: item.id,
        action: 'missing',
        from: item.from,
        to: item.to,
        label: item.label,
        reason: '模型没有给出决定',
        accepted: false,
        conflictReason: '模型没有给出决定',
      })
      continue
    }
    if (decision.action === 'unknown') {
      applied.push({
        id: item.id,
        action: 'unknown',
        from: item.from,
        to: item.to,
        label: item.label,
        reason: decision.reason,
        accepted: true,
      })
      continue
    }
    if (decision.action === 'keep' || decision.action === 'relabel') {
      applied.push({
        id: item.id,
        action: decision.action,
        from: item.from,
        to: item.to,
        label: decision.label ?? item.label,
        reason: decision.reason,
        accepted: true,
      })
      continue
    }
    structuralChecked++
    const source = item.from
    if (decision.action === 'connect') {
      const to = decision.to ?? ''
      if (!canConnect(source, to)) {
        conflict++
        applied.push({
          id: item.id,
          action: decision.action,
          from: source,
          to,
          label: decision.label ?? item.label,
          reason: decision.reason,
          accepted: false,
          conflictReason: 'connect 端点不存在、相同或不是已知文件/节点',
        })
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
        accepted: true,
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
        applied.push({
          id: item.id,
          action: decision.action,
          from: source,
          to: next?.id ?? '',
          label: next?.label ?? item.label,
          reason: decision.reason,
          accepted: false,
          conflictReason: '新节点 id 重复、超过 12 个、type 不合法或文件不在已知路径',
          node: next,
        })
        continue
      }
      const nextFiles = [...new Set(next.files)]
      // 一个文件只能属于一个节点；已经归属过的文件要用 move-file，不能靠新建节点再占一次。
      if (
        nodes.some((node) =>
          node.files?.some((file) => nextFiles.includes(file.path)),
        )
      ) {
        conflict++
        applied.push({
          id: item.id,
          action: decision.action,
          from: source,
          to: next.id,
          label: next.label,
          reason: decision.reason,
          accepted: false,
          conflictReason: 'add-node 的文件已属于其他节点，请用 move-file',
          node: next,
        })
        continue
      }
      nodes.push({
        id: next.id,
        label: next.label,
        type: (next.type ?? 'code') as ProjectGraphNode['type'],
        files: nextFiles.map((path) => ({ path })),
      })
      nodeIds.add(next.id)
      applied.push({
        id: item.id,
        action: decision.action,
        from: source,
        to: next.id,
        label: next.label,
        reason: decision.reason,
        accepted: true,
        node: next,
      })
      continue
    }

    if (decision.action === 'move-file') {
      const path = decision.path ?? item.paths?.[0]
      const target = endpointOf(decision.toNode ?? '')
      if (!path || !paths.has(path) || !nodeIds.has(target)) {
        conflict++
        applied.push({
          id: item.id,
          action: decision.action,
          from: path ? `f:${path}` : source,
          to: decision.toNode ?? '',
          reason: decision.reason,
          accepted: false,
          conflictReason: 'move-file 的文件或目标节点不存在',
          path,
          toNode: decision.toNode,
        })
        continue
      }
      // 先记下原文件的角色，再把它从所有节点移走；否则目标节点只剩路径，
      // 节点上会冒出“有文件没有标注角色”。
      let movedRole: string | undefined
      for (const node of nodes) {
        if (!node.files) continue
        const match = node.files.find((file) => file.path === path)
        if (match?.role) movedRole = match.role
        const nextFiles = node.files.filter((file) => file.path !== path)
        node.files = nextFiles.length ? nextFiles : undefined
      }
      const targetNode = nodes.find((node) => node.id === target)
      if (!targetNode) {
        conflict++
        applied.push({
          id: item.id,
          action: decision.action,
          from: `f:${path}`,
          to: `n:${target}`,
          reason: decision.reason,
          accepted: false,
          conflictReason: 'move-file 目标节点不存在',
          path,
          toNode: decision.toNode,
        })
        continue
      }
      targetNode.files = [
        ...(targetNode.files ?? []),
        movedRole ? { path, role: movedRole } : { path },
      ]
      applied.push({
        id: item.id,
        action: decision.action,
        from: `f:${path}`,
        to: `n:${target}`,
        reason: decision.reason,
        accepted: true,
        path,
        toNode: decision.toNode,
      })
      continue
    }

    if (decision.action === 'split') {
      conflict++
      applied.push({
        id: item.id,
        action: decision.action,
        from: source,
        to: item.to,
        reason: decision.reason,
        accepted: false,
        conflictReason: 'split 只能用于分组边',
        pairs: decision.pairs,
      })
      continue
    }

    if (
      decision.action === 'remove-node' ||
      decision.action === 'rename-node' ||
      decision.action === 'update-node'
    ) {
      const rawId = decision.nodeId ?? (source.startsWith('n:') ? source : '')
      const targetId = rawId ? endpointOf(rawId) : ''
      const target = targetId ? nodes.find((node) => node.id === targetId) : undefined
      const reject = (reason: string): void => {
        conflict++
        applied.push({
          id: item.id,
          action: decision.action,
          from: targetId ? `n:${targetId}` : source,
          to: decision.moveFilesTo ?? '',
          label: decision.label ?? item.label,
          reason: decision.reason,
          accepted: false,
          conflictReason: reason,
          nodeId: targetId || undefined,
          moveFilesTo: decision.moveFilesTo,
        })
      }

      if (!target) {
        reject(targetId ? '节点动作的目标节点不存在' : '这个动作只能用在节点项上')
        continue
      }

      if (decision.action === 'remove-node') {
        // 删节点不能留下悬空边，也不能直接丢文件。
        if (
          resultEdges.some(
            (edge) =>
              endpointOf(edge.from) === targetId || endpointOf(edge.to) === targetId,
          )
        ) {
          reject('节点还被边引用，先删边或改边再删节点')
          continue
        }
        const files = target.files ?? []
        if (files.length > 0) {
          const destId = endpointOf(decision.moveFilesTo ?? '')
          if (!destId) {
            reject('节点还有文件，用 moveFilesTo 指定文件去处')
            continue
          }
          const dest = nodes.find((node) => node.id === destId && node.id !== targetId)
          if (!dest) {
            reject('remove-node 的文件去处不是已有节点')
            continue
          }
          const existing = new Set((dest.files ?? []).map((file) => file.path))
          for (const file of files) {
            if (existing.has(file.path)) continue
            dest.files = [...(dest.files ?? []), { ...file }]
            existing.add(file.path)
          }
        }
        const index = nodes.indexOf(target)
        if (index >= 0) nodes.splice(index, 1)
        nodeIds.delete(targetId)
        applied.push({
          id: item.id,
          action: decision.action,
          from: `n:${targetId}`,
          to: decision.moveFilesTo ?? '',
          label: target.label,
          reason: decision.reason,
          accepted: true,
          nodeId: targetId,
          moveFilesTo: decision.moveFilesTo,
          node: {
            id: targetId,
            label: target.label,
            type: target.type,
            files: files.map((file) => file.path),
          },
        })
        continue
      }

      if (decision.action === 'rename-node') {
        const label = decision.label?.trim()
        if (!label) {
          reject('rename-node 没有给出新名称')
          continue
        }
        target.label = label
        applied.push({
          id: item.id,
          action: decision.action,
          from: `n:${targetId}`,
          to: '',
          label,
          reason: decision.reason,
          accepted: true,
          nodeId: targetId,
          node: {
            id: targetId,
            label,
            type: target.type,
            files: target.files?.map((file) => file.path),
          },
        })
        continue
      }

      // update-node：只改名称 / 类型 / 说明，不动文件归属。
      const label = decision.label?.trim()
      const type = decision.type?.trim()
      const detail = decision.detail?.trim()
      if (!label && !type && !detail) {
        reject('update-node 没有给出要修改的字段')
        continue
      }
      if (type && !['code', 'tech', 'concept'].includes(type)) {
        reject('update-node 的类型不在 code / tech / concept 里')
        continue
      }
      if (label) target.label = label
      if (type) target.type = type as ProjectGraphNode['type']
      if (detail) target.detail = detail
      applied.push({
        id: item.id,
        action: decision.action,
        from: `n:${targetId}`,
        to: '',
        label: target.label,
        reason: decision.reason,
        accepted: true,
        nodeId: targetId,
        node: {
          id: targetId,
          label: target.label,
          type: target.type,
          files: target.files?.map((file) => file.path),
        },
      })
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
