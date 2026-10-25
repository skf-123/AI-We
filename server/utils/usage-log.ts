/**
 * 每个 AI 功能调用结束后写一行 token 用量。
 *
 * 只记数字和功能名，不记代码、提示词或用户输入。
 * 同时写两个地方：
 *   · stdout → systemd journald：journalctl -u ai-web | grep llm-usage
 *   · 项目根目录 logs/llm-usage.jsonl → 本地直接打开或用 npm run usage:report 汇总
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const LOG_DIR = join(process.cwd(), 'logs')
const LOG_FILE = join(LOG_DIR, 'llm-usage.jsonl')
let dirReady = false

function appendUsageLine(entry: Record<string, unknown>): void {
  try {
    if (!dirReady) {
      mkdirSync(LOG_DIR, { recursive: true })
      dirReady = true
    }
    appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // 写文件失败不能影响请求；journald 里还有一份
  }
}

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
  const entry = {
    ts: new Date().toISOString(),
    feature,
    prompt: usage?.prompt_tokens ?? null,
    completion: usage?.completion_tokens ?? null,
    total: usage?.total_tokens ?? null,
    cache_hit: usage?.prompt_cache_hit_tokens ?? null,
    cache_miss: usage?.prompt_cache_miss_tokens ?? null,
    ms: Date.now() - startedAt,
    ...extra,
  }

  try {
    console.info('[llm-usage]', JSON.stringify(entry))
  } catch {
    // 控制台失败不能影响请求
  }

  appendUsageLine(entry)
}
