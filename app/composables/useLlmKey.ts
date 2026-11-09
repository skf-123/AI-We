import {
  readStoredEmbeddingKey,
  readStoredLlmKey,
  writeStoredEmbeddingKey,
  writeStoredLlmKey,
} from '~/utils/llm-key'

/**
 * 评委自己的大模型 key，存当前标签页会话。
 *
 * 组件只拿它做展示和保存；真正的请求头由 app/utils/api.ts 统一读取。
 */
export function useLlmKey() {
  const key = useState<string>('wheat-llm-key', () => readStoredLlmKey())
  const embeddingKey = useState<string>('wheat-embedding-key', () => readStoredEmbeddingKey())
  const hasOwnKey = computed(() => Boolean(key.value))
  const hasOwnEmbeddingKey = computed(() => Boolean(embeddingKey.value))

  function save(value: string) {
    const next = value.trim()
    writeStoredLlmKey(next)
    key.value = next
  }

  function clear() {
    writeStoredLlmKey('')
    key.value = ''
  }

  function saveEmbedding(value: string) {
    const next = value.trim()
    writeStoredEmbeddingKey(next)
    embeddingKey.value = next
  }

  function clearEmbedding() {
    writeStoredEmbeddingKey('')
    embeddingKey.value = ''
  }

  /** 打开设置时重新从 sessionStorage 同步一次，避免 SSR 初值把已存的 key 显示成空 */
  function syncFromStorage() {
    key.value = readStoredLlmKey()
    embeddingKey.value = readStoredEmbeddingKey()
  }

  return {
    key,
    embeddingKey,
    hasOwnKey,
    hasOwnEmbeddingKey,
    save,
    clear,
    saveEmbedding,
    clearEmbedding,
    syncFromStorage,
  }
}
