import { z } from 'zod'
import { OUTPUT_TRUNCATED_MARKER } from '#shared/stream-meta'
import { RAG_INSTRUCTION } from '../../utils/prompt'
import { toLoggedTextStream } from '../../utils/stream'
import { callLlm } from '../../utils/llm'
import { PROJECT_FILE_SYSTEM_PROMPT, buildProjectFilePrompt } from '../../utils/project-prompt'
import { retrieveDocs } from '../../rag/retrieve'
import type { EmbedConfig, RagConfig, RagSource } from '../../rag/types'

/**
 * POST /api/project/analyze
 *
 * 项目入口的逐文件解析：一次一个文件，四段输出，流式返回。
 *
 * 与 /api/analyze 的关系：
 *   · 现有主链路一行不动（红线：贴代码入口的输出内容不许变）；
 *   · 这里复用 toTextStream、retrieveDocs、RAG_INSTRUCTION 与 runtimeConfig，
 *     但提示词、接口入参、四段约定都是项目模式自己的。
 *
 * 请求结构（前缀缓存的硬约束）：
 *   system 固定 → 项目结构结论（每次原样） → 当前文件代码
 *   文件名不能放到最前面，否则 DeepSeek 的前缀缓存命中率会掉到 0。
 *
 * 单文件上限 50000 字符：超了截断，并通过响应头告诉前端「这个结果不完整」。
 * 前端池子会给每个请求带自己的 AbortController，点「停止」时一次掐掉。
 */

/** 项目模式下单个文件的上限（比贴代码入口的 20000 宽） */
const FILE_MAX = 50_000

const RequestSchema = z.object({
  path: z.string().trim().min(1).max(1000),
  code: z.string().trim().min(1).max(100_000, '文件太大了'),
  projectContext: z.string().max(50_000).default(''),
  /** 前端从源码解析出的、与本文件相关的硬事实；没有就是空字符串 */
  verifiedFacts: z.string().max(20_000).default(''),
})

export default defineEventHandler(async (event) => {
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  const { path: filePath, projectContext, verifiedFacts } = parsed.data
  const truncated = parsed.data.code.length > FILE_MAX
  const code = truncated ? parsed.data.code.slice(0, FILE_MAX) : parsed.data.code

  const config = useRuntimeConfig(event)

  // ---- 知识库检索：按文件内容判语言，不把整个项目塞进一次检索 ----
  const ragConfig: RagConfig = {
    enabled: config.ragEnabled,
    topK: config.ragTopK,
    minScore: config.ragMinScore,
  }
  const embedConfig: EmbedConfig = {
    apiKey: config.embeddingApiKey,
    baseUrl: config.embeddingBaseUrl,
    model: config.embeddingModel,
    dimensions: config.embeddingDimensions,
  }

  const docs = await retrieveDocs(code, ragConfig, embedConfig).catch(() => [])

  const sources: RagSource[] = docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    label: doc.source.label,
    url: doc.source.url,
    score: Number(doc.score.toFixed(4)),
  }))

  const systemPrompt =
    docs.length > 0 ? PROJECT_FILE_SYSTEM_PROMPT + RAG_INSTRUCTION : PROJECT_FILE_SYSTEM_PROMPT

  const userPrompt = buildProjectFilePrompt(
    projectContext,
    filePath,
    code,
    docs,
    verifiedFacts,
  )

  // ---- 上游调用（callLlm 内部处理 429 / 超时 / 非 200）----
  const startedAt = Date.now()
  const upstream = await callLlm(
    {
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
      model: config.llmModel,
    },
    {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      temperature: 0.3,
      // 四段讲解的输出上限；提示词要求 1800~3500 字，1 万给长文件留余量
      maxTokens: 10_000,
      timeoutMs: 120_000,
    },
  )

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  }

  if (sources.length > 0) {
    headers['X-Rag-Sources'] = encodeURIComponent(JSON.stringify(sources))
  }

  if (truncated) {
    headers['X-Project-Truncated'] = String(FILE_MAX)
  }

  return new Response(
    toLoggedTextStream(
      upstream.body as ReadableStream<Uint8Array>,
      { truncatedMarker: OUTPUT_TRUNCATED_MARKER },
      { feature: 'project/analyze', model: config.llmModel, startedAt },
    ) as unknown as ReadableStream,
    {
      headers,
    },
  )
})
