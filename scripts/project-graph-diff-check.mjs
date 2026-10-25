/**
 * 图差异纯函数的回归检查。
 *
 * 跑法：node --experimental-strip-types scripts/project-graph-diff-check.mjs
 *
 * 只测“改了什么”的计数，不评价改动对不对。
 */

import { diffProjectGraph } from '../app/utils/project-graph-diff.ts'

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

const base = {
  nodes: [
    { id: 'a', label: 'A', files: [{ path: 'x.js' }, { path: 'y.js' }] },
    { id: 'b', label: 'B', files: [{ path: 'z.js' }] },
  ],
  edges: [{ from: 'f:x.js', to: 'n:b', label: '调用' }],
}

check(
  'reordered is unchanged',
  [diffProjectGraph(base, {
    nodes: [
      { id: 'b', label: 'B', files: [{ path: 'z.js' }] },
      { id: 'a', label: 'A', files: [{ path: 'y.js' }, { path: 'x.js' }] },
    ],
    edges: [{ from: 'f:x.js', to: 'n:b', label: '调用' }],
  }).total],
  [0],
)

check(
  'edge relabeled',
  (() => {
    const d = diffProjectGraph(base, {
      ...base,
      edges: [{ from: 'f:x.js', to: 'n:b', label: '依赖' }],
    })
    return [d.changed, d.edgesRelabeled, d.edgesAdded, d.edgesRemoved]
  })(),
  [true, 1, 0, 0],
)

check(
  'edge added',
  (() => {
    const d = diffProjectGraph(base, {
      ...base,
      edges: [...base.edges, { from: 'f:y.js', to: 'n:b', label: '' }],
    })
    return [d.edgesAdded, d.edgesRemoved]
  })(),
  [1, 0],
)

check(
  'file moved',
  (() => {
    const d = diffProjectGraph(base, {
      nodes: [
        { id: 'a', label: 'A', files: [{ path: 'y.js' }] },
        { id: 'b', label: 'B', files: [{ path: 'z.js' }, { path: 'x.js' }] },
      ],
      edges: base.edges,
    })
    return [d.filesMoved, d.changed]
  })(),
  [1, true],
)

check(
  'node added',
  (() => {
    const d = diffProjectGraph(base, {
      ...base,
      nodes: [...base.nodes, { id: 'c', label: 'C' }],
    })
    return [d.nodesAdded, d.changed]
  })(),
  [1, true],
)

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}

console.log('\n全部通过')
