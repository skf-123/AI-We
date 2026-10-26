/**
 * 跨文件事实块的解析与核对检查。
 *
 * 跑法：node --experimental-strip-types scripts/project-facts-check.mjs
 */

import {
  applyFactFixes,
  findBodyFactConflicts,
  formatVerifiedFacts,
  stripFactsBlock,
  verifyFacts,
} from '../app/utils/project-facts.ts'

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

const multi = stripFactsBlock(
  `正文<!--facts
[{"path":"a.js","line":1,"quote":"const a = 1","claim":"一"}]
[{"path":"a.js","line":2,"quote":"console.log(a)","claim":"二"}]
-->`,
)
check('multiple arrays parsed', multi.claims?.length, 2)

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
check('wrong line corrected', [wrongLine.verified, wrongLine.unverified], [1, 0])
check('wrong line reports real line', wrongLine.items[0].line, 1)
check('wrong line explains correction', wrongLine.items[0].reason.includes('行号已修正'), true)

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

// ---- 程序事实：命中、矛盾、正文冲突 ----

const hardFacts = [
  {
    id: 'fqn:BookMapper',
    kind: 'fqn',
    path: 'BookMapper.java',
    line: 1,
    quote: 'package com.com.mapper;',
    text: 'BookMapper.java:1 interface com.com.mapper.BookMapper',
    subject: 'com.com.mapper.BookMapper',
    predicate: 'fqn',
    object: 'com.com.mapper.BookMapper',
  },
  {
    id: 'ns:BookMapper.xml',
    kind: 'xml-namespace',
    path: 'BookMapper.xml',
    line: 3,
    quote: '<mapper namespace="com.mapper.BookMapper">',
    text: 'BookMapper.xml:3 namespace="com.mapper.BookMapper"',
    subject: 'BookMapper.xml',
    predicate: 'xml-namespace',
    object: 'com.mapper.BookMapper',
  },
  {
    id: 'field:BookServiceImpl:11',
    kind: 'field-type',
    path: 'BookServiceImpl.java',
    line: 11,
    quote: 'private com.com.mapper.BookMapper bookMapper;',
    text: 'BookServiceImpl.java:11 bookMapper : com.com.mapper.BookMapper',
    subject: 'BookServiceImpl.java#bookMapper',
    predicate: 'field-type',
    object: 'com.com.mapper.BookMapper',
  },
  {
    id: 'servlet:HelloServlet:7',
    kind: 'web-servlet',
    path: 'HelloServlet.java',
    line: 7,
    quote: '@WebServlet(name = "helloServlet", value = "/hello-servlet")',
    text: 'HelloServlet.java:7 @WebServlet(name = "helloServlet", value = "/hello-servlet")',
    subject: 'com.example.demo15.HelloServlet',
    predicate: 'annotation',
    object: 'WebServlet(name = "helloServlet", value = "/hello-servlet")',
  },
]

const fieldText =
  'package com.service.impl;\n\n@Service\npublic class BookServiceImpl {\n  @Autowired\n  private com.com.mapper.BookMapper bookMapper;\n}'

const fromFact = verifyFacts(
  [
    {
      path: 'BookServiceImpl.java',
      line: 12,
      quote: 'private com.com.mapper.BookMapper bookMapper;',
      claim: '注入类型是 com.com.mapper.BookMapper',
    },
  ],
  'BookServiceImpl.java',
  fieldText,
  hardFacts,
)
check(
  'hard fact verifies claim',
  [fromFact.verified, fromFact.unverified, fromFact.contradictions],
  [1, 0, 0],
)
check('hard fact uses real line', fromFact.items[0].line, 11)
check('hard fact id attached', fromFact.items[0].factId, 'field:BookServiceImpl:11')

const contradiction = verifyFacts(
  [
    {
      path: 'BookController.java',
      line: 18,
      quote: 'Book book = service.findBookById(id);',
      claim: 'BookController 调用 com.mapper.BookMapper 接口',
    },
  ],
  'BookController.java',
  'Book book = service.findBookById(id);',
  hardFacts,
)
check(
  'namespace-as-interface contradiction',
  [contradiction.contradictions, contradiction.verified],
  [1, 0],
)
check(
  'contradiction carries correct fact',
  contradiction.items[0].correct.includes('com.com.mapper.BookMapper'),
  true,
)

