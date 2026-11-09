import { createError, getRequestHeader } from 'h3'
import { resolveLlmConfig } from '../../utils/llm-config'

/**
 * 查余额。
 *
 * 不带 x-llm-api-key 时查服务端自己的账户；带了就查那个 key 的账户，
 * 用来让评委在设置里验证自己的 key。
 *
 * 上游接口是 GET {baseUrl}/user/balance，只返回金额，不返回 key。
 */

/** 同一来源两秒内只查一次，防止有人反复点刷新把余额接口打爆 */
const lastCall = new Map<string, number>()
const MIN_INTERVAL_MS = 1000

function throttle(event: Parameters<typeof getRequestHeader>[0]) {
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestHeader(event, 'x-real-ip') ||
    'unknown'
  const now = Date.now()
  const previous = lastCall.get(ip) ?? 0

  if (now - previous < MIN_INTERVAL_MS) {
    throw createError({ statusCode: 429, statusMessage: '查得太快了，稍等一秒再试' })
  }

  lastCall.set(ip, now)
}

export default defineEventHandler(async (event) => {
  const llm = resolveLlmConfig(event)

  // 只限制“查我们自己的余额”；评委查自己的 key 不拦，否则刚打开设置再保存就会撞上
  if (!llm.usingOwnKey) throttle(event)
  if (!llm.apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: '服务端没有配置默认 key，也没有收到自定义 key',
    })
  }

  let upstream: Response
  try {
    upstream = await fetch(`${llm.baseUrl}/user/balance`, {
      headers: { Authorization: `Bearer ${llm.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `连不上余额接口：${err instanceof Error ? err.message : String(err)}`,
    })
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '')

    if (upstream.status === 401) {
      throw createError({
        statusCode: 401,
        statusMessage: '这个 key 无效，或者已经被停用',
      })
    }

    throw createError({
      statusCode: 502,
      statusMessage: `余额接口返回异常（${upstream.status}）：${detail.slice(0, 200)}`,
    })
  }

  const data = (await upstream.json().catch(() => null)) as {
    is_available?: boolean
    balance_infos?: {
      currency?: string
      total_balance?: string
      granted_balance?: string
      topped_up_balance?: string
    }[]
  } | null

  return {
    usingOwnKey: llm.usingOwnKey,
    isAvailable: Boolean(data?.is_available),
    balances: (data?.balance_infos ?? []).map((item) => ({
      currency: item.currency ?? '',
      total: item.total_balance ?? '0',
      granted: item.granted_balance ?? '0',
      toppedUp: item.topped_up_balance ?? '0',
    })),
  }
})
