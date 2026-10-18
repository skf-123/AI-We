import type { VendorCandidate } from '~/utils/project-vendor'
import { pickVendorCandidates, vendorReviewCap } from '~/utils/project-vendor'

/**
 * Agent 对「疑似第三方库」候选池的评审。
 *
 * 只负责请求与状态：
 *   · 程序先算上限（候选池 10%，下限 3、上限 20）并挑出名单；
 *   · 这里把名单和文件头摘要发给服务端，拿回建议；
 *   · 返回 path → evidence，不碰页面、不改勾选。
 *
 * 失败不挡任何流程：拿不到建议就当没有这回事。
 */

const MAX_HEADER_CHARS = 1500

export function useProjectVendorReview() {
  const running = ref(false)
  const reviewed = ref(0)
  const skipped = ref(0)

  let controller: AbortController | null = null
  let generation = 0

  async function run(candidates: VendorCandidate[]): Promise<Record<string, string>> {
    reset()

    if (candidates.length === 0) return {}

    const cap = vendorReviewCap(candidates.length)
    const picked = pickVendorCandidates(candidates, cap)

    reviewed.value = picked.length
    skipped.value = Math.max(0, candidates.length - picked.length)
    running.value = true
    controller = new AbortController()
    const current = generation

    try {
      const res = await fetch('/api/project/vendor-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidates: picked.map((item) => ({
            path: item.path,
            header: item.header.slice(0, MAX_HEADER_CHARS),
          })),
        }),
        signal: controller.signal,
      })

      if (!res.ok || current !== generation) return {}

      const data = (await res.json()) as {
        suggestions?: { path?: unknown; evidence?: unknown }[]
      }
      const allowed = new Set(picked.map((item) => item.path))
      const result: Record<string, string> = {}

      for (const row of data.suggestions ?? []) {
        if (typeof row.path !== 'string' || typeof row.evidence !== 'string') continue
        if (!allowed.has(row.path)) continue

        const evidence = row.evidence.trim().slice(0, 120)
        if (evidence) result[row.path] = evidence
      }

      return result
    } catch {
      return {}
    } finally {
      if (current === generation) {
        running.value = false
        controller = null
      }
    }
  }

  function reset() {
    generation++
    controller?.abort()
    controller = null
    running.value = false
    reviewed.value = 0
    skipped.value = 0
  }

  return { running, reviewed, skipped, run, reset }
}
