import { createError, getRequestHeader } from 'h3'
import { resolveEmbeddingConfig } from '../../utils/embedding-config'
import { probeEmbedding } from '../../rag/embed'

/**
 * 验证评委填的智谱 key。
 *
 * 只接受请求头里带的 key，不拿服务端默认 key 做试验：
 * 否则这个接口就成了任何人都能消耗我们智谱额度的入口。
 */
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
  throttle(event)

  const config = resolveEmbeddingConfig(event)
  if (!config.usingOwnKey) {
    throw createError({
      statusCode: 400,
      statusMessage: '没有收到要验证的智谱 key',
    })
  }

  const result = await probeEmbedding(config)

  if (result.ok) {
    return {
      ok: true,
      dimensions: result.dimensions,
      usingOwnKey: true,
    }
  }

  if (result.status === 401 || result.status === 403) {
    throw createError({
      statusCode: 401,
      statusMessage: '这个智谱 key 无效，或者已经被停用',
    })
  }

  if (result.status === 429) {
    throw createError({
      statusCode: 429,
      statusMessage: '智谱提示限流或额度不足，稍后再试，或检查账户余额',
    })
  }

  if (/timeout|abort/i.test(result.message ?? '')) {
    throw createError({ statusCode: 504, statusMessage: '智谱响应超时，稍后再试' })
  }

  throw createError({
    statusCode: 502,
    statusMessage: `智谱返回异常：${(result.message ?? '未知错误').slice(0, 160)}`,
  })
})
