/**
 * token 用量记录的存储。
 *
 * 两份数据：
 *   · 当前记录 logs/llm-usage.jsonl —— 所有 AI 调用继续往这里追加；
 *   · 保留记录 logs/usage-sessions/<时间>-<名字>.jsonl —— 只是被改名过去的当前文件。
 *
 * 保存用 rename，不复制：改名是原子的，不会丢正在写的行。
 * 保留文件名只由时间戳和清洗后的名字组成，不接受调用方传路径。
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import type { UsageRow } from './usage-summary'
import { summarizeUsage } from './usage-summary'

const LIVE_FILE = join(process.cwd(), 'logs', 'llm-usage.jsonl')
const SESSIONS_DIR = join(process.cwd(), 'logs', 'usage-sessions')

export interface UsageSession {
  id: string
  name: string
  savedAt: string
  calls: number
  total: number
}

export function usageEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.NUXT_USAGE_PAGE === '1'
}

function ensureSessionsDir(): void {
  mkdirSync(SESSIONS_DIR, { recursive: true })
}

function readRows(file: string): UsageRow[] {
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
    .filter((row): row is UsageRow => row !== null && Boolean(row.feature))
}

function slugOf(name: string): string {
  const cleaned = Array.from(name.trim())
    .map((ch) => (/[\\/:*?"<>|]/.test(ch) || (ch.codePointAt(0) ?? 0) < 32 ? '-' : ch))
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return cleaned || 'session'
}

function stamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function makeId(name: string): string {
  const base = `${stamp()}-${slugOf(name)}`
  let id = base
  let suffix = 2
  while (existsSync(join(SESSIONS_DIR, `${id}.jsonl`))) {
    id = `${base}-${suffix}`
    suffix++
  }
  return id
}

function sessionName(id: string): string {
  // id = YYYYMMDD-HHmmss-<名字>；时间部分固定 15 个字符
  return id.length > 16 ? id.slice(16) : id
}

export function readCurrentRows(): UsageRow[] {
  return readRows(LIVE_FILE)
}

export function listSessions(): UsageSession[] {
  try {
    ensureSessionsDir()
    return readdirSync(SESSIONS_DIR)
      .filter((file) => file.endsWith('.jsonl'))
      .map((file) => {
        const id = basename(file, '.jsonl')
        const filePath = join(SESSIONS_DIR, file)
        const rows = readRows(filePath)
        const total = summarizeUsage(rows).reduce((sum, item) => sum + item.total, 0)
        return {
          id,
          name: sessionName(id),
          savedAt: statSync(filePath).mtime.toISOString(),
          calls: rows.length,
          total,
        }
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  } catch {
    return []
  }
}

export function readSessionRows(id: string): UsageRow[] {
  const safe = basename(id)
  if (safe !== id || id.includes('..')) return []
  const file = join(SESSIONS_DIR, `${safe}.jsonl`)
  if (!existsSync(file)) return []
  return readRows(file)
}

export function saveSession(name: string): UsageSession {
  ensureSessionsDir()

  if (!existsSync(LIVE_FILE) || statSync(LIVE_FILE).size === 0) {
    throw new Error('当前没有记录，先跑一次功能再保留')
  }

  const id = makeId(name)
  const file = join(SESSIONS_DIR, `${id}.jsonl`)

  // 原子改名：改名之后的新写入会落到一个新创建的当前文件里
  renameSync(LIVE_FILE, file)
  try {
    const fd = openSync(LIVE_FILE, 'a')
    closeSync(fd)
  } catch {
    // 新建当前文件失败时，下一次 appendFileSync 会自动创建；数据已经在保留文件里
  }

  const rows = readRows(file)
  return {
    id,
    name: sessionName(id),
    savedAt: statSync(file).mtime.toISOString(),
    calls: rows.length,
    total: summarizeUsage(rows).reduce((sum, item) => sum + item.total, 0),
  }
}

export function deleteSession(id: string): void {
  const safe = basename(id)
  if (safe !== id || id.includes('..')) throw new Error('无效的记录编号')
  const file = join(SESSIONS_DIR, `${safe}.jsonl`)
  if (!existsSync(file)) throw new Error('这条记录不存在')
  unlinkSync(file)
}

export function clearCurrent(): void {
  mkdirSync(join(process.cwd(), 'logs'), { recursive: true })
  writeFileSync(LIVE_FILE, '', 'utf8')
}

export function usageFiles(): { live: string; sessionsDir: string } {
  return { live: LIVE_FILE, sessionsDir: SESSIONS_DIR }
}
