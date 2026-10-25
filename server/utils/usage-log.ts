/**
 * 每个 AI 功能调用结束后写一行 token 用量。
 *
 * 只记数字和功能名，不记代码、提示词或用户输入。
 * 日志走 stdout，由 systemd 收进 journald：
 *   journalctl -u ai-web | grep llm-usage
 */

export interface LlmUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  [key: string]: unknown
}

export function logLlmUsage(
  feature: string,
  usage: LlmUsage | null | undefined,
  startedAt: number,
  extra: Record<string, unknown> = {},
): void {
  try {
    console.info(
      '[llm-usage]',
      JSON.stringify({
        feature,
        prompt: usage?.prompt_tokens ?? null,
        completion: usage?.completion_tokens ?? null,
        total: usage?.total_tokens ?? null,
        cache_hit: usage?.prompt_cache_hit_tokens ?? null,
        cache_miss: usage?.prompt_cache_miss_tokens ?? null,
        ms: Date.now() - startedAt,
        ...extra,
      }),
    )
  } catch {
    // 日志失败不能影响请求
  }
}
