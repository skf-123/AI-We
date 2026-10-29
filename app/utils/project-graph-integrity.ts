/**
 * 项目图的完整性检查。
 *
 * 只做程序能确定的事：文件有没有归属、有没有重复归属、节点是不是浮着。
 * 不自动搬文件，也不评价分层是否合理。
 */
import type { ProjectGraphData, ProjectGraphNode } from '~/types/project'
import { normalizePath } from './project-files.ts'

export function attachGraphIntegrity(
  graph: ProjectGraphData,
  knownPaths: string[] = [],
): ProjectGraphData {
  const membership = new Map<string, string[]>()
  for (const node of graph.nodes) {
    for (const file of node.files ?? []) {
      const path = normalizePath(file.path)
      const list = membership.get(path) ?? []
      list.push(node.id)
      membership.set(path, list)
    }
  }

  const duplicateFiles = [...membership.entries()]
    .filter(([, nodes]) => nodes.length > 1)
    .map(([path, nodes]) => ({ path, nodes }))

  const unownedFiles = knownPaths
    .map(normalizePath)
    .filter((path) => !membership.has(path))

  const incident = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.from.startsWith('n:')) incident.add(edge.from.slice(2))
    if (edge.to.startsWith('n:')) incident.add(edge.to.slice(2))
  }

  const nodes: ProjectGraphNode[] = graph.nodes.map((node) => {
    // 只把“有文件、但没有任何连线”的节点叫浮节点；技术节点没连线是正常的
    const floating = !incident.has(node.id) && (node.files?.length ?? 0) > 0
    const ownershipNote =
      node.files && node.files.length > 0
        ? node.files.some((file) => !file.role)
          ? '有文件没有标注角色'
          : undefined
        : undefined
    return { ...node, floating, ownershipNote }
  })

  return {
    ...graph,
    nodes,
    unownedFiles: unownedFiles.length ? unownedFiles : undefined,
    duplicateFiles: duplicateFiles.length ? duplicateFiles : undefined,
  }
}
