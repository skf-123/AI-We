/**
 * 分批图自检的 token 预算。
 *
 * 规则（2026-10-27 定稿；2026-10-30 只给总预算 300k，不再单独卡结构项）：
 *   · 总预算 300k；不再单独留预留，全部进批池；
 *   · 批池 300k；
 *   · 单批硬顶 15k；
 *   · 每批额度按需求权重分，用完的剩余回池；
 *   · 实际扣费按服务端 usage.total，不按字符数估。
 *
 * 纯函数；不读网络、不碰 DOM。
 */
import type { SelfCheckBatch } from '~/types/self-check'

export const SELF_CHECK_TOTAL_TOKENS = 300_000
export const SELF_CHECK_RESERVE_TOKENS = 0
export const SELF_CHECK_BATCH_CAP_TOKENS = 15_000
export const SELF_CHECK_HARD_TOKENS = 315_000
export const SELF_CHECK_MIN_BATCH_TOKENS = 1_500
/** 结构项不再单独卡上限；这个值只作“不设上限”的占位 */
export const SELF_CHECK_STRUCTURAL_TOKENS = 300_000

export interface SelfCheckBudget {
  total: number
  reserve: number
  /** 批池剩余；初始 = total - reserve */
  pool: number
  used: number
}

export function createSelfCheckBudget(
  total = SELF_CHECK_TOTAL_TOKENS,
  reserve = SELF_CHECK_RESERVE_TOKENS,
): SelfCheckBudget {
  return { total, reserve, pool: Math.max(0, total - reserve), used: 0 }
}

/** 剩下的批里，权重之和 */
export function remainingWeight(batches: SelfCheckBatch[]): number {
  return batches.reduce((sum, batch) => sum + 1 + batch.score, 0)
}

/**
 * 给当前批分配额度。
 * 池子不是先扣额度，而是按实际 usage 扣；没花完的自然留在池里。
 */
export function allocateBatchQuota(
  budget: SelfCheckBudget,
  batch: SelfCheckBatch,
  remainingBatches: SelfCheckBatch[],
): number {
  const weightSum = remainingWeight(remainingBatches)
  if (weightSum <= 0) return 0
  const weight = 1 + batch.score
  const share = (budget.pool * weight) / weightSum
  return Math.max(
    0,
    Math.min(SELF_CHECK_BATCH_CAP_TOKENS, Math.floor(share)),
  )
}

export function canStartBatch(budget: SelfCheckBudget, quota: number): boolean {
  return budget.used < SELF_CHECK_HARD_TOKENS && quota >= SELF_CHECK_MIN_BATCH_TOKENS
}

export function recordUsage(budget: SelfCheckBudget, tokens: number): void {
  const used = Number(tokens) || 0
  budget.used += used
  budget.pool = Math.max(0, budget.pool - used)
}

export function budgetExceeded(budget: SelfCheckBudget): boolean {
  return budget.used >= SELF_CHECK_HARD_TOKENS || budget.pool <= 0
}
