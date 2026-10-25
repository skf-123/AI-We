/**
 * 按功能汇总 logs/llm-usage.jsonl。
 *
 * 跑法：npm run usage:report
 * 数据来源：每个 AI 功能调用结束后写的一行 JSON。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../logs/llm-usage.jsonl', import.meta.url))

let raw = ''
try {
  raw = readFileSync(file, 'utf8')
} catch {
  console.log('还没有日志。先启动 dev server，跑一次功能，再来汇总。')
  console.log(`找的文件：${file}`)
  process.exit(0)
}

const rows = raw
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })
  .filter(Boolean)

if (rows.length === 0) {
  console.log('日志文件是空的。先跑一次功能。')
  process.exit(0)
}

const byFeature = new Map()

for (const row of rows) {
  const feature = String(row.feature ?? '(unknown)')
  const item = byFeature.get(feature) ?? {
    feature,
    calls: 0,
    prompt: 0,
    completion: 0,
    total: 0,
    ms: 0,
    missing: 0,
  }
  item.calls++
  item.prompt += Number(row.prompt) || 0
  item.completion += Number(row.completion) || 0
  item.total += Number(row.total) || 0
  item.ms += Number(row.ms) || 0
  if (row.usageMissing) item.missing++
  byFeature.set(feature, item)
}

const table = [...byFeature.values()]
  .sort((a, b) => b.total - a.total)
  .map((item) => ({
    功能: item.feature,
    调用次数: item.calls,
    输入token: item.prompt,
    输出token: item.completion,
    合计token: item.total,
    平均耗时ms: Math.round(item.ms / item.calls),
    缺usage: item.missing,
  }))

const total = table.reduce(
  (sum, item) => ({
    功能: '总计',
    调用次数: sum.调用次数 + item.调用次数,
    输入token: sum.输入token + item.输入token,
    输出token: sum.输出token + item.输出token,
    合计token: sum.合计token + item.合计token,
    平均耗时ms: 0,
    缺usage: sum.缺usage + item.缺usage,
  }),
  { 功能: '总计', 调用次数: 0, 输入token: 0, 输出token: 0, 合计token: 0, 平均耗时ms: 0, 缺usage: 0 },
)

console.log(`日志：${file}`)
console.table([...table, total])
console.log(`最近一次：${rows[rows.length - 1].ts ?? '(无时间)'} · ${rows[rows.length - 1].feature ?? ''}`)
