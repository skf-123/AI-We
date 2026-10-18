import { z } from 'zod'
import { callLlmText } from '../../utils/llm'
import {
  PROJECT_VENDOR_REVIEW_SYSTEM_PROMPT,
  buildVendorReviewPrompt,
} from '../../utils/project-vendor-prompt'

/**
 * POST /api/project/vendor-review
 *
 * 对「疑似第三方库」候选池的一次小评审：
 *   · 候选由程序筛、上限由程序算（10%，下限 3、上限 20）；
 *   · 这里只把路径和文件头摘要交给模型，拿回建议；
 *   · 失败就返回空数组，不影响上传、目录树和逐文件解析。
 *
 * 只返回建议，不返回分类结果 —— 勾选状态由用户决定。
 */

const RequestSchema = z.object({
  candidates: z
    .array(
      z.object({
        path: z.string().trim().min(1).max(1000),
        header: z.string().max(4000).default(''),
      }),
    )
    .min(1)
    .max(40),
})

/** 模型可能包一层 ```json 围栏，也可能前后带几句话 */
function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  const candidates = parsed.data.candidates
  const allowed = new Set(candidates.map((item) => item.path))
  const config = useRuntimeConfig(event)

  try {
    const raw = await callLlmText(
      {
        apiKey: config.llmApiKey,
        baseUrl: config.llmBaseUrl,
        model: config.llmModel,
      },
      {
        messages: [
          { role: 'system', content: PROJECT_VENDOR_REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: buildVendorReviewPrompt(candidates) },
        ],
        stream: false,
        temperature: 0.1,
        maxTokens: 1536,
        timeoutMs: 30_000,
      },
    )

    const data = extractJson(raw) as { suggestions?: unknown } | null
    const suggestions: { path: string; evidence: string }[] = []

    if (data && Array.isArray(data.suggestions)) {
      for (const row of data.suggestions) {
        const item = row as { path?: unknown; isVendor?: unknown; evidence?: unknown }
        if (item.isVendor !== true) continue
        if (typeof item.path !== 'string' || typeof item.evidence !== 'string') continue

        const path = item.path.trim()
        if (!allowed.has(path)) continue

        const evidence = item.evidence.trim().slice(0, 120)
        if (!evidence) continue
        if (!suggestions.some((entry) => entry.path === path)) {
          suggestions.push({ path, evidence })
        }
      }
    }

    return { suggestions: suggestions.slice(0, candidates.length) }
  } catch (err) {
    console.warn('[project/vendor-review] 模型调用失败，跳过建议：', err)
    return { suggestions: [] }
  }
})
