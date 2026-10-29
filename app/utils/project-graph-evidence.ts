/**
 * 给项目图的边挂程序事实。
 *
 * 只读 HardFactGraph，不调模型：import、注入、namespace、组件使用、
 * SQL 外键、CSS import 能对上就挂依据；对不上标推断。
 * 分组边如果唯一落到一对文件，就展开成文件边；多对保留分组边并列出文件对。
 */
import type { HardFact, HardFactGraph } from '~/types/structure'
import type {
  ProjectGraphData,
  ProjectGraphEdge,
  ProjectGraphEvidence,
  ProjectGraphEvidenceBasis,
  ProjectGraphFilePair,
} from '~/types/project'
import { normalizeStructurePath } from './structure/common.ts'

type SymbolTable = HardFactGraph['symbols']

function filesOf(endpoint: string, graph: ProjectGraphData): string[] {
  if (endpoint.startsWith('f:')) return [normalizeStructurePath(endpoint.slice(2))]
  if (endpoint.startsWith('n:')) {
    const node = graph.nodes.find((item) => item.id === endpoint.slice(2))
    return node?.files?.map((file) => normalizeStructurePath(file.path)) ?? []
  }
  return []
}

function basisOf(fact: HardFact): ProjectGraphEvidenceBasis | null {
  if (fact.kind === 'import') return 'import'
  if (fact.kind === 'field-type') return 'injection'
  if (fact.kind === 'xml-namespace') return 'xml-namespace'
  if (fact.kind === 'component-use') return 'component-use'
  if (fact.kind === 'foreign-key') return 'sql-foreign-key'
  if (fact.kind === 'css-import') return 'css-import'
  return null
}

/** 事实的另一端文件；import 用 relatedPaths，namespace / 外键用符号表落到文件 */
function targetsOf(fact: HardFact, symbols: SymbolTable): string[] {
  const targets = new Set<string>()
  for (const path of fact.relatedPaths ?? []) {
    if (normalizeStructurePath(path) !== normalizeStructurePath(fact.path)) {
      targets.add(normalizeStructurePath(path))
    }
  }
  if ((fact.kind === 'xml-namespace' || fact.kind === 'foreign-key') && fact.object) {
    const symbol = symbols[fact.object]
    if (symbol) targets.add(normalizeStructurePath(symbol.path))
  }
  return [...targets]
}

function evidenceOf(fact: HardFact, basis: ProjectGraphEvidenceBasis): ProjectGraphEvidence {
  return {
    basis,
    path: normalizeStructurePath(fact.path),
    line: fact.line,
    text: fact.text,
  }
}

function uniqueEvidence(items: ProjectGraphEvidence[]): ProjectGraphEvidence[] {
  const seen = new Set<string>()
  const result: ProjectGraphEvidence[] = []
  for (const item of items) {
    const key = `${item.basis}:${item.path}:${item.line}:${item.text}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

interface PairResult {
  pairs: ProjectGraphFilePair[]
  reverse: boolean
}

function collectPairs(
  fromFiles: string[],
  toFiles: string[],
  factsByPath: Map<string, HardFact[]>,
  symbols: SymbolTable,
): PairResult {
  const forward: ProjectGraphFilePair[] = []
  const backward: ProjectGraphFilePair[] = []

  for (const from of fromFiles) {
    for (const to of toFiles) {
      const forwardEvidence: ProjectGraphEvidence[] = []
      const backwardEvidence: ProjectGraphEvidence[] = []
      const facts = [...(factsByPath.get(from) ?? []), ...(factsByPath.get(to) ?? [])]
      for (const fact of facts) {
        const basis = basisOf(fact)
        if (!basis) continue
        const factPath = normalizeStructurePath(fact.path)
        const targets = targetsOf(fact, symbols)
        if (factPath === from && targets.includes(to)) {
          forwardEvidence.push(evidenceOf(fact, basis))
        }
        if (factPath === to && targets.includes(from)) {
          backwardEvidence.push(evidenceOf(fact, basis))
        }
      }
      if (forwardEvidence.length) {
        forward.push({ from, to, evidence: uniqueEvidence(forwardEvidence) })
      } else if (backwardEvidence.length) {
        backward.push({ from, to, evidence: uniqueEvidence(backwardEvidence) })
      }
    }
  }

  return { pairs: forward.length ? forward : backward, reverse: !forward.length && backward.length > 0 }
}

export function attachGraphEvidence(
  graph: ProjectGraphData,
  facts: HardFact[],
  symbols: SymbolTable = {},
): ProjectGraphData {
  if (facts.length === 0) return graph

  const factsByPath = new Map<string, HardFact[]>()
  for (const fact of facts) {
    const path = normalizeStructurePath(fact.path)
    const list = factsByPath.get(path) ?? []
    list.push(fact)
    factsByPath.set(path, list)
  }

  const edges = graph.edges.map((edge) => {
    const fromFiles = filesOf(edge.from, graph)
    const toFiles = filesOf(edge.to, graph)
    if (fromFiles.length === 0 || toFiles.length === 0) {
      return { ...edge, confidence: edge.confidence ?? ('inferred' as const) }
    }

    const { pairs, reverse } = collectPairs(fromFiles, toFiles, factsByPath, symbols)
    const evidence = uniqueEvidence(pairs.flatMap((pair) => pair.evidence))
    const totalPairs = fromFiles.length * toFiles.length
    const confidence: ProjectGraphEdge['confidence'] =
      evidence.length === 0 ? 'inferred' : pairs.length === totalPairs ? 'verified' : 'partial'

    const next: ProjectGraphEdge = {
      ...edge,
      evidence: evidence.length ? evidence : undefined,
      confidence,
    }

    if (reverse) {
      next.note = '程序事实的方向和图上的边相反'
    }

    if (pairs.length) {
      // 两端都是只有一个文件的分组，且事实唯一：直接落到文件边
      if (
        edge.from.startsWith('n:') &&
        edge.to.startsWith('n:') &&
        fromFiles.length === 1 &&
        toFiles.length === 1 &&
        pairs.length === 1
      ) {
        next.from = `f:${pairs[0]!.from}`
        next.to = `f:${pairs[0]!.to}`
        next.note = undefined
      } else if (edge.from.startsWith('n:') || edge.to.startsWith('n:')) {
        next.filePairs = pairs
        next.note = `分组关系，涉及 ${pairs.length} 对文件`
      }
    } else if (edge.from.startsWith('n:') && edge.to.startsWith('n:')) {
      next.note = '分组关系，未找到文件级依据'
    }

    return next
  })

  return { ...graph, edges }
}
