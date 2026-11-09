/**
 * 评委自己的大模型 key，只存在当前标签页的 sessionStorage。
 *
 * 关掉标签页就没了；不写 localStorage，不在服务端保存，也不进日志。
 * 所有对 AI 接口的请求都通过 llmKeyHeaders() 把它放进 x-llm-api-key 头。
 */
export const LLM_KEY_STORAGE = 'wheat-llm-key'

export function readStoredLlmKey(): string {
  if (!import.meta.client) return ''

  try {
    return sessionStorage.getItem(LLM_KEY_STORAGE)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function writeStoredLlmKey(key: string): void {
  if (!import.meta.client) return

  try {
    const value = key.trim()
    if (value) sessionStorage.setItem(LLM_KEY_STORAGE, value)
    else sessionStorage.removeItem(LLM_KEY_STORAGE)
  } catch {
    // 隐私模式下 sessionStorage 可能不可写；不影响本次页面内使用
  }
}

/** 有 key 就带上，没有就空对象 —— 服务端会回退到我们自己的 key */
export function llmKeyHeaders(): Record<string, string> {
  const key = readStoredLlmKey()
  return key ? { 'x-llm-api-key': key } : {}
}
