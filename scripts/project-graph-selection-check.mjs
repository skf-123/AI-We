/**
 * 项目图只按当前勾选保留文件的纯函数回归。
 *
 * 跑法：node --experimental-strip-types scripts/project-graph-selection-check.mjs
 * 不调用模型、不碰 DOM；只验 sanitizeProjectGraph 会不会放行未勾选的路径。
 */
import { sanitizeProjectGraph } from '../app/utils/project-graph.ts'

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

const raw = {
  nodes: [
    { id: 'a', label: 'A', type: 'code', files: [{ path: 'a.java', role: '入口' }] },
    { id: 'b', label: 'B', type: 'code', files: [{ path: 'b.java', role: '保存' }] },
    { id: 'c', label: 'C', type: 'code', files: [{ path: 'c.java', role: '未勾选' }] },
    { id: 'tech', label: 'SQL', type: 'tech' },
  ],
  edges: [
    { from: 'f:a.java', to: 'f:b.java', label: '调用' },
    { from: 'f:a.java', to: 'f:c.java', label: '调用' },
    { from: 'f:c.java', to: 'n:tech', label: 'SQL' },
    { from: 'n:a', to: 'n:tech', label: '依赖' },
  ],
}

const graph = sanitizeProjectGraph(raw, ['a.java', 'b.java'])

check('保留勾选文件的节点', graph?.nodes.find((node) => node.id === 'a')?.files?.map((file) => file.path), ['a.java'])
check('未勾选文件从节点里消失', graph?.nodes.find((node) => node.id === 'c')?.files, undefined)
check('只保留勾选文件之间的边', graph?.edges.map((edge) => `${edge.from}->${edge.to}`), ['f:a.java->f:b.java', 'n:a->n:tech'])
check('技术节点不受影响', graph?.nodes.some((node) => node.id === 'tech'), true)

const noneSelected = sanitizeProjectGraph(raw, [])
check(
  '一个都没勾时不保留文件端点',
  Boolean(
    noneSelected?.edges.some(
      (edge) => edge.from.startsWith('f:') || edge.to.startsWith('f:'),
    ),
  ),
  false,
)

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
