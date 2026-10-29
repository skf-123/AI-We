/**
 * 语言适配器与多语言合并检查。
 *
 * 跑法：node --experimental-strip-types scripts/project-language-adapters-check.mjs
 */
import { analyzeProjectStructure, structureProfileLabel } from '../app/utils/structure/index.ts'

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

const files = [
  {
    path: 'src/main.ts',
    text: "import { add } from './util'\nexport const result = add(1, 2)\n",
  },
  {
    path: 'src/util.ts',
    text: 'export function add(a: number, b: number) { return a + b }\n',
  },
  {
    path: 'src/Button.tsx',
    text: 'export function Button() { return <button /> }\n',
  },
  {
    path: 'src/App.tsx',
    text: "import { Button } from './Button'\nexport function App() { return <Button /> }\n",
  },
  {
    path: 'src/Hello.vue',
    text: '<template><Child /></template>\n<script setup>\nimport Child from "./Child.vue"\nconst props = defineProps(["name"])\n</script>\n',
  },
  {
    path: 'src/Child.vue',
    text: '<template><span>{{ name }}</span></template>\n<script setup>\ndefineProps(["name"])\n</script>\n',
  },
  {
    path: 'pkg/a.py',
    text: 'from .b import helper\n',
  },
  {
    path: 'pkg/b.py',
    text: 'def helper():\n    return 1\n',
  },
  {
    path: 'db/schema.sql',
    text: 'CREATE TABLE users (\n  id INT PRIMARY KEY,\n  team_id INT REFERENCES teams(id)\n);\n',
  },
  {
    path: 'web/base.css',
    text: '@import "./reset.css";\n.card {\n  color: red;\n}\n',
  },
  {
    path: 'web/reset.css',
    text: '* { margin: 0; }\n',
  },
]

const structure = analyzeProjectStructure(files)
check('adapter detected', Boolean(structure), true)
check('profile is mixed', structure?.profile, 'mixed')
check('adapter ids include languages', structure?.adapterId, 'js-ts+react+vue+python+sql+css')
check('profile label', structureProfileLabel('mixed'), '多语言')

const facts = structure?.allFacts ?? []
const has = (kind, object) => facts.some((fact) => fact.kind === kind && fact.object === object)
check('js import fact', has('import', 'add'), true)
check('js symbol fact', has('symbol', 'add'), true)
check('react component fact', has('component', 'Button'), true)
check('react component use fact', has('component-use', 'Button'), true)
check('vue component fact', has('component', 'Hello'), true)
check('vue component use fact', has('component-use', 'Child'), true)
check('python import fact', has('import', 'helper'), true)
check('python symbol fact', has('symbol', 'helper'), true)
check('sql table fact', has('table', 'users'), true)
check('sql column fact', has('column', 'team_id'), true)
check('sql foreign key fact', has('foreign-key', 'teams'), true)
check('css import fact', has('css-import', './reset.css'), true)
check('css selector fact', has('css-selector', '.card'), true)

check('line count js', structure?.lineCounts['src/main.ts'], 3)
check('line count python', structure?.lineCounts['pkg/a.py'], 2)

const jsFacts = structure?.selectFacts('src/main.ts') ?? []
check('select js facts', jsFacts.some((fact) => fact.kind === 'import'), true)
const sqlFacts = structure?.selectFacts('db/schema.sql') ?? []
check('select sql facts', sqlFacts.some((fact) => fact.kind === 'table'), true)

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
