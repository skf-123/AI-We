/**
 * 分批图自检的纯函数回归。
 *
 * 跑法：node --experimental-strip-types scripts/self-check-batch-check.mjs
 * 不调用模型，不碰 DOM；只验清单、预算和合并。
 */
import {
  allocateBatchQuota,
  canStartBatch,
  createSelfCheckBudget,
  recordUsage,
  SELF_CHECK_BATCH_CAP_TOKENS,
  SELF_CHECK_HARD_TOKENS,
  SELF_CHECK_RESERVE_TOKENS,
  SELF_CHECK_STRUCTURAL_TOKENS,
  SELF_CHECK_TOTAL_TOKENS,
} from '../app/utils/self-check-budget.ts'
import {
  buildSelfCheckPlan,
  formatBatchContent,
  selectFinalReserveItems,
  selfCheckBatchEnabledFromSearch,
  SELF_CHECK_FINAL_ACTIONS,
  SELF_CHECK_MAX_UNOWNED,
} from '../app/utils/self-check-plan.ts'
import { mergeSelfCheckDecisions } from '../app/utils/self-check-merge.ts'

let failed = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`ok ${name}`)
    return
  }
  failed++
  console.error(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`)
}

const graph = {
  nodes: [
    { id: 'entity', label: '实体', files: [{ path: 'Article.java' }, { path: 'User.java' }] },
    { id: 'mapper', label: 'Mapper', files: [{ path: 'ArticleMapper.java' }, { path: 'UserMapper.java' }] },
    { id: 'service', label: 'Service', files: [{ path: 'ArticleService.java' }] },
  ],
  edges: [
    { from: 'f:Article.java', to: 'f:ArticleMapper.java', label: '泛型操作对象' },
    { from: 'f:User.java', to: 'f:UserMapper.java', label: '泛型操作对象' },
    { from: 'f:ArticleMapper.java', to: 'f:ArticleService.java', label: '被业务调用' },
    { from: 'f:ArticleService.java', to: 'n:service', label: '属于' },
    { from: 'n:entity', to: 'n:mapper', label: '分组关系' },
  ],
}

const suspicions = [
  {
    kind: 'reversed',
    from: 'f:Article.java',
    to: 'f:ArticleMapper.java',
    label: '泛型操作对象',
    detail: 'import 方向相反',
  },
  {
    kind: 'unsupported',
    from: 'f:User.java',
    to: 'f:UserMapper.java',
    label: '泛型操作对象',
    detail: '没有 import 依据',
  },
  {
    kind: 'reversed',
    from: 'f:ArticleMapper.java',
    to: 'f:ArticleService.java',
    label: '被业务调用',
    detail: '应当由 Service 指向 Mapper',
  },
]

const plan = buildSelfCheckPlan(graph, suspicions)
check('只把预检边送模型', plan.items.length, 3)
check('program supported 计入总覆盖', [plan.supported, plan.total], [2, 5])
check('每批不超过 8 条', plan.batches.every((b) => b.items.length <= 8), true)
check('批次号从 1 起', plan.batches[0]?.index, 1)
check('工具额度不超过 6', plan.batches.every((b) => b.toolAllowance <= 6), true)
check('反向/无依据都给额度', plan.batches[0]?.toolAllowance > 0, true)
check('plan overview counts', [plan.overview.nodes, plan.overview.edges, plan.overview.supported], [3, 5, 2])
check('batch prompt carries overview', formatBatchContent(plan.batches[0], '上下文', plan.overview).includes('全图摘要'), true)
check('batch prompt says actions are optional', formatBatchContent(plan.batches[0], '上下文', plan.overview).includes('结构项不是必须产生动作'), true)
check('batch prompt explains split condition', formatBatchContent(plan.batches[0], '上下文', plan.overview).includes('split 只在分组边掩盖两个以上不同文件级关系'), true)

check('default is batch', selfCheckBatchEnabledFromSearch(''), true)
check('legacy query switches back', selfCheckBatchEnabledFromSearch('?selfcheck=legacy'), false)
check('batch query stays batch', selfCheckBatchEnabledFromSearch('?selfcheck=batch'), true)

const verifiedPlan = buildSelfCheckPlan(
  {
    ...graph,
    edges: [{ ...graph.edges[0], confidence: 'verified' }],
  },
  [suspicions[0]],
)
check('verified edge stays out of model', verifiedPlan.items.length, 0)
check('verified edge counts as supported', verifiedPlan.supported, 1)

const inferredPlan = buildSelfCheckPlan(
  { ...graph, edges: [{ ...graph.edges[0], confidence: 'inferred' }] },
  [],
)
check('inferred edge enters plan', inferredPlan.items.length, 1)
check('inferred edge kind', inferredPlan.items[0]?.kind, 'inferred')

const reversedPlan = buildSelfCheckPlan(
  {
    ...graph,
    edges: [{ ...graph.edges[0], confidence: 'partial', note: '程序事实的方向和图上的边相反' }],
  },
  [],
)
check('reverse note enters plan', reversedPlan.items.length, 1)
check('reverse note kind', reversedPlan.items[0]?.kind, 'reversed')

const groupOnlyPlan = buildSelfCheckPlan(
  {
    ...graph,
    edges: [
      {
        ...graph.edges[0],
        confidence: 'partial',
        filePairs: [{ from: 'Article.java', to: 'ArticleMapper.java', evidence: [] }],
      },
    ],
  },
  [],
)
check('group file pairs enter plan', groupOnlyPlan.items.length, 1)
check('group file pairs kind', groupOnlyPlan.items[0]?.kind, 'group-only')
check('group file pairs not supported', groupOnlyPlan.supported, 0)

const budget = createSelfCheckBudget()
check('初始批池', budget.pool, SELF_CHECK_TOTAL_TOKENS - SELF_CHECK_RESERVE_TOKENS)
const first = plan.batches[0]
const quota = allocateBatchQuota(budget, first, plan.batches)
check('单批硬顶', quota <= SELF_CHECK_BATCH_CAP_TOKENS, true)
check('可以开始', canStartBatch(budget, quota), true)
recordUsage(budget, Math.min(4_000, quota))
check('实际用量扣池', budget.used, Math.min(4_000, quota))
check('剩余回池', budget.pool, SELF_CHECK_TOTAL_TOKENS - SELF_CHECK_RESERVE_TOKENS - budget.used)

const hardBudget = createSelfCheckBudget()
recordUsage(hardBudget, SELF_CHECK_HARD_TOKENS)
check('达到硬停后不能再开批', canStartBatch(hardBudget, 15_000), false)
check('硬停用量如实累计', hardBudget.used, SELF_CHECK_HARD_TOKENS)

const decisions = [
  { id: 'E0', action: 'reverse', label: 'BaseMapper 泛型操作对象' },
  { id: 'E1', action: 'remove', reason: '没有依据' },
  { id: 'E2', action: 'relabel', label: 'Service 调 Mapper' },
]
const merged = mergeSelfCheckDecisions(graph, plan.items, decisions, plan.supported)
check('反向后的边存在', merged.graph.edges.some((e) => e.from === 'f:ArticleMapper.java' && e.to === 'f:Article.java'), true)
check('删除的边不存在', merged.graph.edges.some((e) => e.from === 'f:User.java' && e.to === 'f:UserMapper.java'), false)
check('改标签生效', merged.graph.edges.some((e) => e.label === 'Service 调 Mapper'), true)
check('覆盖率', merged.coverage, { total: 5, checked: 5, unknown: 0, conflict: 0, supported: 2 })

const unknownMerge = mergeSelfCheckDecisions(graph, plan.items, [{ id: 'E0', action: 'unknown' }], plan.supported)
check('unknown 保留原边', unknownMerge.graph.edges.some((e) => e.from === 'f:Article.java' && e.to === 'f:ArticleMapper.java'), true)
check('unknown 计入未核', [unknownMerge.coverage.unknown, unknownMerge.coverage.checked], [3, 2])

const integrityMerged = mergeSelfCheckDecisions(
  {
    ...graph,
    nodes: [{ ...graph.nodes[0], floating: true }, ...graph.nodes.slice(1)],
    edges: [{ ...graph.edges[0], filePairs: [{ from: 'Article.java', to: 'ArticleMapper.java', evidence: [] }] }],
    unownedFiles: ['Orphan.java'],
    duplicateFiles: [{ path: 'Article.java', nodes: ['entity', 'mapper'] }],
  },
  [],
  [],
  0,
)
check(
  'program issue counts in coverage',
  [
    integrityMerged.coverage.floating,
    integrityMerged.coverage.groupOnly,
    integrityMerged.coverage.unowned,
    integrityMerged.coverage.duplicate,
  ],
  [1, 1, 1, 1],
)

const structuralGraph = {
  nodes: [
    { id: 'a', label: 'A', type: 'code', files: [{ path: 'a.java' }], floating: true },
    { id: 'b', label: 'B', type: 'code', files: [{ path: 'b.java' }] },
  ],
  edges: [{ from: 'f:a.java', to: 'f:b.java', label: '旧关系' }],
  unownedFiles: ['c.java'],
  duplicateFiles: [{ path: 'd.java', nodes: ['a', 'b'] }],
}
const structuralItems = [
  { id: 'S1', edgeIndex: -1, from: 'n:a', to: '', label: 'A', kind: 'floating', detail: '浮节点', batch: 1, paths: ['a.java'] },
  { id: 'S2', edgeIndex: -1, from: 'n:b', to: '', label: 'B', kind: 'duplicate', detail: '重复归属', batch: 1, paths: ['d.java'] },
  { id: 'S3', edgeIndex: -1, from: 'f:c.java', to: '', kind: 'unowned', detail: '未归属', batch: 1, paths: ['c.java'] },
  { id: 'E0', edgeIndex: 0, from: 'f:a.java', to: 'f:b.java', label: '旧关系', kind: 'group-only', detail: '分组边', batch: 1, pairs: [{ from: 'a.java', to: 'b.java' }] },
]
const structuralMerged = mergeSelfCheckDecisions(
  structuralGraph,
  structuralItems,
  [
    { id: 'S1', action: 'connect', to: 'n:b', label: '连到 B' },
    { id: 'S2', action: 'add-node', node: { id: 'c', label: '新分组', type: 'code', files: ['d.java'] } },
    { id: 'S3', action: 'move-file', path: 'c.java', toNode: 'b' },
    { id: 'E0', action: 'split', pairs: [{ from: 'a.java', to: 'b.java' }] },
  ],
  0,
  ['d.java'],
)
check('connect 新增边', structuralMerged.graph.edges.some((e) => e.from === 'n:a' && e.to === 'n:b'), true)
check('add-node 新增节点', structuralMerged.graph.nodes.some((n) => n.id === 'c'), true)
check('move-file 改归属', structuralMerged.graph.nodes.find((n) => n.id === 'b')?.files?.some((f) => f.path === 'c.java'), true)
check('split 产出文件边', structuralMerged.graph.edges.some((e) => e.from === 'f:a.java' && e.to === 'f:b.java'), true)
check('结构项已处理', [structuralMerged.coverage.structural, structuralMerged.coverage.structuralChecked], [3, 3])
check('结构动作无冲突', structuralMerged.coverage.conflict, 0)

check(
  '四个结构动作都记 accepted',
  structuralMerged.applied.filter((row) => ['connect', 'split', 'move-file', 'add-node'].includes(row.action) && row.accepted).length,
  4,
)
const rejectedMove = mergeSelfCheckDecisions(
  structuralGraph,
  [{ id: 'S9', edgeIndex: -1, from: 'f:c.java', to: '', kind: 'unowned', detail: '未归属', batch: 1, paths: ['c.java'] }],
  [{ id: 'S9', action: 'move-file', path: 'c.java', toNode: 'missing-node' }],
  0,
)
check('非法 move-file 被拒', rejectedMove.applied[0]?.accepted, false)
check('非法 move-file 有原因', Boolean(rejectedMove.applied[0]?.conflictReason), true)

const roleGraph = {
  nodes: [
    { id: 'a', label: 'A', type: 'code', files: [{ path: 'a.java', role: '入口' }] },
    { id: 'b', label: 'B', type: 'tech' },
  ],
  edges: [],
}
const roleMove = mergeSelfCheckDecisions(
  roleGraph,
  [{ id: 'U1', edgeIndex: -1, from: 'f:a.java', to: '', kind: 'unowned', detail: '', batch: 1, paths: ['a.java'] }],
  [{ id: 'U1', action: 'move-file', path: 'a.java', toNode: 'n:b' }],
  0,
  ['a.java'],
)
check('move-file 保留文件角色', roleMove.graph.nodes.find((n) => n.id === 'b')?.files?.[0]?.role, '入口')

const roleLessGraph = {
  nodes: [
    { id: 'a', label: 'A', type: 'code', files: [{ path: 'a.java' }] },
    { id: 'b', label: 'B', type: 'tech' },
  ],
  edges: [],
}
const roleLessMove = mergeSelfCheckDecisions(
  roleLessGraph,
  [{ id: 'U1', edgeIndex: -1, from: 'f:a.java', to: '', kind: 'unowned', detail: '', batch: 1, paths: ['a.java'] }],
  [{ id: 'U1', action: 'move-file', path: 'a.java', toNode: 'n:b' }],
  0,
  ['a.java'],
)
check(
  'move-file 不凭空造角色',
  Boolean(roleLessMove.graph.nodes.find((n) => n.id === 'b')?.files?.[0]?.role),
  false,
)

const unknownPathMove = mergeSelfCheckDecisions(
  { nodes: [{ id: 'a', label: 'A', type: 'code', files: [{ path: 'a.java' }] }], edges: [] },
  [
    {
      id: 'U1',
      edgeIndex: -1,
      from: 'f:outside.java',
      to: '',
      kind: 'unowned',
      detail: '',
      batch: 1,
      paths: ['outside.java'],
    },
  ],
  [{ id: 'U1', action: 'move-file', path: 'outside.java', toNode: 'n:a' }],
  0,
  ['a.java'],
)
check('move-file 未勾选路径被拒', unknownPathMove.applied[0]?.accepted, false)

const addNodeOutside = mergeSelfCheckDecisions(
  { nodes: [{ id: 'a', label: 'A', type: 'code', files: [{ path: 'a.java' }] }], edges: [] },
  [
    {
      id: 'N1',
      edgeIndex: -1,
      from: 'n:a',
      to: '',
      kind: 'node',
      detail: '',
      batch: 1,
      paths: ['a.java'],
    },
  ],
  [
    {
      id: 'N1',
      action: 'add-node',
      node: { id: 'c', label: 'C', type: 'code', files: ['outside.java'] },
    },
  ],
  0,
  ['a.java'],
)
check('add-node 未勾选路径被拒', addNodeOutside.applied[0]?.accepted, false)

// 节点项：程序能看出的名称 / 类型 / 空代码分组问题才进清单。
const nodeIssueGraph = {
  nodes: [
    { id: 'core', label: '核心', type: 'code', files: [{ path: 'core.java' }] },
    { id: 'legacy', label: '核心', type: 'code', files: [{ path: 'legacy.java' }] },
    { id: 'empty', label: '空壳', type: 'code' },
    { id: 'weird', label: 'weird', type: 'module', files: [{ path: 'w.java' }] },
    { id: 'fine', label: '正常分组', type: 'tech' },
  ],
  edges: [],
}
const nodeIssuePlan = buildSelfCheckPlan(nodeIssueGraph, [])
check('节点项只送有问题的节点', nodeIssuePlan.overview.nodeIssues, 4)
check('节点项互相不重复', new Set(nodeIssuePlan.items.map((item) => item.id)).size, nodeIssuePlan.items.length)
const nodeIssueText = formatBatchContent(nodeIssuePlan.batches[0], '上下文', nodeIssuePlan.overview)
check('批次内容带上待改节点数', nodeIssueText.includes('待改节点 4 个'), true)
check('批次规则说明节点动作', nodeIssueText.includes('remove-node') && nodeIssueText.includes('rename-node'), true)

const nodeMergeGraph = {
  nodes: [
    { id: 'a', label: '甲', type: 'code', files: [{ path: 'a.java' }] },
    { id: 'b', label: '乙', type: 'tech' },
    { id: 'c', label: '丙', type: 'code', files: [{ path: 'c.java' }] },
  ],
  edges: [],
}
const nodeItem = (id, nodeId, paths = []) => ({
  id,
  edgeIndex: -1,
  from: `n:${nodeId}`,
  to: '',
  label: nodeId,
  kind: 'node',
  detail: '',
  batch: 1,
  paths,
})
const nodeItems = [nodeItem('N1', 'a', ['a.java']), nodeItem('N2', 'c', ['c.java'])]

const renamedNode = mergeSelfCheckDecisions(
  nodeMergeGraph,
  [nodeItems[0]],
  [{ id: 'N1', action: 'rename-node', label: '核心甲' }],
  0,
)
check('rename-node 改名称', renamedNode.graph.nodes.find((n) => n.id === 'a')?.label, '核心甲')
check(
  'rename-node 不改文件',
  renamedNode.graph.nodes.find((n) => n.id === 'a')?.files?.map((f) => f.path),
  ['a.java'],
)
check('rename-node accepted', renamedNode.applied[0]?.accepted, true)

const removedNoTarget = mergeSelfCheckDecisions(
  nodeMergeGraph,
  [nodeItems[1]],
  [{ id: 'N2', action: 'remove-node' }],
  0,
)
check('remove-node 有文件且没去处被拒', removedNoTarget.applied[0]?.accepted, false)
check(
  'remove-node 拒绝原因',
  removedNoTarget.applied[0]?.conflictReason,
  '节点还有文件，用 moveFilesTo 指定文件去处',
)
check('被拒后节点仍在', removedNoTarget.graph.nodes.some((n) => n.id === 'c'), true)

const removedNode = mergeSelfCheckDecisions(
  nodeMergeGraph,
  [nodeItems[1]],
  [{ id: 'N2', action: 'remove-node', moveFilesTo: 'n:a' }],
  0,
)
check('remove-node 删掉节点', removedNode.graph.nodes.some((n) => n.id === 'c'), false)
check(
  'remove-node 把文件移走',
  removedNode.graph.nodes.find((n) => n.id === 'a')?.files?.map((f) => f.path),
  ['a.java', 'c.java'],
)
check('remove-node accepted', removedNode.applied[0]?.accepted, true)

const edgeReferenced = mergeSelfCheckDecisions(
  { ...nodeMergeGraph, edges: [{ from: 'n:c', to: 'n:b' }] },
  [nodeItems[1]],
  [{ id: 'N2', action: 'remove-node', moveFilesTo: 'n:a' }],
  0,
)
check('被边引用的节点不能删', edgeReferenced.applied[0]?.accepted, false)
check(
  '被边引用拒绝原因',
  edgeReferenced.applied[0]?.conflictReason,
  '节点还被边引用，先删边或改边再删节点',
)

const addNodeOwned = mergeSelfCheckDecisions(
  nodeMergeGraph,
  [nodeItems[0]],
  [
    {
      id: 'N1',
      action: 'add-node',
      node: { id: 'd', label: 'D', type: 'code', files: ['a.java'] },
    },
  ],
  0,
)
check('add-node 不能重复占文件', addNodeOwned.applied[0]?.accepted, false)
check(
  'add-node 重复占文件原因',
  addNodeOwned.applied[0]?.conflictReason,
  'add-node 的文件已属于其他节点，请用 move-file',
)

const addNodeFree = mergeSelfCheckDecisions(
  nodeMergeGraph,
  [nodeItems[0]],
  [
    {
      id: 'N1',
      action: 'add-node',
      node: { id: 'd', label: 'D', type: 'code', files: ['new.java'] },
    },
  ],
  0,
  ['new.java'],
)
check('add-node 接受未归属文件', addNodeFree.applied[0]?.accepted, true)

const badType = mergeSelfCheckDecisions(
  nodeMergeGraph,
  [nodeItems[0]],
  [{ id: 'N1', action: 'update-node', type: 'module' }],
  0,
)
check('update-node 非法类型被拒', badType.applied[0]?.accepted, false)

const updatedNode = mergeSelfCheckDecisions(
  nodeMergeGraph,
  [nodeItems[0]],
  [{ id: 'N1', action: 'update-node', type: 'tech', detail: '基础设施' }],
  0,
)
check(
  'update-node 改类型和说明',
  [
    updatedNode.graph.nodes.find((n) => n.id === 'a')?.type,
    updatedNode.graph.nodes.find((n) => n.id === 'a')?.detail,
  ],
  ['tech', '基础设施'],
)

const nodeOnFileItem = mergeSelfCheckDecisions(
  nodeMergeGraph,
  [
    {
      id: 'U1',
      edgeIndex: -1,
      from: 'f:x.java',
      to: '',
      kind: 'unowned',
      detail: '',
      batch: 1,
      paths: ['x.java'],
    },
  ],
  [{ id: 'U1', action: 'rename-node', label: 'x' }],
  0,
)
check('文件项不能做节点动作', nodeOnFileItem.applied[0]?.conflictReason, '这个动作只能用在节点项上')

// 批次优先级、结构项类别、未归属限量、收尾只处理边
const priorityGraph = {
  nodes: [
    { id: 'a', label: 'A', type: 'code', files: [{ path: 'a.java' }] },
    { id: 'b', label: 'B', type: 'code', files: [{ path: 'b.java' }] },
    { id: 'float', label: '浮', type: 'code', files: [{ path: 'f.java' }], floating: true },
  ],
  edges: [
    { from: 'f:a.java', to: 'f:b.java', label: '反向' },
    { from: 'f:b.java', to: 'f:a.java', label: '无依据' },
    { from: 'f:a.java', to: 'n:float', label: '推断', confidence: 'inferred' },
  ],
  unownedFiles: Array.from({ length: 20 }, (_, i) => `u${i}.java`),
  duplicateFiles: [{ path: 'a.java', nodes: ['a', 'b'] }],
}
const prioritySuspicions = [
  { kind: 'reversed', from: 'f:a.java', to: 'f:b.java', label: '反向', detail: '方向相反' },
  { kind: 'unsupported', from: 'f:b.java', to: 'f:a.java', label: '无依据', detail: '没有 import' },
]
const priorityPlan = buildSelfCheckPlan(priorityGraph, prioritySuspicions)
check('批次优先级单调', priorityPlan.batches.every((b, i, all) => i === 0 || all[i - 1].rank <= b.rank), true)
check('第一条先跑关键边', [priorityPlan.batches[0]?.rank, priorityPlan.batches[0]?.category], [0, 'edge'])
check('结构批次标记为 structural', priorityPlan.batches.filter((b) => b.category === 'structural').length > 0, true)
check(
  '未归属只送前 N 个',
  priorityPlan.items.filter((item) => item.kind === 'unowned').length,
  SELF_CHECK_MAX_UNOWNED,
)
check('批次号连续', priorityPlan.batches.every((b, i) => b.index === i + 1), true)
check(
  '收尾只含边',
  selectFinalReserveItems(priorityPlan.items, new Set(['E0'])).every((item) => item.edgeIndex >= 0),
  true,
)
check('收尾动作不含结构动作', SELF_CHECK_FINAL_ACTIONS.includes('move-file'), false)
check('结构项预算上限', SELF_CHECK_STRUCTURAL_TOKENS, 25_000)

const prefixOf = (text) => text.slice(0, text.indexOf('【本批边】'))
const prefixA = prefixOf(formatBatchContent(priorityPlan.batches[0], '同一份项目结论', priorityPlan.overview))
const prefixB = prefixOf(formatBatchContent(priorityPlan.batches[1], '同一份项目结论', priorityPlan.overview))
check('批次静态前缀一致', prefixA, prefixB)
check('工具额度不在静态前缀里', prefixA.includes('【本批工具额度】'), false)

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
