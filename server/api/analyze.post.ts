import { z } from 'zod'
import { SYSTEM_PROMPT, RAG_INSTRUCTION, buildUserPrompt } from '../utils/prompt'
import { toTextStream } from '../utils/stream'
import { retrieveDocs } from '../rag/retrieve'
import type { EmbedConfig, RagConfig, RagSource } from '../rag/types'

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
  if (!config.llmApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: '服务端未配置大模型 API Key，请检查 .env 文件里的 NUXT_LLM_API_KEY',
    })
  }

  // ---- 3. 知识库检索（RAG）----
  // 检索在流开始之前完成，所以「检索到哪几条」此刻就是确定已知的，
  // 稍后直接放进响应头，不需要让大模型再复述一遍（那样会引入幻觉和截断）。
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

  // retrieveDocs 内部已把所有异常降级成空数组，这里再兜一层，确保永不影响主流程
  const docs = await retrieveDocs(parsed.data.code, ragConfig, embedConfig).catch(() => [])

  const sources: RagSource[] = docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    label: doc.source.label,
    url: doc.source.url,
    score: Number(doc.score.toFixed(4)),
  }))

  // 只有检索到资料时才追加使用规则；没有资料时系统提示词与改造前逐字一致
  const systemPrompt = docs.length > 0 ? SYSTEM_PROMPT + RAG_INSTRUCTION : SYSTEM_PROMPT

  // ---- 4. 调用上游大模型 ----
  let upstream: Response
  try {
    upstream = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        stream: true,
        temperature: 0.3, // 偏低：解释类任务要稳定、少发挥
        max_tokens: 8192,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildUserPrompt(parsed.data.code, docs) },
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

  // ---- 5. 把文本流交给浏览器 ----
  //
  // 引用来源走响应头而不是塞进正文流，原因：
  //   1. 来源是服务端已经确定的事实，不该交给生成模型去复述
  //   2. 走响应头的话，前端在收到响应的那一刻就能渲染出卡片，
  //      不用等全文流完 —— 打字机刚启动就能看到「已检索到 N 条参考资料」
  //   3. 完全不污染正文流，也不需要处理「标记被切成两半」这类问题
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    // 关掉 Nginx 之类的缓冲，否则流式会被攒成一坨再吐出来
    'X-Accel-Buffering': 'no',
  }

  if (sources.length > 0) {
    // encodeURIComponent 是为了让中文标题/出处也能安全放进 HTTP 头（头只允许 ASCII）
    headers['X-Rag-Sources'] = encodeURIComponent(JSON.stringify(sources))
  }

  return new Response(toTextStream(upstream.body) as unknown as ReadableStream, { headers })
})
