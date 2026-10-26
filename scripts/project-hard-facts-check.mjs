/**
 * Java/Spring 结构事实的回归检查。
 *
 * 跑法：node --experimental-strip-types scripts/project-hard-facts-check.mjs
 * 样本：../我们的交互/项目测试/sportboot测试/demo15
 */
import fs from 'node:fs'
import path from 'node:path'
import { javaSpringAdapter } from '../app/utils/structure/java-spring.ts'

const ROOT = path.resolve(import.meta.dirname, '../../我们的交互/项目测试/sportboot测试/demo15')
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

function read(rel) {
  return {
    path: rel.replace(/\\/g, '/'),
    text: fs.readFileSync(path.join(ROOT, rel), 'utf8'),
  }
}

const files = [
  read('pom.xml'),
  read('src/main/java/com/mapper/BookMapper.java'),
  read('src/main/java/com/config/MyBatisConfig.java'),
  read('src/main/java/com/service/impl/BookServiceImpl.java'),
  read('src/main/java/com/controller/BookController.java'),
  read('src/main/java/com/example/demo15/HelloServlet.java'),
  read('src/main/resources/com/mapper/BookMapper.xml'),
  read('src/main/resources/application-mapper.xml'),
]

const graph = javaSpringAdapter.analyze(files)

check('profile', graph.profile, 'java-spring')
check('bookermapper fqn', Boolean(graph.symbols['com.com.mapper.BookMapper']), true)
check('bookermapper package', graph.packages['src/main/java/com/mapper/BookMapper.java'], 'com.com.mapper')

const factsOf = (kind) => graph.facts.filter((fact) => fact.kind === kind)
const field = factsOf('field-type').find((fact) =>
  fact.path.endsWith('BookServiceImpl.java') && fact.text.includes('bookMapper'),
)
check('injected field type', field?.object, 'com.com.mapper.BookMapper')
check('injected field line', field?.line, 11)

const scan = factsOf('scan-package').find((fact) => fact.text.includes('setBasePackage'))
check('scan package', scan?.object, 'com.mapper')
check('scan line', scan?.line, 28)

const ns = factsOf('xml-namespace').find((fact) => fact.text.includes('BookMapper.xml'))
check('xml namespace', ns?.object, 'com.mapper.BookMapper')
check('xml namespace line', ns?.line, 3)

check('one conflict', graph.conflicts.length, 1)
check('conflict mentions interface', graph.conflicts[0]?.detail.includes('com.com.mapper.BookMapper'), true)
check('conflict mentions scan', graph.conflicts[0]?.detail.includes('com.mapper'), true)

const servlet = factsOf('annotation').find((fact) => fact.object?.startsWith('WebServlet'))
check('webservlet fact', servlet?.object.includes('/hello-servlet'), true)

const controllerFacts = javaSpringAdapter.selectFacts(graph, 'src/main/java/com/controller/BookController.java')
check('controller gets conflict', controllerFacts.some((fact) => fact.kind === 'conflict'), true)
check('controller fact cap', controllerFacts.length <= 10, true)

const serviceFacts = javaSpringAdapter.selectFacts(graph, 'src/main/java/com/service/impl/BookServiceImpl.java')
check('service gets field fact', serviceFacts.some((fact) => fact.kind === 'field-type' && fact.object === 'com.com.mapper.BookMapper'), true)
check('service gets conflict', serviceFacts.some((fact) => fact.kind === 'conflict'), true)

// ---- 一个完全对得上的小项目：不应产生矛盾 ----
const matching = [
  {
    path: 'src/main/java/com/mapper/BookMapper.java',
    text: 'package com.mapper;\n\npublic interface BookMapper {}',
  },
  {
    path: 'src/main/java/com/config/MyBatisConfig.java',
    text: 'package com.config;\n\npublic class MyBatisConfig {\n  void scan() {\n    MapperScannerConfigurer msc = new MapperScannerConfigurer();\n    msc.setBasePackage("com.mapper");\n  }\n}',
  },
  {
    path: 'src/main/java/com/service/impl/BookServiceImpl.java',
    text: 'package com.service.impl;\n\nimport com.mapper.BookMapper;\n\npublic class BookServiceImpl {\n  private BookMapper bookMapper;\n}',
  },
  {
    path: 'src/main/resources/com/mapper/BookMapper.xml',
    text: '<mapper namespace="com.mapper.BookMapper">\n</mapper>',
  },
]
const matchingGraph = javaSpringAdapter.analyze(matching)
check('matching project has no conflict', matchingGraph.conflicts.length, 0)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall hard-fact checks passed')
