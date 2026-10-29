/**
 * 分批图自检的清单与批次。
 *
 * 只做纯数据：
 *   · 每条边一项，只把 reversed / unsupported 的边送模型；
 *   · 按起点所在分组聚类，每批最多 8 条；
 *   · 给每批算需求分和工具额度，供预算分配用。
 *
 * 不碰模型、不碰 DOM；模型只拿到这里生成的批次。
 */
import type { ProjectGraphData, ProjectGraphEdge } from '~/types/project'
import type { GraphSuspicion } from '~/utils/project-graph-candidates'
import type {
  SelfCheckBatch,
  SelfCheckItem,
  SelfCheckItemKind,
  SelfCheckNodeSummary,
  SelfCheckOverview,
} from '~/types/self-check'

export const SELF_CHECK_BATCH_SIZE = 8
export const SELF_CHECK_MAX_TOOL_ALLOWANCE = 6

/** 地址栏加 `?selfcheck=batch` 才启用分批；默认仍走原来的自检。 */
export function selfCheckBatchEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('selfcheck') === 'batch'
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

function edgeKey(edge: Pick<ProjectGraphEdge, 'from' | 'to' | 'label'>): string {
  return `${edge.from}\u0000${edge.to}\u0000${edge.label ?? ''}`
}

/** 端点属于哪个分组；文件端点通过 nodes[].files 反查 */
function groupOf(endpoint: string, graph: ProjectGraphData): string {
  if (endpoint.startsWith('n:')) return endpoint.slice(2)
  if (!endpoint.startsWith('f:')) return 'other'

  const path = endpoint.slice(2)
  const group = graph.nodes.find((node) => node.files?.some((file) => file.path === path))
  return group?.id ?? 'other'
}

function nodeSummary(endpoint: string, graph: ProjectGraphData): SelfCheckNodeSummary {
  if (endpoint.startsWith('n:')) {
    const id = endpoint.slice(2)
    const node = graph.nodes.find((row) => row.id === id)
    return { id: endpoint, label: node?.label ?? id, type: node?.type ?? 'code' }
  }
  if (endpoint.startsWith('f:')) {
    const path = endpoint.slice(2)
    return { id: endpoint, label: basename(path), type: 'file' }
  }
  return { id: endpoint, label: endpoint, type: 'unknown' }
}

function kindOf(suspicion: GraphSuspicion | undefined): SelfCheckItemKind | null {
  if (!suspicion) return null
  if (suspicion.kind === 'reversed') return 'reversed'
  if (suspicion.kind === 'unsupported') return 'unsupported'
  return null
}

export interface SelfCheckPlan {
  /** 所有边；没进批的也在里面，status 由 supported 表示 */
  items: SelfCheckItem[]
  batches: SelfCheckBatch[]
  supported: number
  total: number
  overview: SelfCheckOverview
}

