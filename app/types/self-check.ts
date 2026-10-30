/**
 * 分批图自检的数据形状。
 *
 * 这里只描述「清单 / 批次 / 决定 / 账本」，不碰 DOM、网络或模型；
 * 具体解析、预算和合并都在 app/utils/self-check-* 里。
 */

export type SelfCheckItemKind =
  | 'reversed'
  | 'unsupported'
  | 'inferred'
  | 'partial'
  | 'unknown'
  | 'other'
  | 'floating'
  | 'group-only'
  /** 源码里有 import，图上没有对应的边 */
  | 'missing-edge'
  | 'unowned'
  | 'duplicate'
  /** 节点本身有问题：名称不清、类型不合法、代码分组没有文件 */
  | 'node'

export interface SelfCheckItem {
  /** 稳定 id，例如 E12；模型只按这个 id 回决定 */
  id: string
  /** 原始图 edges 数组的下标；结构项是 -1 */
  edgeIndex: number
  from: string
  to: string
  label?: string
  kind: SelfCheckItemKind
  /** 程序预检给出的依据；给模型看 */
  detail: string
  /** 这条边 / 结构项所属的批号，1 起 */
  batch: number
  /** 分组边可拆的文件对 */
  pairs?: { from: string; to: string }[]
  /** 浮节点 / 未归属 / 重复归属涉及的文件 */
  paths?: string[]
  /** 结构项可选择的已有节点；给模型一个明确的目标范围 */
  candidates?: { id: string; label: string; type: string }[]
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
  floating: number
  groupOnly: number
  unowned: number
  duplicate: number
  /** 程序看出名称 / 类型 / 空代码分组的节点数 */
  nodeIssues: number
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
  /** 越小越先跑：0 关键边，1 重要结构项，2 普通边，3 未归属 */
  rank: number
  /** 边批次还是结构项批次；结构项有单独的预算上限 */
  category: 'edge' | 'structural'
}

export type SelfCheckAction =
  | 'keep'
  | 'remove'
  | 'reverse'
  | 'relabel'
  | 'unknown'
  | 'connect'
  | 'split'
  | 'move-file'
  | 'add-node'
  | 'remove-node'
  | 'rename-node'
  | 'update-node'

export interface SelfCheckDecision {
  id: string
  action: SelfCheckAction
  label?: string
  reason?: string
  evidence?: string[]
  /** connect 的目标端点 */
  to?: string
  /** move-file 的文件路径 */
  path?: string
  /** move-file / add-node 的目标节点 */
  toNode?: string
  /** split 要保留的文件对 */
  pairs?: { from: string; to: string }[]
  /** add-node 的新节点 */
  node?: {
    id: string
    label: string
    type?: string
    files?: string[]
  }
  /** remove-node / rename-node / update-node 的目标节点 */
  nodeId?: string
  /** remove-node 时把节点里的文件移到这个节点 */
  moveFilesTo?: string
  /** update-node 要改成的类型；只能是 code / tech / concept */
  type?: string
  /** update-node 要改成的说明 */
  detail?: string
}

export interface SelfCheckCoverage {
  total: number
  checked: number
  unknown: number
  conflict: number
  supported: number
  /** 程序检查项；只计入实际存在问题的情况 */
  floating?: number
  groupOnly?: number
  unowned?: number
  duplicate?: number
  /** 结构项数量 / 已处理数量；不计入边的 checked */
  structural?: number
  structuralChecked?: number
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
  /** 补证据包覆盖的边数；0 表示这一步没跑或没有可补的边 */
  evidencePacks?: number
  stopped: boolean
  error: string
}
