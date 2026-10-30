/**
 * 分批图自检的清单与批次。
 *
 * 只做纯数据：
 *   · 每条边一项：reversed / unsupported / inferred / partial 送模型；
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
/** 未归属文件一条一项太贵；最多送这么多，剩下的继续显示未归属 */
export const SELF_CHECK_MAX_UNOWNED = 16
/** 收尾调用不读文件，只允许这些边动作 */
export const SELF_CHECK_FINAL_ACTIONS = [
  'keep',
  'remove',
  'reverse',
  'relabel',
  'unknown',
] as const

/** 默认走分批；地址栏加 `?selfcheck=legacy` 才回到旧路径。 */
export function selfCheckBatchEnabledFromSearch(search: string): boolean {
  const mode = new URLSearchParams(search).get('selfcheck')
  return mode !== 'legacy' && mode !== 'old'
}

export function selfCheckBatchEnabled(): boolean {
  if (typeof window === 'undefined') return true
  return selfCheckBatchEnabledFromSearch(window.location.search)
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

/**
 * 批次优先级：数字越小越先跑。
 *
 * 0 关键边（方向反、没依据）—— 最可能错，最值钱；
 * 1 重要结构项（重复归属、浮节点、节点问题）；
 * 2 普通边（推断、部分依据、分组边）；
 * 3 未归属文件——重要但一条一项太贵，放最后。
 */
function rankOf(item: SelfCheckItem): number {
  if (item.edgeIndex < 0) {
    if (item.kind === 'duplicate' || item.kind === 'floating' || item.kind === 'node') {
      return 1
    }
    return 3
  }
  if (item.kind === 'reversed' || item.kind === 'unsupported') return 0
  return 2
}

/** 收尾调用只处理没拿到决定的边，不再把结构项送进去 */
export function selectFinalReserveItems(
  items: SelfCheckItem[],
  decidedIds: Set<string>,
): SelfCheckItem[] {
  return items.filter((item) => item.edgeIndex >= 0 && !decidedIds.has(item.id))
}

/**
 * 图证据本身也能产生可疑项：没有依据、只有部分依据、方向相反。
 *
 * 有 filePairs 的分组边也进清单，让模型决定拆成哪些文件对；
 * 程序不再把“多对聚合”直接当成已解决。
 */
function kindFromEdge(edge: ProjectGraphEdge): SelfCheckItemKind | null {
  if (edge.filePairs?.length) return 'group-only'
  if (edge.note?.includes('方向和图上的边相反')) return 'reversed'
  if (edge.confidence === 'inferred') return 'inferred'
  if (edge.confidence === 'partial') return 'partial'
  return null
}

function edgeDetail(edge: ProjectGraphEdge, kind: SelfCheckItemKind): string {
  if (kind === 'inferred') return '程序没有找到这条边的文件级依据'
  if (kind === 'partial') return '只有部分文件对找到了程序依据'
  if (kind === 'group-only') return edge.note ?? `分组边，涉及 ${edge.filePairs?.length ?? 0} 对文件`
  return edge.note ?? ''
}

export interface SelfCheckPlan {
  /** 所有边和结构项；没进批的边也在里面，status 由 supported 表示 */
  items: SelfCheckItem[]
  batches: SelfCheckBatch[]
  supported: number
  total: number
  /** 清单里的结构项数量；不计入 total（total 只数边） */
  structural: number
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
    const kind = kindOf(suspicion) ?? kindFromEdge(edge)
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
      detail: suspicion?.detail || edgeDetail(edge, kind),
      batch: 0,
      pairs: edge.filePairs?.map((pair) => ({ from: pair.from, to: pair.to })),
    })
  })

  // 结构项：浮节点、未归属、重复归属。
  // 它们不是边，不能混进 edges 总数；单独计数、单独合并。
  const groupCandidates = graph.nodes
    .filter((node) => node.files && node.files.length > 0)
    .map((node) => ({ id: `n:${node.id}`, label: node.label, type: node.type }))
  let structuralIndex = 0
  for (const node of graph.nodes) {
    if (!node.floating || !node.files?.length) continue
    items.push({
      id: `S${++structuralIndex}`,
      edgeIndex: -1,
      from: `n:${node.id}`,
      to: '',
      label: node.label,
      kind: 'floating',
      detail: '节点有文件，但没有任何外部连线',
      batch: 0,
      paths: node.files.map((file) => file.path),
      candidates: groupCandidates.filter((candidate) => candidate.id !== `n:${node.id}`),
    })
  }
  const unowned = (graph.unownedFiles ?? []).slice(0, SELF_CHECK_MAX_UNOWNED)
  for (const [index, path] of unowned.entries()) {
    items.push({
      id: `U${index + 1}`,
      edgeIndex: -1,
      from: `f:${path}`,
      to: '',
      kind: 'unowned',
      detail: '文件没有出现在任何节点的 files 列表里',
      batch: 0,
      paths: [path],
      candidates: groupCandidates,
    })
  }
  for (const [index, row] of (graph.duplicateFiles ?? []).entries()) {
    items.push({
      id: `D${index + 1}`,
      edgeIndex: -1,
      from: `f:${row.path}`,
      to: '',
      kind: 'duplicate',
      detail: `文件同时属于：${row.nodes.map((id) => `n:${id}`).join('、')}`,
      batch: 0,
      paths: [row.path],
      candidates: groupCandidates.filter((candidate) =>
        row.nodes.some((id) => candidate.id === `n:${id}`),
      ),
    })
  }

  // 节点项：只送程序能看出问题的节点，不把所有节点都交给模型。
  // 浮节点已经有 S 项，这里跳过，避免同一个节点出现两次。
  const labelCounts = new Map<string, number>()
  for (const node of graph.nodes) {
    const label = (node.label ?? '').trim()
    if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
  }
  let nodeIndex = 0
  for (const node of graph.nodes) {
    if (node.floating) continue
    const label = (node.label ?? '').trim()
    const reasons: string[] = []
    if (!label) reasons.push('节点没有名称')
    else if (label === node.id) reasons.push('节点名称就是 id')
    else if ((labelCounts.get(label) ?? 0) > 1) reasons.push(`有多个节点同名「${label}」`)
    if (node.type === 'code' && !node.files?.length) {
      reasons.push('标记为代码分组，但没有归属任何文件')
    }
    // 类型缺省不算问题：旧数据 / 测试夹具没有 type，不能因此把所有节点都送进清单。
    if (node.type && !['code', 'tech', 'concept'].includes(node.type)) {
      reasons.push(`类型 ${node.type} 不在 code / tech / concept 里`)
    }
    if (!reasons.length) continue
    items.push({
      id: `N${++nodeIndex}`,
      edgeIndex: -1,
      from: `n:${node.id}`,
      to: '',
      label: node.label,
      kind: 'node',
      detail: reasons.join('；'),
      batch: 0,
      paths: (node.files ?? []).map((file) => file.path),
      candidates: groupCandidates.filter((candidate) => candidate.id !== `n:${node.id}`),
    })
  }

  // 按起点分组聚类，再按 edgeIndex 保留稳定顺序
  const grouped = new Map<string, SelfCheckItem[]>()
  for (const item of items) {
    // 结构项单独归组，不跟边混；这样批次类别和预算上限才能算清。
    const key = item.edgeIndex < 0 ? `\u0000structural:${item.kind}` : groupOf(item.from, graph)
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
        if (item.from) endpoints.add(item.from)
        if (item.to) endpoints.add(item.to)
        for (const path of item.paths ?? []) endpoints.add(`f:${path}`)
        for (const pair of item.pairs ?? []) {
          endpoints.add(`f:${pair.from}`)
          endpoints.add(`f:${pair.to}`)
        }
      }

      const crossGroup = slice.some(
        (item) => groupOf(item.from, graph) !== groupOf(item.to, graph),
      )
      const score =
        slice.filter((item) => item.kind === 'reversed').length * 2 +
        slice.filter((item) => item.kind === 'unsupported').length * 2 +
        slice.filter((item) => item.kind === 'inferred' || item.kind === 'partial').length +
        slice.reduce(
          (sum, item) =>
            sum + (item.kind === 'group-only' ? (item.pairs?.length ?? 1) : 0),
          0,
        ) +
        slice.filter((item) => item.edgeIndex < 0).length * 2 +
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
        rank: Math.min(...slice.map(rankOf)),
        category: slice.every((item) => item.edgeIndex < 0) ? 'structural' : 'edge',
      })
    }
  }

  // 先按优先级，再按原 edgeIndex 稳定排序；排序后重新编号
  batches.sort(
    (a, b) => a.rank - b.rank || a.items[0]!.edgeIndex - b.items[0]!.edgeIndex,
  )
  batches.forEach((batch, i) => {
    batch.index = i + 1
    for (const item of batch.items) item.batch = batch.index
  })

  return {
    items,
    batches,
    supported,
    total: graph.edges.length,
    structural: items.filter((item) => item.edgeIndex < 0).length,
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
      nodeIssues: items.filter((item) => item.kind === 'node').length,
    },
  }
}

