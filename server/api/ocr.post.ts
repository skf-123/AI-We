import { z } from 'zod'
import { callLlmText } from '../utils/llm'
import { logLlmUsage } from '../utils/usage-log'

/**
 * POST /api/ocr
 *
 * 收一张代码截图（data URL），让模型把图里的代码原样转成文本。
 * 只做「图片 → 文本」这一件事：不解释、不分析、不自动开始解析。
 * 转出来的文本回到输入框，用户看一眼、改一改，再自己点开始解析。
 *
 * 为什么用非流式：
 *   截图识别一般几秒就完，流式只会让用户看到代码一个字一个字冒出来，
 *   反而不敢确认。一次性拿到完整结果，前端再整段放进输入框更稳。
 *
 * 上限：
 *   图片 5 MB（base64 之后约 6.7 MB），代码 2 万字符（和 /api/analyze 一致）。
 *   超了直接说清楚，不截一半给用户。
 */

/** 图片原始字节上限；base64 会膨胀约 4/3，所以请求体比这个大 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** 和复制代码入口保持一致 */
const MAX_CODE_CHARS = 20_000

const RequestSchema = z.object({
  image: z
    .string()
    .min(32, '没有收到图片')
    .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 256, '图片太大了，请控制在 5 MB 以内'),
})

const SYSTEM_PROMPT = [
  '你是代码截图识别器。任务只有一件：把图片里的代码原样转成文本。',
  '规则：',
  '1. 只输出代码本身，保留原有的缩进、空行和注释。',
  '2. 不解释、不总结、不补全、不纠正。看不清的字符按最接近的原样写，不要猜一整行。',
  '3. 不要加 markdown 代码块标记，不要加「以下是代码」这类前后缀。',
  '4. 图片里没有代码时，输出空字符串，不要输出任何说明。',
  '5. 图片里有多段代码时，按从上到下的顺序连着输出，段之间保留一个空行。',
].join('\n')

/** 模型偶尔仍会套一层代码块；这里只剥最外层，不动代码本身 */
function stripFence(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trim()
  const match = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/)
  return (match?.[1] ?? text).trim()
}

/** 模型偶尔用「（空）」「无」表示没有代码，按空处理，别把这两个字放进输入框 */
function cleanCode(raw: string): string {
  const text = stripFence(raw)
  if (/^(?:（|\(|【|\[)?\s*(?:空|无|没有代码|无代码)\s*(?:）|\)|】|\])?$/.test(text)) return ''
  return text
}

export default defineEventHandler(async (event) => {
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  const image = parsed.data.image.trim()
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(image)
  if (!match) {
    throw createError({
      statusCode: 400,
      statusMessage: '只支持 PNG、JPG、WebP 三种截图格式',
    })
  }

  const imageBytes = Math.floor((match[2]!.replace(/\s/g, '').length * 3) / 4)
  if (imageBytes > MAX_IMAGE_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `图片约 ${(imageBytes / 1024 / 1024).toFixed(1)} MB，超过 5 MB 的上限`,
    })
  }

  const llm = resolveLlmConfig(event)
  const startedAt = Date.now()

  let result: Awaited<ReturnType<typeof callLlmText>>
  try {
    result = await callLlmText(
      {
        apiKey: llm.apiKey,
        baseUrl: llm.baseUrl,
        // 留空时回退到主模型（2026-11-07 实测 deepseek-chat 这个别名也能读图）
        model: llm.visionModel,
      },
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: '把这张图里的代码转成文本。' },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        temperature: 0,
        maxTokens: 8000,
        timeoutMs: 90_000,
      },
    )
  } catch (err) {
    const message = (err as { statusMessage?: string })?.statusMessage ?? ''
    // 图片本身坏了或格式对不上时，上游会给 400；别把一段上游英文原样丢给用户
    if (/image/i.test(message) && /400/.test(message)) {
      throw createError({
        statusCode: 400,
        statusMessage: '这张图片读不了，换一张清楚的 PNG / JPG 截图再试。',
      })
    }
    throw err
  }

  logLlmUsage('code/ocr', result.usage, startedAt, {
    model: llm.visionModel,
    imageBytes,
    finishReason: result.finishReason,
  })

  const code = cleanCode(result.text)

  if (!code) {
    throw createError({
      statusCode: 422,
      statusMessage: '没在图片里认出代码。换一张更清楚的截图，或直接把代码粘进来。',
    })
  }

  if (code.length > MAX_CODE_CHARS) {
    throw createError({
      statusCode: 413,
      statusMessage: `识别出的代码有 ${code.length.toLocaleString()} 个字符，超过 2 万的上限。请分开截图，或直接粘贴代码。`,
    })
  }

  return { code }
})
