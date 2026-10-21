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
  /** 请求失败或没拿到合法响应；用来避免把「没跑成」显示成「已核对」 */
  const failed = ref(false)

  let controller: AbortController | null = null
  let generation = 0

  async function run(candidates: VendorCandidate[]): Promise<Record<string, string>> {
    reset()

    if (candidates.length === 0) return {}

    const cap = vendorReviewCap(candidates.length)
    const picked = pickVendorCandidates(candidates, cap)

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

      if (current !== generation) return {}

      if (!res.ok) {
        failed.value = true
        return {}
      }

      const data = (await res.json()) as {
        suggestions?: { path?: unknown; evidence?: unknown }[]
      }
      // 只有真的拿到成功响应才算核对过：
      // 失败时不能让图例显示「AI 已核对 N 个」
      reviewed.value = picked.length
      const allowed = new Set(picked.map((item) => item.path))
      const result: Record<string, string> = {}

      for (const row of data.suggestions ?? []) {
        if (typeof row.path !== 'string' || typeof row.evidence !== 'string') continue
        if (!allowed.has(row.path)) continue

        const evidence = row.evidence.trim().slice(0, 120)
        if (evidence) result[row.path] = evidence
      }

      return result
    } catch (err) {
      // reset() 主动 abort 不算失败：换项目或页面卸载时本来就会中断
      if (current === generation && (err as Error)?.name !== 'AbortError') failed.value = true
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
    failed.value = false
  }

  return { running, reviewed, skipped, failed, run, reset }
}
