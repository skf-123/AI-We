/**
 * GET /api/admin/traffic
 *
 * 只读 Caddy 访问日志，返回最近的请求、按 IP 和按路径的汇总。
 * 这个接口由服务器上的 Caddy Basic Auth 保护；不要在 Nuxt 里再暴露一份。
 */

import { createError, getQuery, setHeader } from 'h3'
import { open } from 'node:fs/promises'

const LOG_PATH = process.env.TRAFFIC_LOG_PATH || '/var/log/caddy/access.log'
const MAX_TAIL_BYTES = 8 * 1024 * 1024
const DEFAULT_HOURS = 24
const MAX_HOURS = 24 * 30
const DEFAULT_LIMIT = 300
const MAX_LIMIT = 1_000

/** 这些 IP 和 UA 是我们的访问/探针，默认从统计里省略。 */
const OWN_IPS = new Set(
  (process.env.TRAFFIC_OWN_IPS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
)
const OWN_UA = [/curl\//i, /headlesschrome/i]

function isOwn(record: TrafficRecord): boolean {
  return OWN_IPS.has(record.ip) || OWN_UA.some((pattern) => pattern.test(record.ua))
}

interface TrafficRecord {
  ts: number
  ip: string
  method: string
  path: string
  status: number
  durationMs: number
  ua: string
  host: string
  proto: string
}

interface IpRow {
  ip: string
  count: number
  first: string
  last: string
}

interface PathRow {
  path: string
  count: number
}

function numberParam(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function headerValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '')
  return typeof value === 'string' ? value : ''
}

async function readTailLines(path: string): Promise<string[]> {
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    const start = Math.max(0, stat.size - MAX_TAIL_BYTES)
    const length = stat.size - start
    if (length <= 0) return []

    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)

    let text = buffer.toString('utf8')
    // 从文件中间开始时，第一行通常是半行，丢掉。
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
    return text.split('\n').filter((line) => line.trim().length > 0)
  } finally {
    await handle.close()
  }
}

function parseRecord(line: string): TrafficRecord | null {
  try {
    const row = JSON.parse(line) as {
      ts?: number
      request?: {
        remote_ip?: string
        client_ip?: string
        method?: string
        host?: string
        proto?: string
        uri?: string
        headers?: Record<string, unknown>
      }
      duration?: number
      status?: number
    }

    const request = row.request
    if (!request || !row.ts) return null
    const path = String(request.uri ?? '').split('?')[0] || '/'
    if (!path.startsWith('/')) return null

    return {
      ts: Number(row.ts),
      ip: String(request.remote_ip || request.client_ip || ''),
      method: String(request.method || 'GET'),
      path,
      status: Number(row.status || 0),
      durationMs: Math.max(0, Math.round(Number(row.duration || 0) * 1000)),
      ua: headerValue(request.headers?.['User-Agent'] ?? request.headers?.['user-agent']).slice(0, 180),
      host: String(request.host || ''),
      proto: String(request.proto || ''),
    }
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')

  const query = getQuery(event)
  const hours = numberParam(query.hours, DEFAULT_HOURS, 1, MAX_HOURS)
  const limit = numberParam(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT)
  const excludeOwn = String(query.excludeOwn ?? '') === '1'

  let lines: string[]
  try {
    lines = await readTailLines(LOG_PATH)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return {
        available: false,
        message: `还没有访问日志：${LOG_PATH}`,
        generatedAt: new Date().toISOString(),
        windowHours: hours,
        total: 0,
        uniqueIps: 0,
        errorCount: 0,
        excludedOwn: 0,
        records: [],
        byIp: [],
        byPath: [],
      }
    }
    throw createError({
      statusCode: 503,
      statusMessage: code === 'EACCES' ? '读不到访问日志，检查文件权限' : '访问日志读取失败',
    })
  }

  const since = Date.now() / 1000 - hours * 3600
  const allRecords = lines
    .map(parseRecord)
    .filter((row): row is TrafficRecord => row !== null && row.ts >= since)
    .sort((a, b) => b.ts - a.ts)
  const excludedOwn = excludeOwn ? allRecords.filter(isOwn).length : 0
  const records = excludeOwn ? allRecords.filter((row) => !isOwn(row)) : allRecords

  const byIpMap = new Map<string, { count: number; first: number; last: number }>()
  const byPathMap = new Map<string, number>()
  let errorCount = 0

  for (const record of records) {
    if (record.status >= 400) errorCount += 1
    byPathMap.set(record.path, (byPathMap.get(record.path) ?? 0) + 1)

    const ip = byIpMap.get(record.ip) ?? {
      count: 0,
      first: record.ts,
      last: record.ts,
    }
    ip.count += 1
    ip.first = Math.min(ip.first, record.ts)
    ip.last = Math.max(ip.last, record.ts)
    byIpMap.set(record.ip, ip)
  }

  const byIp: IpRow[] = [...byIpMap.entries()]
    .map(([ip, item]) => ({
      ip,
      count: item.count,
      first: new Date(item.first * 1000).toISOString(),
      last: new Date(item.last * 1000).toISOString(),
    }))
    .sort((a, b) => b.count - a.count)

  const byPath: PathRow[] = [...byPathMap.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)

  return {
    available: true,
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    total: records.length,
    uniqueIps: byIp.length,
    errorCount,
    excludedOwn,
    records: records.slice(0, limit).map((record) => ({
      ...record,
      time: new Date(record.ts * 1000).toISOString(),
    })),
    byIp: byIp.slice(0, 20),
    byPath: byPath.slice(0, 20),
  }
})
