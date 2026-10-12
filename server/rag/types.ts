/**
 * 知识库（RAG）的类型定义。
 *
 * 数据流：
 *   corpus.json（人工维护的语料）
 *        ↓ 离线跑 scripts/build-embeddings.mjs
 *   corpus.embeddings.json（预计算的向量）
 *        ↓ 运行时
 *   retrieveDocs() 检索 → 注入提示词 + 通过响应头送给前端
 */

/** 语料覆盖的语言 / 技术 */
export type CorpusLang =
  'javascript' | 'typescript' | 'react' | 'vue' | 'css' | 'python' | 'java' | 'sql'

/** 一条语料 —— 这是知识库的最小单元，一条讲清一个概念 */
export interface CorpusEntry {
  /** 稳定唯一 id，如 "js-array-reduce"。改了 id 等于换了一条语料 */
  id: string
  lang: CorpusLang
  tags: string[]
  title: string
  /** 约 150-250 字的技术说明，是真正会喂给大模型的内容 */
  content: string
  source: {
    label: string
    url: string
  }
}

/** 一条预计算的向量 */
export interface EmbeddingItem {
  id: string
  /**
   * title + content 的哈希。
   * 运行时重新算一遍比对 —— 不一致说明语料改了但没重跑脚本，
   * 该条向量直接丢弃，避免静默给出错误的检索结果。
   */
  hash: string
  vector: number[]
}

/** corpus.embeddings.json 的完整结构（这个文件要提交进 git） */
export interface EmbeddingsFile {
  model: string
  dimensions: number
  generatedAt: string
  items: EmbeddingItem[]
}

/** 检索结果：语料条目 + 相似度分数 */
export interface RetrievedDoc extends CorpusEntry {
  score: number
}

/** 发给前端的引用来源（走 X-Rag-Sources 响应头） */
export interface RagSource {
  id: string
  title: string
  label: string
  url: string
  score: number
}

/** 检索相关的配置 */
export interface RagConfig {
  enabled: boolean
  topK: number
  minScore: number
}

/** embedding 服务的配置 */
export interface EmbedConfig {
  apiKey: string
  baseUrl: string
  model: string
  dimensions: number
}
