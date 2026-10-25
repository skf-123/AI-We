/**
 * 按功能汇总 token 用量。
 *
 * 跑法：
 *   npm run usage:report                     当前记录
 *   npm run usage:report -- --list           列出已保留的记录
 *   npm run usage:report -- --session <id>   看某一份保留记录
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const live = fileURLToPath(new URL('../logs/llm-usage.jsonl', import.meta.url))
const sessionsDir = fileURLToPath(new URL('../logs/usage-sessions/', import.meta.url))

function readRows(file) {
  let raw
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
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter((row) => row && row.feature)
}

function summarize(rows) {
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

  return [...byFeature.values()]
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
}

function printTable(file, label) {
  const rows = readRows(file)
  if (rows.length === 0) {
    console.log(`${label}：还没有记录。`)
    return
  }

  const table = summarize(rows)
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
  const last = rows[rows.length - 1]
  console.log(`最近一次：${last.ts ?? '(无时间)'} · ${last.feature ?? ''}`)
}

function listSessions() {
  if (!existsSync(sessionsDir)) {
    console.log('还没有保留记录。')
    return
  }

  const sessions = readdirSync(sessionsDir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => {
      const id = basename(file, '.jsonl')
      const filePath = join(sessionsDir, file)
      const rows = readRows(filePath)
      return {
        编号: id,
        名称: id.length > 16 ? id.slice(16) : id,
        保留时间: statSync(filePath).mtime.toLocaleString('zh-CN'),
        调用次数: rows.length,
        合计token: rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
      }
    })
    .sort((a, b) => b.保留时间.localeCompare(a.保留时间))

  if (sessions.length === 0) {
    console.log('还没有保留记录。')
    return
  }
  console.table(sessions)
}

const args = process.argv.slice(2)
const listIndex = args.indexOf('--list')
const sessionIndex = args.indexOf('--session')

if (listIndex !== -1) {
  listSessions()
} else if (sessionIndex !== -1) {
  const id = args[sessionIndex + 1]
  if (!id) {
    console.error('用法：npm run usage:report -- --session <id>')
    process.exit(1)
  }
  const safe = basename(id)
  if (safe !== id || id.includes('..')) {
    console.error('无效的记录编号')
    process.exit(1)
  }
  const file = join(sessionsDir, `${safe}.jsonl`)
  if (!existsSync(file)) {
    console.error(`找不到保留记录：${safe}`)
    process.exit(1)
  }
  printTable(file, `保留记录 ${safe.slice(16) || safe}`)
} else {
  printTable(live, '当前记录')
}
