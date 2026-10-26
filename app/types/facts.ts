/** 逐文件输出里的跨文件事实块，以及程序核对后的结果。 */

export interface FactClaim {
  /** 引用的是哪个文件；省略时按当前文件处理 */
  path?: string
  /** 1 起 */
  line?: number
  /** 必须能在那一行里找到的原文 */
  quote?: string
  /** 这条事实在正文里断言了什么 */
  claim?: string
}

export interface VerifiedFact {
  path: string
  line: number
  quote: string
  claim: string
  /**
   * verified：引文在文件里能找到（可能修正了行号）
   * contradiction：claim 和程序事实直接矛盾
   * unverified：既没有对上引文，也没有程序事实依据
   */
  status: 'verified' | 'unverified' | 'contradiction'
  reason?: string
  /** 有程序事实依据时，指向那条事实的 id */
  factId?: string
  /** 矛盾时，程序事实说的是什么 */
  correct?: string
}

export interface FactCheck {
  verified: number
  unverified: number
  contradictions: number
  items: VerifiedFact[]
}

/** 按程序事实更正正文的一处记录 */
export interface FactFix {
  /** 正文里原来的名字 */
  from: string
  /** 事实图里的正确名字 */
  to: string
  /** 依据的事实所在文件与行 */
  path: string
  line: number
  /** 为什么更正 */
  reason: string
  /** 更正前后的上下文，给页面展开看 */
  before: string
  after: string
}
