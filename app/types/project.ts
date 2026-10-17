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

/** 目录树上的三类标签 */
export type ProjectFileCategory = 'user' | 'config' | 'system'

/** 配置文件在项目里的两种角色 */
export type ConfigMode = 'context' | 'explain'

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
  /** system 类文件为什么被跳过；面向用户的说明 */
  skipReason?: string
  /** 语料未收录的语言：仍然解析，但四段里没有引用来源 */
  unrecorded: boolean
  /** 是否勾选（system 类恒为 false） */
  include: boolean
  /** 配置文件：仅作上下文 / 仍需解释 */
  configMode: ConfigMode
  /** 来自项目地图调用的一句话说明 */
  note?: string
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

/** 逐文件解析过程中，界面需要的状态 */
export interface FileProgress {
  status: FileStatus
  output: string
  sources: RagSource[]
  error: string
  /** 服务端截断过这个文件（超过 50000 字符） */
  truncated: boolean
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