export function buildSelfCheckPlan(
  graph: ProjectGraphData,
  suspicions: GraphSuspicion[],
): SelfCheckPlan {
  const byKey = new Map<string, GraphSuspicion>()
  for (const suspicion of suspicions) {
    byKey.set(`${suspicion.from}\u0000${suspicion.to}\u0000${suspicion.label ?? ''}`, suspicion)
  }

  const items: SelfCheckItem[] = []
  let supported = 0

  graph.edges.forEach((edge, edgeIndex) => {
    // 程序已经用事实核实过的边，不再送给模型；partial 和 inferred 仍然核。
    if (edge.confidence === 'verified') {
      supported++
      return
    }
    const suspicion = byKey.get(edgeKey(edge))
    const kind = kindOf(suspicion)
    if (!kind) {
      supported++
      return
    }
    items.push({
      id: `E${edgeIndex}`,
      edgeIndex,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      kind,
      detail: suspicion?.detail ?? '',
      batch: 0,
    })
  })

  // 按起点分组聚类，再按 edgeIndex 保留稳定顺序
  const grouped = new Map<string, SelfCheckItem[]>()
  for (const item of items) {
    const key = groupOf(item.from, graph)
    const list = grouped.get(key) ?? []
    list.push(item)
    grouped.set(key, list)
  }

  const batches: SelfCheckBatch[] = []
  for (const list of [...grouped.values()].sort((a, b) => a[0]!.edgeIndex - b[0]!.edgeIndex)) {
    const sorted = [...list].sort((a, b) => a.edgeIndex - b.edgeIndex)
    for (let i = 0; i < sorted.length; i += SELF_CHECK_BATCH_SIZE) {
      const slice = sorted.slice(i, i + SELF_CHECK_BATCH_SIZE)
      const index = batches.length + 1
      for (const item of slice) item.batch = index

      const endpoints = new Set<string>()
      for (const item of slice) {
        endpoints.add(item.from)
        endpoints.add(item.to)
      }

      const crossGroup = slice.some(
        (item) => groupOf(item.from, graph) !== groupOf(item.to, graph),
      )
      const score =
        slice.filter((item) => item.kind === 'reversed').length * 2 +
        slice.filter((item) => item.kind === 'unsupported').length * 2 +
        (crossGroup ? 1 : 0)

      batches.push({
        index,
        items: slice,
        nodes: [...endpoints].map((endpoint) => nodeSummary(endpoint, graph)),
        paths: [...endpoints]
          .filter((endpoint) => endpoint.startsWith('f:'))
          .map((endpoint) => endpoint.slice(2)),
        score,
        toolAllowance: Math.min(
          SELF_CHECK_MAX_TOOL_ALLOWANCE,
          Math.max(1, score),
        ),
      })
    }
  }

  return {
    items,
    batches,
    supported,
    total: graph.edges.length,
    overview: {
      groups: graph.nodes
        .filter((node) => node.files && node.files.length > 0)
        .map((node) => node.label),
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      supported,
      total: graph.edges.length,
      floating: graph.nodes.filter((node) => node.floating).length,
      groupOnly: graph.edges.filter(
        (edge) => Boolean(edge.filePairs?.length) || Boolean(edge.note?.includes('分组关系')),
      ).length,
      unowned: graph.unownedFiles?.length ?? 0,
      duplicate: graph.duplicateFiles?.length ?? 0,
    },
  }
}

/** 模型看到的批次内容；不带完整图、不带全部文件路径。 */
export function formatBatchContent(
  batch: SelfCheckBatch,
  projectContext: string,
  overview: SelfCheckOverview,
): string {
  const edges = batch.items
    .map(
      (item) =>
        `- ${item.id}：${item.from} -> ${item.to}${item.label ? `（当前标签：${item.label}）` : ''}\n  预检：${item.kind}${item.detail ? `；${item.detail}` : ''}`,
    )
    .join('\n')

  const nodes = batch.nodes
    .map((node) => `- ${node.id}：${node.label}（${node.type}）`)
    .join('\n')

  const groups = overview.groups.length > 0 ? overview.groups.join('、') : '（没有分组）'

  return `【全图摘要】节点 ${overview.nodes} 个，边 ${overview.edges} 条；程序已支持 ${overview.supported} 条；浮节点 ${overview.floating} 个，分组边 ${overview.groupOnly} 条，未归属文件 ${overview.unowned} 个，重复归属 ${overview.duplicate} 个；分组：${groups}

【本批边】共 ${batch.items.length} 条，只处理这些
${edges}

【涉及的节点】
${nodes}

【可读文件】只列本批端点；工具仍按完整可读列表校验
${batch.paths.map((path) => `- ${path}`).join('\n') || '（没有文件端点）'}

【项目结构结论（只作背景，不要据此编造）】
${projectContext.slice(0, 20_000)}

【规则】
- 只对本批每条边回一个决定：keep / remove / reverse / relabel / unknown；
- reverse 表示把 from/to 对调；relabel 只改标签；unknown 表示证据不足；
- 没有证据就写 unknown，不要猜；不要输出完整图；
- 需要读文件时，按工具格式申请，最多 ${batch.toolAllowance} 次；程序可能按预算拒绝。

【输出】
只输出一个 JSON 对象，不要 Markdown 代码围栏：
{"decisions":[{"id":"E12","action":"reverse","label":"新的标签","reason":"依据","evidence":["path:line"]}]}`
}
