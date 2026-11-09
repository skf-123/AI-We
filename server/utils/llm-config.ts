import { createError, getRequestHeader, type H3Event } from 'h3'

/**
 * 解析这次请求要用的大模型配置。
 *
 * 默认用服务端 .env 里的 key；评委在设置里填了自己的 key，就通过
 * x-llm-api-key 请求头带上来，这一次请求用他的。
 *
 * 只允许覆盖 key。baseUrl 和 model 仍然用服务端的值 —— 否则前端就能
 * 把请求指到任意地址（SSRF），也能换成我们没校准过的模型。
 */
export interface LlmRequestConfig {
  apiKey: string
  baseUrl: string
  model: string
  visionModel: string
  /** 这次是不是在用评委自己的 key */
  usingOwnKey: boolean
}

/** 请求头里的 key 只做形态检查，真的能不能用交给上游判断 */
function readOverrideKey(event: H3Event): string | null {
  const raw = getRequestHeader(event, 'x-llm-api-key')
  if (!raw) return null

  const key = raw.trim()
  if (!key) return null

  // 只允许可见 ASCII，长度给一个宽松范围；避免把奇怪字符带进请求头
  if (!/^[\x21-\x7e]{16,200}$/.test(key)) {
    throw createError({
      statusCode: 400,
      statusMessage: '自定义 key 格式不对，应该是字母、数字和连接符组成的一串',
    })
  }

  return key
}

export function resolveLlmConfig(event: H3Event): LlmRequestConfig {
  const config = useRuntimeConfig(event)
  const override = readOverrideKey(event)

  return {
    apiKey: override ?? config.llmApiKey,
    baseUrl: config.llmBaseUrl,
    model: config.llmModel,
    visionModel: config.llmVisionModel || config.llmModel,
    usingOwnKey: Boolean(override),
  }
}
