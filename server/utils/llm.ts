import { createError } from 'h3'

/**
 * 项目入口专用的上游调用。
 *
 * 为什么新开一个文件，而不是把 analyze.post.ts 里那段抽出来共用：
 * 现有主链路是"红线"路径（输出内容不许变），项目入口第一版不为复用去动它。
 * 这里只服务 /api/project/* 三个接口，行为与主链路保持同一套约定：
 *   · 非 200 一律变成我们能看懂的报错
 *   · 429 单独处理（太密集，该退避重试；502 是上游真挂了）
 *   · 带超时，否则一个卡住的文件会一直占着前端池子的槽位
 */

export interface LlmRuntimeConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface LlmCallOptions {
  messages: unknown[]
  stream: boolean
  temperature?: number
  maxTokens?: number
  /** 等响应头的上限（毫秒）。流开始后不再计时 */
  timeoutMs?: number
  /** Function Calling 的工具定义 */
  tools?: unknown[]
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

/** 上游返回非 200 时，把状态码翻译成前端该看到的那一种 */
function upstreamError(status: number, detail: string) {
  if (status === 429) {
    return createError({
      statusCode: 429,
      statusMessage: '大模型请求过于密集（429），请稍等几秒再试',
    })
  }
  return createError({
    statusCode: 502,
    statusMessage: `大模型返回异常（${status}）：${detail.slice(0, 300)}`,
  })
}

/**
 * 调一次上游，返回原始 Response。
 *
 * 调用方负责读 body（流式或 JSON）。超时只覆盖"等到响应头"这一段：
 * 一旦响应头到了，正文要流多久由生成过程决定，不该被这个计时器掐断。
 */
export async function callLlm(config: LlmRuntimeConfig, opts: LlmCallOptions): Promise<Response> {
  if (!config.apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: '服务端未配置大模型 API Key，请检查 .env 文件里的 NUXT_LLM_API_KEY',
    })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000)

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        stream: opts.stream,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 8192,
        messages: opts.messages,
        ...(opts.tools ? { tools: opts.tools } : {}),
        ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
      }),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw upstreamError(res.status, detail)
    }

    return res
  } catch (err) {
    // createError 自己抛出来的，原样往上走
    if ((err as { statusCode?: number })?.statusCode) throw err

    if ((err as Error)?.name === 'AbortError') {
      throw createError({
        statusCode: 504,
        statusMessage: '大模型响应超时，请稍后重试',
      })
    }

    throw createError({
      statusCode: 502,
      statusMessage: `无法连接大模型服务：${err instanceof Error ? err.message : String(err)}`,
    })
  } finally {
    // 响应头已经到了（或已失败），等响应头这一段不再计时
    clearTimeout(timer)
  }
}

/**
 * 非流式调用，直接把模型输出的文本取出来。
 * 只给"项目地图"这种一次要一小段 JSON 的调用用。
 */
export async function callLlmText(config: LlmRuntimeConfig, opts: LlmCallOptions): Promise<string> {
  const res = await callLlm(config, { ...opts, stream: false })
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[]
  } | null

  return data?.choices?.[0]?.message?.content ?? ''
}

export interface LlmMessage {
  role: 'assistant'
  content: string
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
}

/** 非流式调用，返回完整的 assistant 消息（含 tool_calls）。Agent 循环用 */
export async function callLlmMessage(
  config: LlmRuntimeConfig,
  opts: LlmCallOptions,
): Promise<LlmMessage> {
  const res = await callLlm(config, { ...opts, stream: false })
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: LlmMessage }[]
  } | null

  return data?.choices?.[0]?.message ?? { role: 'assistant', content: '' }
}
