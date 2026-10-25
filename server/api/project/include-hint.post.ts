import { z } from 'zod'
import { callLlmText } from '../../utils/llm'
import { logLlmUsage } from '../../utils/usage-log'

/**
 * POST /api/project/include-hint
 *
 * 用户在项目模式里想勾选一个「默认不勾」的系统文件 / 目录时，先让模型用一两句
 * 大白话说明为什么不建议勾、勾了会怎样。只返回一段短文本，不读文件、不查知识库。
 *
 * 失败不挡用户：返回一句固定的说明，弹窗照样能用。
 */

const RequestSchema = z.object({
  kind: z.enum(['file', 'folder']),
  path: z.string().trim().min(1).max(1000),
  label: z.string().trim().max(1000).default(''),
  reason: z.string().trim().max(200).default(''),
  size: z.number().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
})

const FALLBACK =
  '这是系统文件，勾选后会占用 1.9MB 的选中预算，通常不建议；如果你确实需要它参与理解，可以仍然勾选。'

const SYSTEM_PROMPT = `你是「麦穗 · 代码理解助手」的项目模式助手。用户在项目解析里想勾选一个默认不勾的系统文件或目录。请用一到两句中文说明：为什么默认不建议勾选，勾选后会怎样。要提到它可能占用 1.9MB 的选中预算，或逐文件解析的代价。不要夸大、不要编造具体代码内容。最多 80 字，只输出这两句话，不要 Markdown。`

export default defineEventHandler(async (event): Promise<{ text: string }> => {
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  const config = useRuntimeConfig(event)
  const input = parsed.data

  const detail = [
    `类型：${input.kind === 'file' ? '单个文件' : '整个文件夹'}`,
    `路径：${input.label || input.path}`,
    input.reason ? `默认不勾的原因：${input.reason}` : '',
    typeof input.size === 'number' ? `大小：${(input.size / 1024).toFixed(1)} KB` : '',
    typeof input.count === 'number' ? `里面还没勾的系统文件：${input.count} 个` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const startedAt = Date.now()
  try {
    const result = await callLlmText(
      {
        apiKey: config.llmApiKey,
        baseUrl: config.llmBaseUrl,
        model: config.llmModel,
      },
      {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: detail },
        ],
        stream: false,
        temperature: 0.3,
        maxTokens: 160,
        timeoutMs: 20_000,
      },
    )
    logLlmUsage('project/include-hint', result.usage, startedAt, {
      model: config.llmModel,
      finishReason: result.finishReason,
    })

    return { text: result.text.trim() || FALLBACK }
  } catch (err) {
    logLlmUsage('project/include-hint', null, startedAt, {
      model: config.llmModel,
      failed: true,
    })
    console.warn('[project/include-hint] 模型调用失败，使用固定说明：', err)
    return { text: FALLBACK }
  }
})
