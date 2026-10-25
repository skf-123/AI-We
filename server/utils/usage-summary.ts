/**
 * 读 logs/llm-usage.jsonl 并按功能汇总。
 *
 * 只读，不写文件；/api/usage 和本地报告脚本都用同一份数据。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface UsageRow {
  ts?: string
  feature?: string
  prompt?: number | null
  completion?: number | null
  total?: number | null
  ms?: number | null
  usageMissing?: boolean
  model?: string
}

export interface UsageSummary {
  feature: string
  calls: number
  prompt: number
  completion: number
  total: number
  avgMs: number
  missing: number
}

export function readUsageRows(): UsageRow[] {
  const file = join(process.cwd(), 'logs', 'llm-usage.jsonl')
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as UsageRow
      } catch {
        return null
      }
    })
    .filter((row): row is UsageRow => row !== null)
}

export function summarizeUsage(rows: UsageRow[]): UsageSummary[] {
  const byFeature = new Map<string, UsageSummary>()

  for (const row of rows) {
    const feature = String(row.feature ?? '(unknown)')
    const item = byFeature.get(feature) ?? {
      feature,
      calls: 0,
      prompt: 0,
      completion: 0,
      total: 0,
      avgMs: 0,
      missing: 0,
    }
    item.calls++
    item.prompt += Number(row.prompt) || 0
    item.completion += Number(row.completion) || 0
    item.total += Number(row.total) || 0
    item.avgMs += Number(row.ms) || 0
    if (row.usageMissing) item.missing++
    byFeature.set(feature, item)
  }

  return [...byFeature.values()]
    .map((item) => ({ ...item, avgMs: Math.round(item.avgMs / item.calls) }))
    .sort((a, b) => b.total - a.total)
}
