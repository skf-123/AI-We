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
  status: 'verified' | 'unverified'
  reason?: string
}

export interface FactCheck {
  verified: number
  unverified: number
  items: VerifiedFact[]
}
