/**
 * 逐文件输出里的跨文件事实块：
 *   · 从流式文本里把它剥掉，不让用户看到；
 *   · 用当前文件的原文核对 path / line / quote；
 *   · 对不上的标 unverified，不删正文，也不假装核对过。
 *
 * 这是最小可验证版：只核对“引文能不能在当前文件里找到”，
 * 不判断 claim 的业务语义，也不重写正文。
 */

import type { FactCheck, FactClaim, VerifiedFact } from '~/types/facts'

export const FACTS_START = '<!--facts'
export const FACTS_END = '-->'

export interface FactsBlockResult {
  /** 去掉事实块之后、可以显示给用户的正文 */
  text: string
  /** 事实块完整闭合且 JSON 合法时才有值 */
  claims: FactClaim[] | null
  /** 事实块还没闭合，后面可能还有内容 */
  pending: boolean
  error?: string
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function parseClaims(raw: string): { claims: FactClaim[] | null; error?: string } {
  const cleaned = raw
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim()

  if (!cleaned) return { claims: [] }

  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return { claims: null, error: '事实块不是数组' }
    const claims = parsed.filter((item): item is FactClaim => Boolean(item) && typeof item === 'object')
    return { claims }
  } catch {
    return { claims: null, error: '事实块不是合法 JSON' }
  }
}

/** 从流式文本里剥掉事实块；未闭合时把这一段先扣住，等下一块 */
export function stripFactsBlock(text: string): FactsBlockResult {
  const start = text.indexOf(FACTS_START)

  if (start === -1) {
    // 末尾可能是标记的前半截（例如 <!--fac），先扣住，避免闪一下
    let hold = 0
    const max = Math.min(text.length, FACTS_START.length - 1)
    for (let size = max; size >= 1; size--) {
      if (text.endsWith(FACTS_START.slice(0, size))) {
        hold = size
        break
      }
    }
    return {
      text: hold > 0 ? text.slice(0, text.length - hold) : text,
      claims: null,
      pending: hold > 0,
    }
  }

  const before = text.slice(0, start)
  const after = text.slice(start + FACTS_START.length)
  const end = after.indexOf(FACTS_END)

  if (end === -1) {
    return { text: before.trimEnd(), claims: null, pending: true }
  }

  const raw = after.slice(0, end)
  const rest = after.slice(end + FACTS_END.length)
  const parsed = parseClaims(raw)

  return {
    text: `${before}${rest}`.trimEnd(),
    claims: parsed.claims,
    pending: false,
    error: parsed.error,
  }
}

/** 用当前文件的原文核对每条事实；最多 20 条，避免异常输出拖慢页面 */
export function verifyFacts(
  claims: FactClaim[],
  currentPath: string,
  fileText: string,
): FactCheck {
  const path = normalizePath(currentPath)
  const lines = fileText.split(/\r?\n/)
  const items: VerifiedFact[] = []

  for (const claim of claims.slice(0, 20)) {
    const claimPath = typeof claim.path === 'string' ? normalizePath(claim.path.trim()) : path
    const line = Number(claim.line)
    const quote = typeof claim.quote === 'string' ? claim.quote.trim() : ''
    const claimText = typeof claim.claim === 'string' ? claim.claim.trim() : ''

    let status: VerifiedFact['status'] = 'unverified'
    let reason = ''

    if (claimPath && claimPath !== path) {
      reason = '引用的是另一个文件，程序没有它的原文'
    } else if (!Number.isInteger(line) || line < 1 || line > lines.length) {
      reason = '行号不在当前文件里'
    } else if (!quote) {
      reason = '没有给引文'
    } else {
      const lineText = normalizeWhitespace(lines[line - 1])
      const needle = normalizeWhitespace(quote)
      const matched =
        needle.length >= 3 &&
        (lineText.includes(needle) || (lineText.length >= 3 && needle.includes(lineText)))
      if (matched) {
        status = 'verified'
      } else {
        reason = '引文和这一行对不上'
      }
    }

    items.push({
      path: claimPath || path,
      line: Number.isInteger(line) ? line : 0,
      quote,
      claim: claimText,
      status,
      reason: reason || undefined,
    })
  }

  const verified = items.filter((item) => item.status === 'verified').length

  return {
    verified,
    unverified: items.length - verified,
    items,
  }
}
