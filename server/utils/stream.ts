/**
 * 把上游大模型的 SSE 流转成**纯文本流**。
 *
 * 上游返回的是一堆 `data: {"choices":[{"delta":{"content":"…"}}]}` 行，
 * 这里把它"拆壳"，只把正文增量吐出去 —— 浏览器那侧只要按文本读、
 * 按文本追加显示，就能得到打字机效果，不必自己懂 SSE。
 *
 * 原先这段写在 server/api/analyze.post.ts 里，因为 /api/ask 也要用同一套
 * 拆壳逻辑，所以提出来共享 —— 行为与提取前逐字一致。
 *
 * 2026-10-24 加了一个可选能力：撞到输出上限时，在流末尾追加一个标记。
 * 响应头必须在流开始前发出去，而 finish_reason 在最后一块数据里才知道，
 * 所以只能用流内标记告诉前端「这次输出被截断了」。
 */

import { logLlmUsage, type LlmUsage } from './usage-log'

export interface TextStreamOptions {
  /** 撞到输出上限时，在流末尾追加这个标记；不传就完全保持原来的行为 */
  truncatedMarker?: string
  /** 上游在最后一块返回 usage 时回调；不是所有流都会带 */
  onUsage?: (usage: LlmUsage) => void
}

export async function* toTextStream(
  body: ReadableStream<Uint8Array>,
  options: TextStreamOptions = {},
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason = ''
  let ended = false

  try {
    while (!ended) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE 以换行分隔；最后一段可能不完整，留在 buffer 里等下一轮
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue

        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          ended = true
          break
        }

        try {
          const chunk = JSON.parse(payload)
          if (chunk?.usage) options.onUsage?.(chunk.usage as LlmUsage)
          const choice = chunk?.choices?.[0]
          const text = choice?.delta?.content
          if (text) yield text
          // finish_reason 在最后一块里；'length' 表示撞到 max_tokens
          if (choice?.finish_reason) finishReason = choice.finish_reason
        } catch {
          // 上游偶尔会切出不完整的分片，忽略即可，不中断整个流
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  // 正常读完才追加；用户中止时生成器被提前关闭，不会走到这里
  if (
    options.truncatedMarker &&
    (finishReason === 'length' || finishReason === 'max_tokens')
  ) {
    yield options.truncatedMarker
  }
}

export interface LoggedStreamMeta {
  feature: string
  model?: string
  startedAt: number
}

/**
 * 在 toTextStream 外面包一层：流结束（或中断）时写一行 token 用量。
 *
 * 用法和 toTextStream 一样，只是多传一个 feature / model / startedAt。
 * 用户中途停止时可能没有 usage，日志会标 usageMissing，不补假数。
 */
export async function* toLoggedTextStream(
  body: ReadableStream<Uint8Array>,
  options: TextStreamOptions,
  meta: LoggedStreamMeta,
): AsyncGenerator<string> {
  let usage: LlmUsage | null = null

  try {
    for await (const text of toTextStream(body, {
      ...options,
      onUsage: (next) => {
        usage = next
        options.onUsage?.(next)
      },
    })) {
      yield text
    }
  } finally {
    logLlmUsage(meta.feature, usage, meta.startedAt, {
      model: meta.model,
      usageMissing: !usage,
    })
  }
}
