/**
 * demo15 两轮记录 + 结构事实的组合回归。
 *
 * 跑法：node --experimental-strip-types scripts/project-demo15-claims-check.mjs
 * 依赖：../我们的交互/项目测试/sportboot测试/demo15
 *       ../我们的交互/ai制定的/sportboot-demo15-逐文件事实块效果-2026-10-26-第1/2轮原始数据.json
 *
 * 它检查三件事：
 *   1. 记录里的事实块 claim 现在能核到什么程度；
 *   2. 行号偏 1~3 行的正确 claim 会被修正，不再误报；
 *   3. 正文里那几条已知的跨文件错句会被标出来，而正确的句子不会被误伤。
 */
import fs from 'node:fs'
import path from 'node:path'
import { javaSpringAdapter } from '../app/utils/structure/java-spring.ts'
import { applyFactFixes, findBodyFactConflicts, verifyFacts } from '../app/utils/project-facts.ts'

const BASE = path.resolve(import.meta.dirname, '../..')
const ROOT = path.join(BASE, '我们的交互/项目测试/sportboot测试/demo15')
const RECORDS = path.join(BASE, '我们的交互/ai制定的')

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

const rels = [
  'pom.xml',
  'src/main/java/com/mapper/BookMapper.java',
  'src/main/java/com/config/MyBatisConfig.java',
  'src/main/java/com/config/JdbcConfig.java',
  'src/main/java/com/config/SpringConfig.java',
  'src/main/java/com/config/SpringMvcConfig.java',
  'src/main/java/com/service/impl/BookServiceImpl.java',
  'src/main/java/com/controller/BookController.java',
  'src/main/java/com/example/demo15/HelloServlet.java',
  'src/main/resources/com/mapper/BookMapper.xml',
  'src/main/resources/application-mapper.xml',
  'src/main/webapp/index.jsp',
  'src/test/java/com/test/BookTest.java',
]
const files = rels.map((rel) => ({ path: rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }))
const graph = javaSpringAdapter.analyze(files)

function loadRound(round) {
  const file = path.join(
    RECORDS,
    `sportboot-demo15-逐文件事实块效果-2026-10-26-第${round}轮原始数据.json`,
  )
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function summarize(run) {
  let total = 0
  let verified = 0
  let unverified = 0
  let contradictions = 0
  const contradictionPaths = []
  for (const analysis of run.analyses) {
    if (!analysis.claims?.length) continue
    const text = fs.readFileSync(path.join(ROOT, analysis.path), 'utf8')
    const result = verifyFacts(analysis.claims, analysis.path, text, graph.facts)
    total += analysis.claims.length
    verified += result.verified
    unverified += result.unverified
    contradictions += result.contradictions
    if (result.contradictions > 0) contradictionPaths.push(analysis.path)
  }
  return { total, verified, unverified, contradictions, contradictionPaths }
}

const round1 = summarize(loadRound(1))
const round2 = summarize(loadRound(2))

check('round 1 claim counts', [round1.total, round1.verified, round1.unverified, round1.contradictions], [24, 24, 0, 0])
check('round 2 claim counts', [round2.total, round2.verified, round2.unverified, round2.contradictions], [30, 29, 0, 1])
check('round 2 contradiction is index.jsp', round2.contradictionPaths, ['src/main/webapp/index.jsp'])

function warnings(round, suffix) {
  const run = round === 1 ? loadRound(1) : loadRound(2)
  const analysis = run.analyses.find((item) => item.path.endsWith(suffix))
  if (!analysis) return null
  const facts = javaSpringAdapter.selectFacts(graph, analysis.path)
  return findBodyFactConflicts(analysis.body, facts)
}

check('round 1 BookController warning', warnings(1, 'BookController.java')?.length, 1)
check('round 1 BookMapper warning', warnings(1, 'BookMapper.java')?.length, 1)
check('round 1 MyBatisConfig clean', warnings(1, 'MyBatisConfig.java')?.length, 0)
check('round 1 BookServiceImpl clean', warnings(1, 'BookServiceImpl.java')?.length, 0)
check('round 1 index.jsp clean', warnings(1, 'index.jsp')?.length, 0)
check('round 2 BookController warning', warnings(2, 'BookController.java')?.length, 1)
check('round 2 MyBatisConfig warning', warnings(2, 'MyBatisConfig.java')?.length, 1)
check('round 2 index.jsp warning', warnings(2, 'index.jsp')?.length, 1)
check('round 2 BookMapper clean', warnings(2, 'BookMapper.java')?.length, 0)
check('round 2 BookServiceImpl clean', warnings(2, 'BookServiceImpl.java')?.length, 0)

function fixedBody(round, suffix) {
  const run = round === 1 ? loadRound(1) : loadRound(2)
  const analysis = run.analyses.find((item) => item.path.endsWith(suffix))
  if (!analysis) return null
  const facts = javaSpringAdapter.selectFacts(graph, analysis.path)
  return applyFactFixes(analysis.body, facts)
}

function fixedWarnings(round, suffix) {
  const run = round === 1 ? loadRound(1) : loadRound(2)
  const analysis = run.analyses.find((item) => item.path.endsWith(suffix))
  if (!analysis) return null
  const facts = javaSpringAdapter.selectFacts(graph, analysis.path)
  return findBodyFactConflicts(applyFactFixes(analysis.body, facts).text, facts)
}

const fixRound1Controller = fixedBody(1, 'BookController.java')
check('round 1 controller fixed', fixRound1Controller.fixes.length > 0, true)
check('round 1 controller has correct fqn', fixRound1Controller.text.includes('com.com.mapper.BookMapper'), true)
check('round 1 controller clean after fix', fixedWarnings(1, 'BookController.java').length, 0)

const fixRound1Mapper = fixedBody(1, 'BookMapper.java')
check('round 1 mapper fixed', fixRound1Mapper.fixes.length > 0, true)
check('round 1 mapper has correct fqn', fixRound1Mapper.text.includes('com.com.mapper.BookMapper'), true)
check('round 1 mapper clean after fix', fixedWarnings(1, 'BookMapper.java').length, 0)

const fixRound2Controller = fixedBody(2, 'BookController.java')
check('round 2 controller fixed', fixRound2Controller.fixes.length > 0, true)
check('round 2 controller has correct fqn', fixRound2Controller.text.includes('com.com.mapper.BookMapper'), true)
check('round 2 controller clean after fix', fixedWarnings(2, 'BookController.java').length, 0)

const fixRound2Config = fixedBody(2, 'MyBatisConfig.java')
check('round 2 config fixed', fixRound2Config.fixes.length > 0, true)
check(
  'round 2 config has fact sentence',
  fixRound2Config.text.includes('BookServiceImpl 的注入类型是 com.com.mapper.BookMapper'),
  true,
)
check('round 2 config clean after fix', fixedWarnings(2, 'MyBatisConfig.java').length, 0)

const fixRound2Mapper = fixedBody(2, 'BookMapper.java')
check('round 2 mapper unchanged', fixRound2Mapper.fixes.length, 0)
const fixRound2Service = fixedBody(2, 'BookServiceImpl.java')
check('round 2 service unchanged', fixRound2Service.fixes.length, 0)
check('index still warns after other fixes', fixedWarnings(2, 'index.jsp').length, 1)

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
