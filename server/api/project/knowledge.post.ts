import { z } from 'zod'
import { searchKnowledge } from '../../rag/retrieve'
import type { EmbedConfig, RagConfig } from '../../rag/types'

/**
 * POST /api/project/knowledge
 *
 * Agent 的 search_knowledge 工具：按自然语言问题检索知识库。
 * 返回标题、出处、链接和一小段原文；检不到就返回空数组，不抛错。
 */

const RequestSchema = z.object({
  query: z.string().trim().min(1, '请输入检索内容').max(500),
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

  const docs = await searchKnowledge(parsed.data.query, ragConfig, embedConfig).catch(() => [])

  return {
    results: docs.map((doc) => ({
      title: doc.title,
      content: doc.content.slice(0, 800),
      label: doc.source.label,
      url: doc.source.url,
      score: Number(doc.score.toFixed(4)),
    })),
  }
})