/** 模型看到的批次内容；不带完整图、不带全部文件路径。 */
export function formatBatchContent(
  batch: SelfCheckBatch,
  projectContext: string,
  overview: SelfCheckOverview,
): string {
  const edgeItems = batch.items.filter(
    (item) => item.edgeIndex >= 0 && item.kind !== 'group-only',
  )
  const structuralItems = batch.items.filter(
    (item) => item.edgeIndex < 0 || item.kind === 'group-only',
  )
  const edges = edgeItems
    .map(
      (item) =>
        `- ${item.id}：${item.from} -> ${item.to}${item.label ? `（当前标签：${item.label}）` : ''}\n  预检：${item.kind}${item.detail ? `；${item.detail}` : ''}`,
    )
    .join('\n')
  const structures = structuralItems
    .map((item) => {
      const candidates = item.candidates?.length
        ? `
  候选节点：${item.candidates.map((node) => `${node.id}（${node.label}）`).join('、')}`
        : ''
      const pairs = item.pairs?.length
        ? `
  文件对：${item.pairs.map((pair) => `${pair.from}→${pair.to}`).join('、')}`
        : ''
      return `- ${item.id}：${item.kind}；${item.from}${item.paths?.length ? `；文件：${item.paths.join('、')}` : ''}
  预检：${item.detail}${candidates}${pairs}`
    })
    .join('\n')


  const nodes = batch.nodes
    .map((node) => `- ${node.id}：${node.label}（${node.type}）`)
    .join('\n')

  const groups = overview.groups.length > 0 ? overview.groups.join('、') : '（没有分组）'

  // 每批都相同的内容放前面，本批内容放后面；同一份前缀才能命中提示词缓存。
  return `【全图摘要】节点 ${overview.nodes} 个，边 ${overview.edges} 条；程序已支持 ${overview.supported} 条；浮节点 ${overview.floating} 个，分组边 ${overview.groupOnly} 条，未归属文件 ${overview.unowned} 个，重复归属 ${overview.duplicate} 个，待改节点 ${overview.nodeIssues} 个；分组：${groups}

【项目结构结论（只作背景，不要据此编造）】
${projectContext.slice(0, 20_000)}

【规则】
- 边可以回：keep / remove / reverse / relabel / unknown；
- 结构项可以回：keep / connect / split / move-file / add-node / remove-node / rename-node / update-node / unknown；
- 结构项不是必须产生动作：先判断是否真的需要修，不需要就 keep，证据不足就 unknown；
- connect 用 to 指向目标端点；split 用 pairs 指定保留的文件对；move-file 用 path + toNode 指定文件和新节点；add-node 用 node 指定新节点；
- split 只在分组边掩盖两个以上不同文件级关系、拆开能让对象更具体时使用；只有一对或语义一致时保留分组边；
- add-node 只在候选节点都不合适、且新节点职责清楚时使用；已有节点能容纳就 move-file 或 keep；
- remove-node 用 nodeId 指定要删的节点；节点还有文件时用 moveFilesTo 先移到目标节点，不能直接丢文件；
- rename-node 用 nodeId + label 只改节点名称；update-node 用 nodeId + label / type / detail 改节点，type 只能是 code / tech / concept；
- rename-node / update-node 不改文件归属；节点仍被边引用时不要删；
- reverse 表示把 from/to 对调；relabel 只改标签；unknown 表示证据不足；
- 没有证据就写 unknown，不要猜；不要输出完整图；不要编造文件路径或节点 id；
- 需要读文件时，按工具格式申请；本批可用次数见后面的「本批工具额度」，程序可能按预算拒绝。

【输出】
只输出一个 JSON 对象，不要 Markdown 代码围栏：
{"decisions":[{"id":"E12","action":"reverse","label":"新的标签","reason":"依据","evidence":["path:line"]}]}

【本批边】共 ${edgeItems.length} 条，只处理这些
${edges || '（没有边）'}

【本批结构项】共 ${structuralItems.length} 项
${structures || '（没有结构项）'}

【涉及的节点】
${nodes}

【可读文件】只列本批涉及的文件和文件对；工具仍按完整可读列表校验
${batch.paths.map((path) => `- ${path}`).join('\n') || '（没有文件端点）'}

【本批工具额度】最多 ${batch.toolAllowance} 次；程序可能按预算拒绝。`
}
