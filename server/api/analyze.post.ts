import { z } from 'zod'
import { SYSTEM_PROMPT, buildUserPrompt } from '../utils/prompt'

/**
 * POST /api/analyze
 *
 * 接收 { code }，调用 DeepSeek，把结果**流式**吐回浏览器。
 *
 * 为什么要经过服务端而不是浏览器直接调 DeepSeek：
 *   API Key 只能放在服务端。浏览器的代码是公开的，谁按 F12 都能看到，
 *   把 key 放进去等于公开送人（大赛也明文禁止密钥出现在仓库里）。
 *
 * 流的形态：上游是 SSE（一堆 `data: {...}` 行），
 * 这里把它"拆壳"成**纯文本流**再传给前端，
 * 前端只要按文本读、按文本追加显示，就能得到打字机效果。
 */

const RequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, '请先粘贴一段代码')
    .max(20000, '代码太长了，请控制在 2 万字符以内'),
})

/** 把上游的 SSE 流转成纯文本流 */
async function* toTextStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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

export default defineEventHandler(async (event) => {
  // ---- 1. 校验输入 ----
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  // ---- 2. 取配置（只在服务端可见）----
  const config = useRuntimeConfig(event)
  if (!config.deepseekApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: '服务端未配置 DeepSeek API Key，请检查 .env 文件里的 NUXT_DEEPSEEK_API_KEY',
    })
  }

  // ---- 3. 调用上游大模型 ----
  let upstream: Response
  try {
    upstream = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseekModel,
        stream: true,
        temperature: 0.3, // 偏低：解释类任务要稳定、少发挥
        max_tokens: 8192,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(parsed.data.code) },
        ],
      }),
    })
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `无法连接大模型服务：${err instanceof Error ? err.message : String(err)}`,
    })
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    throw createError({
      statusCode: 502,
      statusMessage: `大模型返回异常（${upstream.status}）：${detail.slice(0, 300)}`,
    })
  }

  // ---- 4. 把文本流交给浏览器 ----
  return new Response(toTextStream(upstream.body) as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // 关掉 Nginx 之类的缓冲，否则流式会被攒成一坨再吐出来
      'X-Accel-Buffering': 'no',
    },
  })
})
