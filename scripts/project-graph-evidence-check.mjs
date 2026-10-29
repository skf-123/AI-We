/**
 * 项目图证据、文件对和完整性检查。
 *
 * 跑法：node --experimental-strip-types scripts/project-graph-evidence-check.mjs
 */
import { attachGraphEvidence } from '../app/utils/project-graph-evidence.ts'
import { attachGraphIntegrity } from '../app/utils/project-graph-integrity.ts'

let failed = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`ok ${name}`)
    return
  }
  failed++
  console.error(`FAIL ${name}\n  actual:   ${a}\n  expected: ${e}`)
}

const graph = {
  nodes: [
    { id: 'a', label: 'A', type: 'code', files: [{ path: 'a1.js' }, { path: 'a2.js' }] },
    { id: 'b', label: 'B', type: 'code', files: [{ path: 'b1.js' }, { path: 'b2.js' }] },
    { id: 'c', label: 'C', type: 'code', files: [{ path: 'c1.js' }] },
    { id: 'd', label: 'D', type: 'code', files: [{ path: 'd1.js' }] },
    { id: 'float', label: 'Float', type: 'code', files: [{ path: 'f1.js' }] },
    { id: 'dup', label: 'Dup', type: 'code', files: [{ path: 'a1.js' }] },
  ],
  edges: [
    { from: 'n:a', to: 'n:b', label: '调用' },
    { from: 'n:c', to: 'n:d', label: '依赖' },
  ],
}

const facts = [
  {
    id: 'import:a1:b1',
    kind: 'import',
    path: 'a1.js',
    line: 2,
    quote: "import b from './b1'",
    text: 'a1.js:2 import b from ./b1',
    object: 'b',
    relatedPaths: ['a1.js', 'b1.js'],
  },
  {
    id: 'field:c1:d1',
    kind: 'field-type',
    path: 'c1.js',
    line: 4,
    quote: 'const d = useD()',
    text: 'c1.js:4 d : d1',
    object: 'd1',
    relatedPaths: ['c1.js', 'd1.js'],
  },
]

const withEvidence = attachGraphEvidence(graph, facts)
const groupEdge = withEvidence.edges.find((edge) => edge.label === '调用')
check('multi group edge stays group', groupEdge.from, 'n:a')
check('multi group edge records file pairs', groupEdge.filePairs?.length, 1)
check('multi group edge is partial', groupEdge.confidence, 'partial')
check('file pair has import evidence', groupEdge.filePairs?.[0]?.evidence[0]?.basis, 'import')

const expanded = withEvidence.edges.find((edge) => edge.label === '依赖')
check('unique group edge expands from', expanded.from, 'f:c1.js')
check('unique group edge expands to', expanded.to, 'f:d1.js')
check('unique group edge verified', expanded.confidence, 'verified')

const enriched = attachGraphIntegrity(withEvidence, ['a1.js', 'a2.js', 'b1.js', 'b2.js', 'c1.js', 'd1.js', 'f1.js', 'missing.js'])
check('unowned file found', enriched.unownedFiles, ['missing.js'])
check('duplicate file found', enriched.duplicateFiles, [{ path: 'a1.js', nodes: ['a', 'dup'] }])
check('floating node marked', enriched.nodes.find((node) => node.id === 'float')?.floating, true)
check('connected node not floating', enriched.nodes.find((node) => node.id === 'a')?.floating, false)

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
