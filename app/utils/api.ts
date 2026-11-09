import { llmKeyHeaders } from './llm-key'

/**
 * 带评委 key 的请求封装。
 *
 * 会加 x-llm-api-key 和 x-embedding-api-key 两个头（有才加），其余行为和原生 fetch / $fetch 一样。
 * 非 AI 接口也可以用它，没有 key 时就是普通请求。
 */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  // 显式传进来的头优先，避免验证草稿 key 时被 sessionStorage 里的旧 key 覆盖
  for (const [name, value] of Object.entries(llmKeyHeaders())) {
    if (!headers.has(name)) headers.set(name, value)
  }

  return fetch(input, { ...init, headers })
}

export function apiFetchJson<T>(url: string, options: Record<string, unknown> = {}): Promise<T> {
  const headers = {
    ...llmKeyHeaders(),
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  }

  return $fetch<T>(url, { ...options, headers }) as Promise<T>
}
