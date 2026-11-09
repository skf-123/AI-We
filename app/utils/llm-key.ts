/**
 * 评委自己的 key（大模型 + 智谱 embedding），只存在当前标签页的 sessionStorage。
 *
 * 关掉标签页就没了；不写 localStorage，不在服务端保存，也不进日志。
 * 所有对 AI 接口的请求都通过 llmKeyHeaders() 分别放进 x-llm-api-key 和 x-embedding-api-key。
 */
export const LLM_KEY_STORAGE = 'wheat-llm-key'
export const EMBEDDING_KEY_STORAGE = 'wheat-embedding-key'

function readStorage(name: string): string {
  if (!import.meta.client) return ''

  try {
    return sessionStorage.getItem(name)?.trim() ?? ''
  } catch {
    return ''
  }
}

function writeStorage(name: string, key: string): void {
  if (!import.meta.client) return

  try {
    const value = key.trim()
    if (value) sessionStorage.setItem(name, value)
    else sessionStorage.removeItem(name)
  } catch {
    // 隐私模式下 sessionStorage 可能不可写；不影响本次页面内使用
  }
}

export function readStoredLlmKey(): string {
  return readStorage(LLM_KEY_STORAGE)
}

export function writeStoredLlmKey(key: string): void {
  writeStorage(LLM_KEY_STORAGE, key)
}

export function readStoredEmbeddingKey(): string {
  return readStorage(EMBEDDING_KEY_STORAGE)
}

export function writeStoredEmbeddingKey(key: string): void {
  writeStorage(EMBEDDING_KEY_STORAGE, key)
}

/** 有 key 就带上，没有就空对象 —— 服务端会回退到我们自己的 key */
export function llmKeyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const llm = readStoredLlmKey()
  const embedding = readStoredEmbeddingKey()
  if (llm) headers['x-llm-api-key'] = llm
  if (embedding) headers['x-embedding-api-key'] = embedding
  return headers
}
