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
} from '../app/utils/self-check-budget.ts'
import { buildSelfCheckPlan } from '../app/utils/self-check-plan.ts'
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

const verifiedPlan = buildSelfCheckPlan(
  {
    ...graph,
    edges: [{ ...graph.edges[0], confidence: 'verified' }],
  },
  [suspicions[0]],
)
check('verified edge stays out of model', verifiedPlan.items.length, 0)
check('verified edge counts as supported', verifiedPlan.supported, 1)

const budget = createSelfCheckBudget()
check('初始批池', budget.pool, 125_000)
const first = plan.batches[0]
const quota = allocateBatchQuota(budget, first, plan.batches)
check('单批硬顶', quota <= SELF_CHECK_BATCH_CAP_TOKENS, true)
check('可以开始', canStartBatch(budget, quota), true)
recordUsage(budget, Math.min(4_000, quota))
check('实际用量扣池', budget.used, Math.min(4_000, quota))
check('剩余回池', budget.pool, 125_000 - budget.used)

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

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
