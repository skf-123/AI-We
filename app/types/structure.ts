/**
 * 项目结构事实：由程序解析源码得到，不经过模型。
 *
 * 这一层只回答「谁在哪个包、谁引了谁、配置扫的是哪个包」这类硬事实；
 * 它不认识页面、组件或请求，也不依赖 Java / JS 的具体语法 ——
 * 具体语言由 app/utils/structure/ 下的适配器提供。
 */

/** 一个可被结构层读取的文件；内容已经在内存里 */
export interface StructureSourceFile {
  path: string
  text: string
}

export type StructureProfile = 'java-spring' | 'unsupported'

export type HardFactKind =
  | 'package'
  | 'fqn'
  | 'import'
  | 'field-type'
  | 'annotation'
  | 'implements'
  | 'xml-namespace'
  | 'scan-package'
  | 'component-scan'
  | 'web-servlet'
  | 'conflict'

export interface HardFact {
  id: string
  kind: HardFactKind
  /** 这条事实属于哪个文件 */
  path: string
  /** 1 起 */
  line: number
  /** 原文那一行；核对时逐字用 */
  quote: string
  /** 给模型和页面看的一句话 */
  text: string
  /** 结构化字段：claim 核对的依据 */
  subject?: string
  predicate?: string
  object?: string
  /** 这条事实还涉及哪些文件；按文件选事实时用 */
  relatedPaths?: string[]
}

export interface StructureConflict {
  id: string
  kind: 'package-scan-namespace' | 'injection-package' | 'servlet-link' | 'other'
  /** 给模型和页面看的完整说明 */
  detail: string
  /** 组成这条矛盾的若干事实 */
  factIds: string[]
  /** 涉及的文件 */
  paths: string[]
}

export interface StructureSymbol {
  path: string
  /** 1 起 */
  line: number
  kind: 'class' | 'interface' | 'enum'
}

export interface HardFactGraph {
  profile: StructureProfile
  /** 参与解析的文件，路径统一用 / */
  files: string[]
  facts: HardFact[]
  conflicts: StructureConflict[]
  /** 全限定名 → 符号 */
  symbols: Record<string, StructureSymbol>
  /** 文件 → package */
  packages: Record<string, string>
  /** 文件 → 行数；正文里的行号引用核对用 */
  lineCounts: Record<string, number>
}

/**
 * 一种语言的适配器。
 *
 * 核心只认这个接口和 HardFactGraph，不认识具体语言；
 * 新增语言 = 新增一个适配器 + 它的测试，不改核心。
 */
export interface ProjectStructureAdapter {
  id: string
  detect(files: StructureSourceFile[]): boolean
  analyze(files: StructureSourceFile[]): HardFactGraph
  /** 选与当前文件相关的事实；由适配器决定优先级 */
  selectFacts(graph: HardFactGraph, path: string): HardFact[]
}
