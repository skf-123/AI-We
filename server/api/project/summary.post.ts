import { z } from 'zod'
import { OUTPUT_TRUNCATED_MARKER } from '#shared/stream-meta'
import { toTextStream } from '../../utils/stream'
import { callLlm } from '../../utils/llm'
import {
  PROJECT_SUMMARY_SYSTEM_PROMPT,
  buildProjectSummaryPrompt,
  type SummaryFileInput,
} from '../../utils/project-prompt'

/**
 * POST /api/project/summary
 *
 * 全部文件解析完之后的一次汇总调用：
 * 输入只有「项目结构 + 每文件第三段摘要（截断）+ 引用关系」，**不重发全文**。
 * 输出：一段项目文字 + 唯一一张项目级图的 JSON。流式返回，前端边流边渲染文字，
 * 图等 JSON 闭合后自己出现。
 *
 * 与逐文件请求共用同一条上游通道，但提示词完全不同 —— 这里要的是跨文件视角。
 */

const RequestSchema = z.object({
  projectName: z.string().trim().max(200).default(''),
  projectContext: z.string().max(50_000).default(''),
  treeText: z.string().max(200_000).default(''),
  files: z
    .array(
      z.object({
        path: z.string().trim().min(1).max(1000),
        role: z.string().max(2000),
        imports: z.array(z.string().max(500)).max(20).default([]),
      }),
    )
    .max(2000),
})

export default defineEventHandler(async (event) => {
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  const config = useRuntimeConfig(event)
  const files: SummaryFileInput[] = parsed.data.files

  const userPrompt = buildProjectSummaryPrompt(
    parsed.data.projectContext,
    files,
    parsed.data.treeText,
  )

  const upstream = await callLlm(
    {
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
      model: config.llmModel,
    },
    {
      messages: [
        { role: 'system', content: PROJECT_SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      temperature: 0.3,
      // 正文和图共用这一次输出；187 个文件时 8192 会在图 JSON 中途截断
      maxTokens: 80_000,
      timeoutMs: 120_000,
    },
  )

  return new Response(
    toTextStream(upstream.body as ReadableStream<Uint8Array>, {
      truncatedMarker: OUTPUT_TRUNCATED_MARKER,
    }) as unknown as ReadableStream,
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    },
  )
})
