/**
 * 结构事实层的唯一入口。
 *
 * 核心只调 analyzeProjectStructure(files)，拿到图或 null；
 * 不认识 Java / JS / Python，也不知道具体解析规则。
 * 新增语言 = 在这里注册一个适配器，核心不改。
 */
import type { HardFact, ProjectStructureAdapter, StructureSourceFile } from '~/types/structure'
import { javaSpringAdapter } from './java-spring.ts'
import { jsTsAdapter, reactAdapter } from './js-ts.ts'
import { vueAdapter } from './vue.ts'
import { pythonAdapter } from './python.ts'
import { sqlAdapter } from './sql.ts'
import { cssAdapter } from './css.ts'
import { mergeAdapterRuns, selectMergedFacts, type AdapterRun } from './multi.ts'

const ADAPTERS: ProjectStructureAdapter[] = [
  javaSpringAdapter,
  jsTsAdapter,
  reactAdapter,
  vueAdapter,
  pythonAdapter,
  sqlAdapter,
  cssAdapter,
]

const PROFILE_LABELS: Record<string, string> = {
  'java-spring': 'Java / Spring / MyBatis',
  'js-ts': 'JavaScript / TypeScript',
  react: 'React',
  vue: 'Vue',
  python: 'Python',
  sql: 'SQL',
  css: 'CSS',
  mixed: '多语言',
  unsupported: '未识别',
}

export function structureProfileLabel(profile: string): string {
  return PROFILE_LABELS[profile] ?? profile
}

export interface ProjectStructureResult {
  /** 用于页面显示和调试；不含页面/组件引用 */
  adapterId: string
  /** 完整事实图：跨文件 claim 核对用，不直接进提示词 */
  allFacts: HardFact[]
  /** 文件 → 行数；正文行号引用核对用 */
  lineCounts: Record<string, number>
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
  const runs: AdapterRun[] = ADAPTERS.filter((adapter) => adapter.detect(files)).map((adapter) => {
    const graph = adapter.analyze(files)
    return {
      id: adapter.id,
      profile: graph.profile,
      graph,
      select: (path: string) => adapter.selectFacts(graph, path),
    }
  })
  if (runs.length === 0) return null

  const graph = mergeAdapterRuns(runs)
  return {
    adapterId: runs.map((run) => run.id).join('+'),
    profile: graph.profile,
    allFacts: graph.facts,
    lineCounts: graph.lineCounts,
    selectFacts(path: string) {
      return selectMergedFacts(runs, path)
    },
  }
}
