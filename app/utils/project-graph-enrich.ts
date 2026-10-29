/**
 * 项目图的统一加工入口：先挂事实依据，再检查完整性。
 *
 * 已经挂过依据的图（例如自检合并后的图）不重复挂，避免把 evidence 覆盖掉；
 * 没有事实时只做完整性检查，保持 facts=off 的旧行为。
 */
import type { HardFact, HardFactGraph } from '~/types/structure'
import type { ProjectGraphData } from '~/types/project'
import { attachGraphEvidence } from './project-graph-evidence.ts'
import { attachGraphIntegrity } from './project-graph-integrity.ts'

export function enrichProjectGraph(
  graph: ProjectGraphData,
  facts: HardFact[] = [],
  symbols: HardFactGraph['symbols'] = {},
  knownPaths: string[] = [],
): ProjectGraphData {
  const hasEvidence = graph.edges.some((edge) => edge.evidence || edge.confidence)
  const withEvidence = hasEvidence ? graph : attachGraphEvidence(graph, facts, symbols)
  return attachGraphIntegrity(withEvidence, knownPaths)
}
