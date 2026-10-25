/**
 * GET /api/usage —— 只读的 token 用量汇总。
 *
 * 默认只在开发期开放；生产环境要打开，需要显式设置 NUXT_USAGE_PAGE=1。
 * 不返回代码、提示词或用户输入，只返回功能名和 token 数字。
 */

import { readUsageRows, summarizeUsage } from '../utils/usage-summary'

export default defineEventHandler(() => {
  const enabled =
    process.env.NODE_ENV !== 'production' || process.env.NUXT_USAGE_PAGE === '1'

  if (!enabled) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const rows = readUsageRows()
  const summaries = summarizeUsage(rows)
  const total = summaries.reduce(
    (sum, item) => ({
      calls: sum.calls + item.calls,
      prompt: sum.prompt + item.prompt,
      completion: sum.completion + item.completion,
      total: sum.total + item.total,
    }),
    { calls: 0, prompt: 0, completion: 0, total: 0 },
  )

  return {
    summaries,
    total,
    last: rows.at(-1) ?? null,
    file: 'logs/llm-usage.jsonl',
    enabledInProduction: process.env.NUXT_USAGE_PAGE === '1',
  }
})
