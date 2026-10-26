/**
 * 结构事实层的唯一入口。
 *
 * 核心只调 analyzeProjectStructure(files)，拿到图或 null；
 * 不认识 Java / JS / Python，也不知道具体解析规则。
 * 新增语言 = 在这里注册一个适配器，核心不改。
 */
import type { HardFact, ProjectStructureAdapter, StructureSourceFile } from '~/types/structure'
import { javaSpringAdapter } from './java-spring'

const ADAPTERS: ProjectStructureAdapter[] = [javaSpringAdapter]

export interface ProjectStructureResult {
  /** 用于页面显示和调试；不含页面/组件引用 */
  adapterId: string
  /** 完整事实图：跨文件 claim 核对用，不直接进提示词 */
  allFacts: HardFact[]
  /** 每个文件选事实；没有图就返回空数组 */
  selectFacts(path: string): HardFact[]
  /** 给页面显示「核实到什么程度」 */
  profile: string
}

/**
 * 是否启用结构事实。
 *
 * 默认开；地址栏加 `?facts=off` 可以关掉，用同一份项目做开/关对比。
 * 关掉时 useProjectSession 不建图，逐文件请求不带 verifiedFacts，行为和接入前一致。
 */
export function structureFactsEnabled(): boolean {
  if (typeof window === 'undefined') return true
  return new URLSearchParams(window.location.search).get('facts') !== 'off'
}

export function analyzeProjectStructure(files: StructureSourceFile[]): ProjectStructureResult | null {
  if (files.length === 0) return null
  const adapter = ADAPTERS.find((item) => item.detect(files))
  if (!adapter) return null

  const graph = adapter.analyze(files)
  return {
    adapterId: adapter.id,
    profile: graph.profile,
    allFacts: graph.facts,
    selectFacts(path: string) {
      return adapter.selectFacts(graph, path)
    },
  }
}
