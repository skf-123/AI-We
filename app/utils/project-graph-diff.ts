/**
 * 比较自检前后的两张项目图。
 *
 * 只回答「改了什么」，不判断「改得对不对」。调用方拿这个结果做轨迹提示，
 * 不能把它当成质量评分。
 *
 * 比较前做归一化：
 *   · 节点按 id 比，不看数组顺序；
 *   · 边按「起点 → 终点」分组，再看标签集合，不看顺序；
 *   · 文件按路径归属比，不看节点或文件的排列顺序。
 */

export interface GraphNodeLike {
  id: string
  label?: string
  detail?: string
  files?: { path: string }[]
}

export interface GraphEdgeLike {
  from: string
  to: string
  label?: string
}

export interface GraphLike {
  nodes: GraphNodeLike[]
  edges: GraphEdgeLike[]
}

export interface ProjectGraphDiff {
  nodesAdded: number
  nodesRemoved: number
  nodesChanged: number
  edgesAdded: number
  edgesRemoved: number
  edgesRelabeled: number
  filesAdded: number
  filesRemoved: number
  filesMoved: number
  total: number
  changed: boolean
}

function nodeSignature(node: GraphNodeLike): string {
  return `${node.label ?? ''}\u0000${node.detail ?? ''}`
}

function collectEdgeLabels(graph: GraphLike): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const key = `${edge.from}->${edge.to}`
    const labels = map.get(key) ?? []
    labels.push(edge.label ?? '')
    map.set(key, labels)
  }
  return map
}

function collectFiles(graph: GraphLike): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of graph.nodes) {
    for (const file of node.files ?? []) map.set(file.path, node.id)
  }
  return map
}

export function diffProjectGraph(before: GraphLike, after: GraphLike): ProjectGraphDiff {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]))
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]))

  let nodesAdded = 0
  let nodesRemoved = 0
  let nodesChanged = 0

  for (const id of afterNodes.keys()) {
    if (!beforeNodes.has(id)) nodesAdded++
  }
  for (const [id, node] of beforeNodes) {
    const next = afterNodes.get(id)
    if (!next) {
      nodesRemoved++
      continue
    }
    if (nodeSignature(node) !== nodeSignature(next)) nodesChanged++
  }

  const beforeEdges = collectEdgeLabels(before)
  const afterEdges = collectEdgeLabels(after)
  const edgeKeys = new Set([...beforeEdges.keys(), ...afterEdges.keys()])

  let edgesAdded = 0
  let edgesRemoved = 0
  let edgesRelabeled = 0

  for (const key of edgeKeys) {
    const beforeLabels = [...(beforeEdges.get(key) ?? [])].sort()
    const afterLabels = [...(afterEdges.get(key) ?? [])].sort()

    if (beforeLabels.length === 0) {
      edgesAdded += afterLabels.length
      continue
    }
    if (afterLabels.length === 0) {
      edgesRemoved += beforeLabels.length
      continue
    }

    // 同一条端点关系上，先配掉完全相同的标签，剩下的算标签变化；
    // 两边数量不一样时，多出来的那几条算新增或删除。
    const remaining = new Map<string, number>()
    for (const label of beforeLabels) remaining.set(label, (remaining.get(label) ?? 0) + 1)

    let matched = 0
    for (const label of afterLabels) {
      const count = remaining.get(label) ?? 0
      if (count > 0) {
        matched++
        remaining.set(label, count - 1)
      }
    }

    const beforeLeft = beforeLabels.length - matched
    const afterLeft = afterLabels.length - matched
    const relabeled = Math.min(beforeLeft, afterLeft)

    edgesRelabeled += relabeled
    edgesRemoved += beforeLeft - relabeled
    edgesAdded += afterLeft - relabeled
  }

  const beforeFiles = collectFiles(before)
  const afterFiles = collectFiles(after)

  let filesAdded = 0
  let filesRemoved = 0
  let filesMoved = 0

  for (const [path, nodeId] of afterFiles) {
    const previousNode = beforeFiles.get(path)
    if (!previousNode) {
      filesAdded++
    } else if (previousNode !== nodeId) {
      filesMoved++
    }
  }
  for (const path of beforeFiles.keys()) {
    if (!afterFiles.has(path)) filesRemoved++
  }

  const total =
    nodesAdded +
    nodesRemoved +
    nodesChanged +
    edgesAdded +
    edgesRemoved +
    edgesRelabeled +
    filesAdded +
    filesRemoved +
    filesMoved

  return {
    nodesAdded,
    nodesRemoved,
    nodesChanged,
    edgesAdded,
    edgesRemoved,
    edgesRelabeled,
    filesAdded,
    filesRemoved,
    filesMoved,
    total,
    changed: total > 0,
  }
}
