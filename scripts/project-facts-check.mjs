/**
 * 跨文件事实块的解析与核对检查。
 *
 * 跑法：node --experimental-strip-types scripts/project-facts-check.mjs
 */

import { stripFactsBlock, verifyFacts } from '../app/utils/project-facts.ts'

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

const withBlock =
  '正文第一段\n<!--facts\n[{"path":"a.js","line":1,"quote":"const a = 1","claim":"定义 a"}]\n-->'

const stripped = stripFactsBlock(withBlock)
check('prefix kept', stripped.text, '正文第一段')
check('claims parsed', stripped.claims?.length, 1)
check('not pending', stripped.pending, false)

const partial = stripFactsBlock('正文<!--fac')
check('partial marker held back', [partial.text, partial.pending], ['正文', true])

const unclosed = stripFactsBlock('正文<!--facts\n[{"path":"a.js"')
check('unclosed held back', [unclosed.text, unclosed.pending], ['正文', true])

const malformed = stripFactsBlock('正文<!--facts\n{not json}\n-->')
check('malformed reports error', [malformed.text, Boolean(malformed.error)], ['正文', true])

const fileText = 'const a = 1\nconsole.log(a)'

const ok = verifyFacts(
  [{ path: 'a.js', line: 1, quote: 'const a = 1', claim: '定义 a' }],
  'a.js',
  fileText,
)
check('valid quote verified', [ok.verified, ok.unverified], [1, 0])

const wrongLine = verifyFacts(
  [{ path: 'a.js', line: 2, quote: 'const a = 1', claim: '定义 a' }],
  'a.js',
  fileText,
)
check('wrong line unverified', [wrongLine.verified, wrongLine.unverified], [0, 1])

const otherFile = verifyFacts(
  [{ path: 'b.js', line: 1, quote: 'const a = 1', claim: '定义 a' }],
  'a.js',
  fileText,
)
check('other file unverified', [otherFile.verified, otherFile.unverified], [0, 1])

const spaced = verifyFacts(
  [{ path: 'a.js', line: 1, quote: 'const   a =   1', claim: '定义 a' }],
  'a.js',
  fileText,
)
check('whitespace normalized', [spaced.verified, spaced.unverified], [1, 0])

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}

console.log('\n全部通过')
