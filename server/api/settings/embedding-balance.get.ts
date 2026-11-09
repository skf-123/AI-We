import { createError, getRequestHeader } from 'h3'
import { resolveEmbeddingConfig } from '../../utils/embedding-config'

/**
 * 智谱账户余额。
 *
 * 用的是智谱控制台自己在用的接口，不是公开文档里的正式 API：
 * GET https://www.bigmodel.cn/api/biz/account/query-customer-account-report
 * 带 Authorization: Bearer <key>，返回 balance / availableBalance。
 *
 * 它可能随平台改版失效；失效时设置页显示“暂时查不到”，不影响检索本身。
 */
const BALANCE_URL = 'https://www.bigmodel.cn/api/biz/account/query-customer-account-report'

/** 查我们自己的余额时限流；评委查自己的不拦 */
const lastCall = new Map<string, number>()
const MIN_INTERVAL_MS = 1000

function throttle(event: Parameters<typeof getRequestHeader>[0]) {
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestHeader(event, 'x-real-ip') ||
    'unknown'
  const now = Date.now()
  if (now - (lastCall.get(ip) ?? 0) < MIN_INTERVAL_MS) {
    throw createError({ statusCode: 429, statusMessage: '查得太快了，稍等一秒再试' })
  }
  lastCall.set(ip, now)
}

export default defineEventHandler(async (event) => {
  const config = resolveEmbeddingConfig(event)

  if (!config.apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: '服务端没有配置智谱 key，也没有收到自定义 key',
    })
  }

  if (!config.usingOwnKey) throttle(event)

  let upstream: Response
  try {
    upstream = await fetch(BALANCE_URL, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `连不上智谱余额接口：${err instanceof Error ? err.message : String(err)}`,
    })
  }

  if (upstream.status === 401 || upstream.status === 403) {
    throw createError({ statusCode: 401, statusMessage: '这个智谱 key 无效，或者已经被停用' })
  }

  if (!upstream.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `智谱余额接口返回异常（${upstream.status}）`,
    })
  }

  const data = (await upstream.json().catch(() => null)) as {
    code?: number
    msg?: string
    data?: { balance?: number | string; availableBalance?: number | string }
  } | null

  if (!data || data.code !== 200 || !data.data) {
    throw createError({
      statusCode: 502,
      statusMessage: `智谱余额接口返回异常：${(data?.msg ?? '没有余额字段').slice(0, 120)}`,
    })
  }

  return {
    usingOwnKey: config.usingOwnKey,
    currency: 'CNY',
    balance: String(data.data.balance ?? '0'),
    availableBalance: String(data.data.availableBalance ?? data.data.balance ?? '0'),
  }
})