const namespaceClaim = verifyFacts(
  [
    {
      path: 'BookMapper.java',
      line: 1,
      quote: 'package com.com.mapper;',
      claim: 'BookMapper 的包名写成 com.com.mapper，与 XML namespace com.mapper.BookMapper 不一致',
    },
  ],
  'BookMapper.java',
  'package com.com.mapper;',
  hardFacts,
)
check('namespace claim is not contradiction', namespaceClaim.contradictions, 0)

const bodyWarnings = findBodyFactConflicts(
  '往下，它调用 com.service.BookService 接口，实际执行的是 BookServiceImpl，后者再调 com.mapper.BookMapper。',
  hardFacts,
)
check('body warning for wrong interface', bodyWarnings.length, 1)
check('body warning names correct fact', bodyWarnings[0].includes('com.com.mapper.BookMapper'), true)

check(
  'namespace sentence not warned',
  findBodyFactConflicts('BookMapper.xml 的 namespace 是 com.mapper.BookMapper。', hardFacts).length,
  0,
)

const injectionWarnings = findBodyFactConflicts(
  'com.mapper 这个包名同时出现在 BookServiceImpl 的注入类型上。',
  hardFacts,
)
check('body warning for injection type', injectionWarnings.length, 1)
check('injection warning names correct type', injectionWarnings[0].includes('com.com.mapper.BookMapper'), true)

check(
  'correct injection sentence not warned',
  findBodyFactConflicts('BookServiceImpl 的注入类型是 com.com.mapper.BookMapper。', hardFacts)
    .length,
  0,
)

const servletClaim = verifyFacts(
  [
    {
      path: 'index.jsp',
      line: 11,
      quote: '<a href="hello-servlet">Hello Servlet</a>',
      claim: '两个 HelloServlet 也没有 @WebServlet 证据，链接大概率 404',
    },
  ],
  'index.jsp',
  '<a href="hello-servlet">Hello Servlet</a>',
  hardFacts,
)
check('servlet claim contradiction', servletClaim.contradictions, 1)
check('servlet body warning', findBodyFactConflicts('两个 HelloServlet 也没有用 @WebServlet 的证据。', hardFacts).length, 1)

check(
  'null is not an injection type',
  findBodyFactConflicts('如果找不到，注入类型是 null。', hardFacts).length,
  0,
)

check('empty facts format', formatVerifiedFacts([]), '')
check('facts format includes text', formatVerifiedFacts(hardFacts).includes('BookMapper.java:1'), true)

// ---- 名字级更正 ----
const fixedCall = applyFactFixes('后者再调 com.mapper.BookMapper，然后返回。', hardFacts)
check('fix wrong interface name', fixedCall.text.includes('com.com.mapper.BookMapper'), true)
check('fix records one replacement', fixedCall.fixes.length, 1)
check(
  'fix keeps legitimate namespace',
  applyFactFixes('BookMapper.xml 的 namespace 是 com.mapper.BookMapper。', hardFacts).text.includes(
    'com.mapper.BookMapper',
  ),
  true,
)
check(
  'fix ignores null',
  applyFactFixes('如果找不到，注入类型是 null。', hardFacts).text.includes('null'),
  true,
)
const fixedInjection = applyFactFixes('BookServiceImpl 的注入类型是 com.mapper。', hardFacts)
check('fix direct injection', fixedInjection.text.includes('com.com.mapper.BookMapper'), true)
const fixedSentence = applyFactFixes(
  'com.mapper 这个包名同时出现在 BookServiceImpl 的注入类型上。',
  hardFacts,
)
check(
  'fix injection sentence',
  fixedSentence.text.includes('BookServiceImpl 的注入类型是 com.com.mapper.BookMapper'),
  true,
)

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}

console.log('\n全部通过')
