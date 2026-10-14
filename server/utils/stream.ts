/**
 * 把上游大模型的 SSE 流转成**纯文本流**。
 *
 * 上游返回的是一堆 `data: {"choices":[{"delta":{"content":"…"}}]}` 行，
 * 这里把它"拆壳"，只把正文增量吐出去 —— 浏览器那侧只要按文本读、
 * 按文本追加显示，就能得到打字机效果，不必自己懂 SSE。
 *
 * 原先这段写在 server/api/analyze.post.ts 里，因为 /api/ask 也要用同一套
 * 拆壳逻辑，所以提出来共享 —— 行为与提取前逐字一致。
 */
export async function* toTextStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
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
        if (payload === '[DONE]') return

        try {
          const chunk = JSON.parse(payload)
          const text = chunk?.choices?.[0]?.delta?.content
          if (text) yield text
        } catch {
          // 上游偶尔会切出不完整的分片，忽略即可，不中断整个流
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}
