import { llmKeyHeaders } from './llm-key'

/**
 * 带评委 key 的请求封装。
 *
 * 只加 x-llm-api-key 一个头，其余行为和原生 fetch / $fetch 一样。
 * 非 AI 接口也可以用它，没有 key 时就是普通请求。
 */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  for (const [name, value] of Object.entries(llmKeyHeaders())) headers.set(name, value)

  return fetch(input, { ...init, headers })
}

export function apiFetchJson<T>(url: string, options: Record<string, unknown> = {}): Promise<T> {
  const headers = {
    ...((options.headers as Record<string, string> | undefined) ?? {}),
    ...llmKeyHeaders(),
  }

  return $fetch<T>(url, { ...options, headers }) as Promise<T>
}
