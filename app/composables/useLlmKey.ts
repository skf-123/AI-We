import { readStoredLlmKey, writeStoredLlmKey } from '~/utils/llm-key'

/**
 * 评委自己的大模型 key，存当前标签页会话。
 *
 * 组件只拿它做展示和保存；真正的请求头由 app/utils/api.ts 统一读取。
 */
export function useLlmKey() {
  const key = useState<string>('wheat-llm-key', () => readStoredLlmKey())
  const hasOwnKey = computed(() => Boolean(key.value))

  function save(value: string) {
    const next = value.trim()
    writeStoredLlmKey(next)
    key.value = next
  }

  function clear() {
    writeStoredLlmKey('')
    key.value = ''
  }

  return { key, hasOwnKey, save, clear }
}
