/**
 * 候选边与图对照的回归检查。
 *
 * 跑法：node --experimental-strip-types scripts/project-candidate-edges-check.mjs
 */

import { scanCandidateEdges } from '../app/utils/project-candidate-edges.ts'
import { compareGraphToCandidates } from '../app/utils/project-graph-candidates.ts'

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

function edgeKeys(scan) {
  return scan.edges.map((edge) => `${edge.from} -> ${edge.to}`).sort()
}

const javaFiles = [
  {
    path: 'project/src/main/java/com/xz/controller/ArticleController.java',
    text: 'package com.xz.controller;\nimport com.xz.service.ArticleService;\n@RestController\nclass ArticleController {}',
  },
  {
    path: 'project/src/main/java/com/xz/service/ArticleService.java',
    text: 'package com.xz.service;\ninterface ArticleService {}',
  },
  {
    path: 'project/src/main/java/com/xz/controller/OtherController.java',
    text: 'package com.xz.controller;\nimport com.xz.service.*;\nclass OtherController {}',
  },
]
const java = scanCandidateEdges(javaFiles)
check('java import resolves to file', edgeKeys(java), [
  'project/src/main/java/com/xz/controller/ArticleController.java -> project/src/main/java/com/xz/service/ArticleService.java',
])
check('java wildcard is unresolved', java.unresolved.length, 1)

const jsFiles = [
  {
    path: 'project/blog/src/pages/Home.vue',
    text: '<template><div /></template>\n<script>\nimport { articleList } from \'../api/article\'\n</script>',
  },
  {
    path: 'project/blog/src/api/article.js',
    text: "import request from '@/utils/request'\nexport function articleList() { return request() }",
  },
  {
    path: 'project/blog/src/utils/request.js',
    text: 'export default function request() {}',
  },
  {
    path: 'project/blog/src/pages/Other.vue',
    text: '<template><div /></template>\n<script>\nexport default {}\n</script>',
  },
  {
    path: 'project/blog/src/pages/Float.vue',
    text: '<template><div /></template>\n<script>\nexport default {}\n</script>',
  },
  {
    path: 'project/admin/src/utils/request.js',
    text: 'export default function request() {}',
  },
]
const js = scanCandidateEdges(jsFiles)
check('js relative and alias resolve', edgeKeys(js), [
  'project/blog/src/api/article.js -> project/blog/src/utils/request.js',
  'project/blog/src/pages/Home.vue -> project/blog/src/api/article.js',
])

const graph = {
  nodes: [
    {
      id: 'pages',
      label: '页面',
      files: [{ path: 'project/blog/src/pages/Home.vue' }],
    },
    {
      id: 'api',
      label: 'API',
      files: [{ path: 'project/blog/src/api/article.js' }],
    },
    {
      id: 'other',
      label: '另一页',
      files: [{ path: 'project/blog/src/pages/Other.vue' }],
    },
    {
      id: 'float',
      label: '浮着的页面',
      files: [{ path: 'project/blog/src/pages/Float.vue' }],
    },
    {
      id: 'tech',
      label: '技术',
    },
  ],
  edges: [
    { from: 'n:pages', to: 'n:api', label: '调用' },
    { from: 'n:api', to: 'n:pages', label: '反向' },
    { from: 'n:pages', to: 'n:other', label: '不存在的关系' },
    { from: 'n:pages', to: 'n:tech', label: '依赖' },
  ],
}

const report = compareGraphToCandidates(graph, js)
check('supported edge', report.supported, 1)
check('unknown edge (node without files)', report.unknown, 1)
check('suspicion count', report.suspicions.length, 4)
check('suspicion kinds', report.suspicions.map((item) => item.kind).sort(), [
  'floating',
  'group-only',
  'reversed',
  'unsupported',
])

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}

console.log('\n全部通过')
