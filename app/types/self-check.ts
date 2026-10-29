/**
 * 分批图自检的数据形状。
 *
 * 这里只描述「清单 / 批次 / 决定 / 账本」，不碰 DOM、网络或模型；
 * 具体解析、预算和合并都在 app/utils/self-check-* 里。
 */

export type SelfCheckItemKind = 'reversed' | 'unsupported' | 'unknown' | 'other'

export interface SelfCheckItem {
  /** 稳定 id，例如 E12；模型只按这个 id 回决定 */
  id: string
  /** 原始图 edges 数组的下标，合并时用 */
  edgeIndex: number
  from: string
  to: string
  label?: string
  kind: SelfCheckItemKind
  /** 程序预检给出的依据；给模型看 */
  detail: string
  /** 这条边所属的批号，1 起 */
  batch: number
}

export interface SelfCheckNodeSummary {
  id: string
  label: string
  type: string
}

/** 每批都会带的一份很短的全图摘要，不是完整图 JSON */
export interface SelfCheckOverview {
  groups: string[]
  nodes: number
  edges: number
  supported: number
  total: number
}

export interface SelfCheckBatch {
  index: number
  items: SelfCheckItem[]
  /** 这批涉及的分组 / 文件节点，只给摘要 */
  nodes: SelfCheckNodeSummary[]
  /** 这批涉及的端点文件路径，用于工具可读范围 */
  paths: string[]
  /** 需求分；预算按它加权 */
  score: number
  /** 程序分配的工具次数上限，0–6 */
  toolAllowance: number
}

export type SelfCheckAction = 'keep' | 'remove' | 'reverse' | 'relabel' | 'unknown'

export interface SelfCheckDecision {
  id: string
  action: SelfCheckAction
  label?: string
  reason?: string
  evidence?: string[]
}

export interface SelfCheckCoverage {
  total: number
  checked: number
  unknown: number
  conflict: number
  supported: number
}

export interface SelfCheckEvidence {
  id: string
  tool: string
  args: string
  /** 完整工具结果，供账本导出；不直接进 prompt */
  result: string
}

export interface SelfCheckBatchResult {
  decisions: SelfCheckDecision[]
  coverage: SelfCheckCoverage
  evidence: SelfCheckEvidence[]
  /** 模型实际用掉的 token；来自服务端 usage */
  usedTokens: number
  /** 执行的模型调用次数，仅用于报告 */
  modelCalls: number
  /** 实际工具调用次数 */
  toolCalls: number
  stopped: boolean
  error: string
}
