import { createError, getRequestHeader, type H3Event } from 'h3'
import type { EmbedConfig } from '../rag/types'

/**
 * 解析这次请求要用的 embedding 配置。
 *
 * 默认用服务端 .env 里的智谱 key；评委在设置里填了自己的智谱 key，
 * 就通过 x-embedding-api-key 请求头带上来，这一次请求用他的。
 *
 * 只允许覆盖 key。baseUrl、model、dimensions 仍然用服务端的值 ——
 * 语料向量是按智谱 embedding-3、1024 维建的，换模型或维度会对不上。
 */
export interface EmbeddingRequestConfig extends EmbedConfig {
  /** 这次是不是在用评委自己的 key */
  usingOwnKey: boolean
}

function readOverrideKey(event: H3Event): string | null {
  const raw = getRequestHeader(event, 'x-embedding-api-key')
  if (!raw) return null

  const key = raw.trim()
  if (!key) return null

  // 智谱的 key 是「id.secret」形态，不以 sk- 开头，只做可见 ASCII 检查
  if (!/^[\x21-\x7e]{8,200}$/.test(key)) {
    throw createError({
      statusCode: 400,
      statusMessage: '智谱 key 格式不对，应该是平台里那一整串',
    })
  }

  return key
}

export function resolveEmbeddingConfig(event: H3Event): EmbeddingRequestConfig {
  const config = useRuntimeConfig(event)
  const override = readOverrideKey(event)

  return {
    apiKey: override ?? config.embeddingApiKey,
    baseUrl: config.embeddingBaseUrl,
    model: config.embeddingModel,
    dimensions: config.embeddingDimensions,
    usingOwnKey: Boolean(override),
  }
}
