/**
 * 分批预算回放夹具。
 *
 * 目的：不重新上传、不重新解析 186 个文件，只回放一次已经发生的分批用量，
 * 验证批池耗尽、最后一批准入和 25k 收尾额度。
 *
 * 跑法：node scripts/self-check-budget-replay-check.mjs
 */
import fs from 'node:fs'
import {
  allocateBatchQuota,
  canStartBatch,
  createSelfCheckBudget,
  recordUsage,
  SELF_CHECK_TOTAL_TOKENS,
} from '../app/utils/self-check-budget.ts'

const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/self-check-budget-replay.json', import.meta.url), 'utf8'),
)
const batches = Array.from({ length: fixture.batchCount }, (_, index) => ({
  index: index + 1,
  items: [],
  nodes: [],
  paths: [],
  score: 0,
  toolAllowance: 1,
}))

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

const budget = createSelfCheckBudget(fixture.total, fixture.reserve)
let processed = 0
for (let index = 0; index < fixture.batchUsage.length; index++) {
  const remaining = batches.slice(index)
  const quota = allocateBatchQuota(budget, batches[index], remaining)
  if (!canStartBatch(budget, quota)) break
  processed++
  recordUsage(budget, fixture.batchUsage[index])
}

const nextQuota = allocateBatchQuota(budget, batches[processed], batches.slice(processed))
check('回放已用 token', budget.used, fixture.expected.used)
check('批池剩余', budget.pool, fixture.expected.poolLeft)
check('已处理批数', processed, fixture.expected.processedBatches)
check('第 12 批被拦', canStartBatch(budget, nextQuota), false)
check('拦住时的下一批额度低于最低值', nextQuota < 1500, true)
check(
  '留给最后补决定的额度',
  SELF_CHECK_TOTAL_TOKENS - budget.used,
  fixture.expected.reserveLeftForFinalPass,
)

if (failed > 0) {
  console.error(`\n${failed} 项不通过`)
  process.exitCode = 1
} else {
  console.log('\n全部通过：回放没有再调用模型，也没有重新解析文件。')
}
