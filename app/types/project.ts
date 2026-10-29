/**
 * 项目入口的数据形状 —— 单一来源。
 *
 * 与 analysis.ts 分开，是因为两者回答的问题不同：
 *   analysis.ts   贴一段代码：四段 + 一张图
 *   project.ts    整个项目：三类文件、目录树、逐文件状态、分组可展开的项目图
 *
 * 图数据里的「分组 + 文件 + 文件级边」是项目入口特有的：普通图只有节点和边，
 * 这里多一层「哪些文件属于哪个分组」，展开 / 收起就是在这层上做渲染变换。
 */

import type { GraphNodeType, RagSource } from './analysis'
import type { FactCheck, FactFix } from './facts'
import type { HardFact } from './structure'

/** 目录树上的三类标签 */
export type ProjectFileCategory = 'user' | 'config' | 'system'

/**
 * 更细的文件子类。
 * 三档 category 决定勾选与预算；subtype 只用于展示和原因文案，
 * 这样加分类不会牵连选择逻辑。
 */
export type ProjectFileSubtype =
  | 'source'
  | 'config'
  | 'vendor'
  | 'dependency'
  | 'build'
  | 'tooling'
  | 'minified'
  | 'source-map'
  | 'asset'
  | 'binary'
  | 'lockfile'
  | 'ide'
  | 'docs'
  | 'unknown'

/** 配置 / 系统文件在项目里的两种角色 */
export type ConfigMode = 'context' | 'explain'

/** 第三方库识别结果：高置信度会改默认勾选，中置信度只打标签 */
export interface VendorHint {
  /** 库名，例如 Bootstrap / jQuery */
  name: string
  confidence: 'high' | 'medium'
  /** 依据，例如「文件头是 Bootstrap v5.3.0」 */
  evidence: string
}

/**
 * 地图 Agent 给出的跨文件证据。
 *
 * note 指向 crossFileNotes 的第几条（1 起）；path / line / quote 指向真实文件里的那一行。
 * 进入逐文件请求前，前端会拿真实文件核对引文；核对不过的不会带进公共前缀。
 */
export interface CrossFileEvidence {
  /** crossFileNotes 里第几条（1 起） */
  note: number
  path: string
  /** 1 起行号 */
  line: number
  /** 原文行；核对后会替换成真实那一行 */
  quote: string
}

/** 逐文件解析状态 */
export type FileStatus = 'pending' | 'running' | 'done' | 'error'

/** 上传后登记的一个文件（不含内容，内容按需读） */
export interface ProjectFileEntry {
  /** 相对项目根的路径，统一用 / 分隔 */
  path: string
  name: string
  /** 字节数 */
  size: number
  category: ProjectFileCategory
  /** 更细的子类：展示与原因文案用，不参与勾选判断 */
  subtype: ProjectFileSubtype
  /** system 类文件为什么默认不勾；面向用户的说明 */
  skipReason?: string
  /** 语料未收录的语言：仍然解析，但四段里没有引用来源 */
  unrecorded: boolean
  /** 是否勾选（system 类默认不勾，但可以手动勾上） */
  include: boolean
  /** 配置文件：仅作上下文 / 仍需解释 */
  configMode: ConfigMode
  /** 系统文件：仅作上下文 / 仍需解释（二进制只能作上下文） */
  systemMode: ConfigMode
  /** 来自项目地图调用的一句话说明 */
  note?: string
  /** 程序识别出的第三方库（高置信度会同时把 category 改成 system） */
  vendor?: VendorHint
  /** Agent 的建议：只展示，用户点一下才取消勾选 */
  vendorSuggestion?: string
}

/** 目录树节点（每次 files 变化时由纯函数重算） */
export interface ProjectTreeNode {
  name: string
  path: string
  type: 'folder' | 'file'
  children?: ProjectTreeNode[]
  file?: ProjectFileEntry
  note?: string
  /** 文件夹：整棵子树的总大小与文件数；文件：自身大小 */
  size: number
  fileCount: number
  /** 子树里可勾选的文件数 / 已勾选数（用于 checked / indeterminate） */
  selectableCount: number
  selectedCount: number
}

/** Agent 轨迹的一步：模型真实发起的工具调用与工具结果 */
export interface AgentStep {
  round: number
  name: string
  args: string
  result: string
  /** 模型这一轮附带的文字说明；没有就不显示，不替它编 */
  note?: string
  /** 从完整工具结果算出的预览，例如「读取 80 行」 */
  summary?: string
}

/** 逐文件解析过程中，界面需要的状态 */
export interface FileProgress {
  status: FileStatus
  output: string
  sources: RagSource[]
  error: string
  /** 服务端截断过这个文件（超过 50000 字符） */
  truncated: boolean
  /** 模型输出撞到上限，后面的内容没有讲完 */
  outputTruncated: boolean
  /** 解析中的缓冲百分比；按时间走，不是真实进度 */
  percent: number
  /** 跨文件事实块经过程序核对后的结果 */
  facts?: FactCheck
  /** 事实块没闭合或不是合法 JSON */
  factsError?: string
  /** 程序从源码解析出的、与本文件相关的事实 */
  hardFacts?: HardFact[]
  /** 正文里和已核实事实矛盾的句子 */
  factWarnings?: string[]
  /** 已按程序事实更正的名字；原文和更正后都留着 */
  factFixes?: FactFix[]
  /** 没有对应 claim 的跨文件句子 */
  claimWarnings?: string[]
}

/** 项目图里的一个文件 */
export interface ProjectGraphFile {
  /** 必须与上传时的相对路径一致 */
  path: string
  /** 在分组里的角色，例如「总入口」「实现类」 */
  role?: string
}

/** 项目图节点：带 files 的是分组，不带的独立节点 */
export interface ProjectGraphNode {
  id: string
  label: string
  type: GraphNodeType
  detail?: string
  files?: ProjectGraphFile[]
}

/**
 * 项目图的边。
 * 端点写成 "n:<节点 id>" 或 "f:<文件相对路径>" —— 只存文件级关系，
 * 展开 / 收起时由前端换算，不存「展开版」和「收起版」两套边。
 */
export interface ProjectGraphEdge {
  from: string
  to: string
  label?: string
}

export interface ProjectGraphData {
  nodes: ProjectGraphNode[]
  edges: ProjectGraphEdge[]
}
