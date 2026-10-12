/**
 * 调 embedding 服务，把文字变成向量。
 *
 * 注意：这里用的是【embedding 自己的配置】（智谱 GLM），
 * 与生成回答用的 LLM 配置（DeepSeek）完全分开，互不回退。
 * 两家的向量空间不通用，拿错 key 只会得到 404 或维度错乱。
 */
import type { EmbedConfig } from './types'

/** 智谱 embedding 接口单次数组上限是 64 条 */
const BATCH_SIZE = 64

/**
 * 把一批文字变成向量。
 * 失败时**抛错**（由上层决定怎么降级），不在这里吞掉。
 */
export async function embedTexts(
  texts: string[],
  cfg: EmbedConfig,
  signal?: AbortSignal,
): Promise<number[][]> {
  if (texts.length === 0) return []
  if (texts.length > BATCH_SIZE) {
    throw new Error(`单次最多 ${BATCH_SIZE} 条，收到 ${texts.length} 条`)
  }

  const baseUrl = cfg.baseUrl.replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      input: texts,
      dimensions: cfg.dimensions,
    }),
    signal,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`embedding 服务返回 HTTP ${res.status}：${detail.slice(0, 200)}`)
  }

  const json = (await res.json()) as { data?: { embedding?: number[] }[] }
  const vectors = json?.data?.map((d) => d.embedding)

  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error(
      `embedding 返回的向量数量对不上：请求 ${texts.length}，返回 ${vectors?.length ?? '非数组'}`,
    )
  }
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== cfg.dimensions) {
      throw new Error(
        `embedding 返回的向量维度异常：期望 ${cfg.dimensions}，实际 ${v?.length ?? '非数组'}`,
      )
    }
  }

  return vectors as number[][]
}

/**
 * 把用户代码变成查询向量。
 *
 * 这个函数**永不抛错** —— 失败时返回 null，调用方据此降级为「不做检索」。
 * 3 秒超时，保证不会因为 embedding 服务卡住而拖垮整个请求。
 */
export async function embedQuery(text: string, cfg: EmbedConfig): Promise<number[] | null> {
  if (!cfg.apiKey) {
    console.warn('[rag] 未配置 embedding key，跳过检索')
    return null
  }

  try {
    const [vector] = await embedTexts([text], cfg, AbortSignal.timeout(3000))
    return vector ?? null
  } catch (err) {
    console.warn('[rag] 查询向量化失败，本次跳过检索：', err instanceof Error ? err.message : err)
    return null
  }
}
