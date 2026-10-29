/**
 * 语言适配器共用的小工具。
 *
 * 只做路径、行数和「选当前文件相关事实」这些和语言无关的事；
 * 具体语法留在各自的适配器里。
 */
import type { HardFact, HardFactGraph, StructureSourceFile } from '~/types/structure'

export function normalizeStructurePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function lineCountOf(file: StructureSourceFile): number {
  return file.text.split(/\r?\n/).length
}

export function buildLineCounts(files: StructureSourceFile[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of files) counts[normalizeStructurePath(file.path)] = lineCountOf(file)
  return counts
}

/** 一个文件的事实：冲突 + 本文件事实 + 关联到本文件的事实，最多 10 条 */
export function selectGraphFacts(graph: HardFactGraph, path: string): HardFact[] {
  const normalized = normalizeStructurePath(path)
  const conflictIds = new Set(graph.conflicts.flatMap((conflict) => conflict.factIds))
  const conflicts = graph.facts.filter(
    (fact) => fact.kind === 'conflict' || conflictIds.has(fact.id),
  )
  const own = graph.facts.filter(
    (fact) =>
      fact.kind !== 'conflict' &&
      (normalizeStructurePath(fact.path) === normalized ||
        fact.relatedPaths?.some((related) => normalizeStructurePath(related) === normalized)),
  )

  const merged: HardFact[] = []
  const seen = new Set<string>()
  for (const fact of [...conflicts, ...own]) {
    if (seen.has(fact.id)) continue
    seen.add(fact.id)
    merged.push(fact)
  }
  return merged.slice(0, 10)
}
