/**
 * 多语言适配器的合并层。
 *
 * 每个适配器只认识自己的语言；这里只把 HardFactGraph 去重合并，
 * 不写任何语言规则。
 */
import type { HardFact, HardFactGraph, StructureProfile } from '~/types/structure'

export interface AdapterRun {
  id: string
  profile: StructureProfile
  graph: HardFactGraph
  select(path: string): HardFact[]
}

export function mergeAdapterRuns(runs: AdapterRun[]): HardFactGraph {
  const facts: HardFact[] = []
  const seenFacts = new Set<string>()
  const conflicts = []
  const seenConflicts = new Set<string>()
  const symbols: HardFactGraph['symbols'] = {}
  const packages: Record<string, string> = {}
  const lineCounts: Record<string, number> = {}
  const files = new Set<string>()

  for (const run of runs) {
    for (const path of run.graph.files) files.add(path)
    for (const fact of run.graph.facts) {
      if (seenFacts.has(fact.id)) continue
      seenFacts.add(fact.id)
      facts.push(fact)
    }
    for (const conflict of run.graph.conflicts) {
      if (seenConflicts.has(conflict.id)) continue
      seenConflicts.add(conflict.id)
      conflicts.push(conflict)
    }
    Object.assign(symbols, run.graph.symbols)
    Object.assign(packages, run.graph.packages)
    Object.assign(lineCounts, run.graph.lineCounts)
  }

  const profile: StructureProfile =
    runs.length === 1 ? runs[0]!.profile : runs.length > 1 ? 'mixed' : 'unsupported'

  return {
    profile,
    files: [...files],
    facts,
    conflicts,
    symbols,
    packages,
    lineCounts,
  }
}

export function selectMergedFacts(runs: AdapterRun[], path: string): HardFact[] {
  const merged: HardFact[] = []
  const seen = new Set<string>()
  for (const run of runs) {
    for (const fact of run.select(path)) {
      if (seen.has(fact.id)) continue
      seen.add(fact.id)
      merged.push(fact)
    }
  }
  return merged.slice(0, 10)
}
