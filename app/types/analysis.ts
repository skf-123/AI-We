/**
 * 跨组件共享的数据形状 —— 单一来源。
 *
 * 这些形状原先在多个文件里各写了一份：
 *   · RagSource  —— index.vue 与 SourceList.vue 各一份
 *   · 图数据结构 —— index.vue 与 GraphView.vue 各一份
 * 重复定义的问题是**改一处漏一处**：给某个字段改名时，编译器只会在
 * 用了旧名字的那几处报错，而"另一处的同名定义"会静静地留着不动。
 * 收敛到这里之后，只有这一份。
 *
 * ⚠️ 图数据的三种节点类型必须与 server/utils/prompt.ts 里给模型的约定一致，
 *    改这里就要同步改提示词。
 */

/** 引用来源：服务端检索完就定下来的事实，走 X-Rag-Sources 响应头传给前端 */
export interface RagSource {
  id: string
  title: string
  label: string
  url: string
  score: number
}

/** 知识框架图的节点类型（代码 / 技术 / 概念），与提示词里的 "type" 取值一一对应 */
export type GraphNodeType = 'code' | 'tech' | 'concept'

export interface GraphNode {
  id: string
  label: string
  type: GraphNodeType
  detail?: string
}

export interface GraphEdge {
  from: string
  to: string
  label?: string
}

/** 模型在第五段吐出的图数据，解析成功后交给 GraphView 渲染 */
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/**
 * 术语词条（数据在 app/data/glossary.json）。
 *
 * 这份词表**只给前端**用：把正文里的术语渲染成可点击的小块。
 * 它刻意**不放进 server/rag/corpus.json** —— corpus 是给向量检索用的，
 * 混进去会被当成检索候选、可能挤掉本该命中的段落，而且改它必须重跑
 * `npm run rag:build` 重新校准阈值。
 */
export interface GlossaryTerm {
  /** 匹配用的主词形，例如 "PEP" */
  term: string
  /** 别名（同样会被匹配），例如 ["PEP 318", "PEP 498"] */
  aliases?: string[]
  /** 一两句大白话解释 */
  short: string
  /** 官方出处 */
  source: { label: string; url: string }
}
