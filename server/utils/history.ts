/**
 * 追问历史的长度预算 —— 决定每次追问带多少历史对话给模型。
 *
 * ── 为什么需要 ──
 * 模型没有记忆。每问一次，都是全新的一次请求，靠"把之前的对话重新发一遍"
 * 才显得它记得。一直问下去不能无限带，所以要有把尺子。
 *
 * ── 为什么不能用"条数"当尺子 ──
 * 之前这里卡的是条数（history 最多 20 条）。问题是**条数跟成本、延迟、上下文
 * 都没有对应关系**：一句"啥意思"和一段三千字的回答被一视同仁。于是问到第 12 个
 * 问题（2×11 = 22 条）就顶到上限、Zod 直接 400，而且之后每次都超限 ——
 * 气泡永久坏掉。该卡的是**长度**。
 *
 * ── 这个预算是按什么定的 ──
 * 实测（见 docs/追问上下文预算说明.md）：**首字延迟几乎不随输入规模增长**，
 * 8.7 万 token 的输入冷启动也只要 1.7 秒、缓存命中时 0.5 秒。所以预算不是
 * 按"等不等得起"定的，而是按"最坏情况的账单"定的。
 *
 * 这里全是纯函数：数组进、数组出，不碰配置、不碰请求 —— 可以直接断言。
 */

export interface HistoryItem {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 最坏情况的 token/字符比。
 *
 * 实测标定：中文 ≈ 0.6 token/汉字，英文与代码 ≈ 0.3 token/字符。
 * **取较大的那个是故意的** —— 这样算出来的字符预算，无论历史里是中文还是代码，
 * 实际 token 都不会超过预算。代价是纯代码/英文的历史只用到一半额度
 * （保守，但不越界）。
 */
const TOKENS_PER_CHAR_WORST = 0.6

/** token 预算 → 字符预算。10 万 token → 166,666 字符 */
export function charBudgetOf(tokenBudget: number): number {
  return Math.floor(tokenBudget / TOKENS_PER_CHAR_WORST)
}

/**
 * 条数护栏 —— **写死，而且不参与"带多少"的决策**。
 *
 * 它只挡一件事：畸形请求（比如有人塞进几万条空字符串，让服务端白白解析）。
 * 合格标准就一条：**绝不先于长度预算触发** —— 门闩要装得比门宽。
 *
 * 换算一次给你看：字符预算 166,666 ÷ 一条"合理消息"最少 20 字符 ≈ 8300，
 * 取 5000 已经足够宽 —— 要先触发它，得平均每条短于 33 字符，
 * 而真实消息平均约 175 字符（问题约 20 + 回答约 330）。
 */
export const HISTORY_ITEM_GUARD = 5000

/**
 * 从**最近**往前累加，超出字符预算就停。
 *
 * ⚠️ 至少保留一条：不能因为某一条特别长（哪怕它自己就超了预算）就把历史清空 ——
 *    那会让模型彻底失去上下文，比"多带一点"糟得多。
 */
export function trimHistory(items: HistoryItem[], charBudget: number): HistoryItem[] {
  const kept: HistoryItem[] = []
  let used = 0

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (used + item.content.length > charBudget && kept.length > 0) break
    kept.unshift(item)
    used += item.content.length
  }

  return kept
}
