/**
 * GET /api/usage —— 只读的 token 用量汇总。
 *
 * 不带 session：看当前记录；带 session：看某一份已保留记录。
 * 默认只在开发期开放；生产环境要打开，需要显式设置 NUXT_USAGE_PAGE=1。
 */

import { summarizeUsage } from '../utils/usage-summary'
import {
  listSessions,
  readCurrentRows,
  readSessionRows,
  usageEnabled,
} from '../utils/usage-store'

export default defineEventHandler((event) => {
  if (!usageEnabled()) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const query = getQuery(event)
  const session = typeof query.session === 'string' ? query.session : ''
  const sessions = listSessions()

  if (session && !sessions.some((item) => item.id === session)) {
    throw createError({ statusCode: 404, statusMessage: '这条记录不存在' })
  }

  const currentRows = readCurrentRows()
  const rows = session ? readSessionRows(session) : currentRows
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
  const currentTotal = summarizeUsage(currentRows).reduce((sum, item) => sum + item.total, 0)
  const last = rows.at(-1) ?? null

  return {
    summaries,
    total,
    last,
    file: session ? `logs/usage-sessions/${session}.jsonl` : 'logs/llm-usage.jsonl',
    selected: session || null,
    sessions,
    current: { calls: currentRows.length, total: currentTotal },
    enabledInProduction: process.env.NUXT_USAGE_PAGE === '1',
  }
})
