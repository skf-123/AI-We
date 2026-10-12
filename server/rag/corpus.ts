/**
 * 语料加载 + 校验 + 缓存。
 *
 * 把 corpus.json（人工维护）和 corpus.embeddings.json（脚本生成的向量）
 * 对到一起，任何对不上的条目都会被丢掉 —— 宁可少几条，也不要给出错误的检索结果。
 */
import type { CorpusEntry, EmbeddingsFile } from './types'
import corpusJson from './corpus.json'
import embeddingsJson from './corpus.embeddings.json'

/**
 * 内容哈希，用于检测「语料改了但忘了重跑 npm run rag:build」。
 *
 * ⚠️ 必须与 scripts/build-embeddings.mjs 里的 hashText() 完全一致，
 *    改一边就要同步改另一边，否则所有向量都会被判定为失效。
 */
export function hashText(str: string): string {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

export interface LoadedEntry {
  entry: CorpusEntry
  vector: number[]
}

/** 模块级缓存：语料是静态的，进程内只解析一次 */
let cache: LoadedEntry[] | null = null

/**
 * 加载可用的知识库条目。
 * 任何异常路径都返回空数组（调用方据此降级），绝不抛错。
 */
export function loadCorpus(dimensions: number): LoadedEntry[] {
  if (cache !== null) return cache

  const corpus = corpusJson as unknown as CorpusEntry[]
  const embeddings = embeddingsJson as unknown as EmbeddingsFile

  if (!Array.isArray(corpus) || corpus.length === 0) {
    console.warn('[rag] 语料为空，知识库停用')
    cache = []
    return cache
  }

  // 维度不符 → 整份产物作废。
  // query 向量和文档向量必须同维度才能算余弦，差一点都算不出来。
  if (!embeddings || embeddings.dimensions !== dimensions || !Array.isArray(embeddings.items)) {
    console.warn(
      `[rag] 向量产物不可用（产物维度 ${embeddings?.dimensions ?? '无'}，配置维度 ${dimensions}），知识库停用`,
    )
    cache = []
    return cache
  }

  const byId = new Map(embeddings.items.map((item) => [item.id, item]))

  const loaded: LoadedEntry[] = []
  let stale = 0

  for (const entry of corpus) {
    const item = byId.get(entry.id)
    if (!item) {
      stale++
      continue
    }

    // 语料内容变了但没重新生成向量 → 这条向量已经对不上当前内容，丢掉
    const expectedHash = hashText(`${entry.title}\n${entry.content}`)
    if (item.hash !== expectedHash) {
      stale++
      continue
    }

    if (!Array.isArray(item.vector) || item.vector.length !== dimensions) {
      stale++
      continue
    }

    loaded.push({ entry, vector: item.vector })
  }

  if (stale > 0) {
    console.warn(
      `[rag] 有 ${stale} 条语料的向量缺失或已失效，已跳过。改了语料请重跑 npm run rag:build`,
    )
  }

  console.log(`[rag] 知识库就绪：${loaded.length} 条可用（语料共 ${corpus.length} 条）`)
  cache = loaded
  return cache
}

/** 仅供测试/调试使用：清掉缓存 */
export function resetCorpusCache() {
  cache = null
}

/** 按 id 建一次索引，供"点开引用卡片看原文"用 */
let entryIndex: Map<string, CorpusEntry> | null = null

/**
 * 按 id 查一条语料（不需要向量，只读正文）。
 *
 * 用途：前端点开引用卡片时，通过 /api/source/:id 取这条语料的正文。
 * 为什么不塞进响应头里：4 条中文语料 URL 编码后约 8.5 KB，
 * 逼近 Node 默认的 16KB 头部上限，代理还可能卡得更低 —— 点开时再取更稳。
 */
export function findEntry(id: string): CorpusEntry | null {
  if (entryIndex === null) {
    const corpus = corpusJson as unknown as CorpusEntry[]
    entryIndex = new Map(corpus.map((entry) => [entry.id, entry]))
  }
  return entryIndex.get(id) ?? null
}
