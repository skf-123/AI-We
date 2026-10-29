/**
 * 第三方库识别与单文件上限的纯函数检查。
 *
 * 跑法：node --experimental-strip-types scripts/project-vendor-limits-check.mjs
 */
import { classifyFile } from '../app/utils/project-files.ts'
import { detectVendor, shouldProbeVendor } from '../app/utils/project-vendor.ts'
import {
  PROJECT_ANALYZE_MAX_CHARS,
  projectAnalyzeTooLargeMessage,
} from '../shared/project-limits.ts'

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

const shCorePath = '前端工程/sg-blog-vue/static/js/shCore.js'
const shCoreHeader = '// XRegExp 1.5.1\n// (c) 2007-2012 Steven Levithan\n// MIT License'
const shCoreHint = detectVendor(shCorePath, shCoreHeader)
check('shCore vendor name', shCoreHint?.name, 'SyntaxHighlighter')
check('shCore vendor confidence', shCoreHint?.confidence, 'high')

const brushHint = detectVendor(
  '前端工程/sg-blog-vue/static/js/shBrushJava.js',
  '// SyntaxHighlighter brush for Java\n// MIT License',
)
check('shBrush vendor name', brushHint?.name, 'SyntaxHighlighter')
check('shBrush vendor confidence', brushHint?.confidence, 'high')

const themeHint = detectVendor(
  '前端工程/sg-blog-vue/static/js/shThemeDefault.css',
  '/* SyntaxHighlighter theme */\n/* MIT License */',
)
check('shTheme vendor name', themeHint?.name, 'SyntaxHighlighter')

const normalHint = detectVendor('src/main.js', 'const app = 1')
check('normal file has no vendor hint', normalHint, null)

check(
  'shCore should be probed',
  shouldProbeVendor({
    path: shCorePath,
    size: 163016,
    subtype: 'source',
    category: 'user',
  }),
  true,
)

check('hard limit is 100000', PROJECT_ANALYZE_MAX_CHARS, 100_000)
check('shCore is rejected before request', projectAnalyzeTooLargeMessage(163016) !== null, true)
check('100000 chars is allowed', projectAnalyzeTooLargeMessage(100_000), null)
check('100001 chars is rejected', projectAnalyzeTooLargeMessage(100_001) !== null, true)
check('small file is allowed', projectAnalyzeTooLargeMessage(999), null)

// ---- 静态资源 / 二进制拆分 ----
check('png is asset', classifyFile('assets/logo.png', '').subtype, 'asset')
check('font is asset', classifyFile('public/fonts/a.woff2', '').subtype, 'asset')
check('exr is asset', classifyFile('assets/render.exr', '').subtype, 'asset')
check('jar is binary', classifyFile('lib/tool.jar', '').subtype, 'binary')
check('class is binary', classifyFile('lib/A.class', '').subtype, 'binary')
check('aar is binary', classifyFile('lib/sdk.aar', '').subtype, 'binary')
check('onnx is binary', classifyFile('models/model.onnx', '').subtype, 'binary')
check('safetensors is binary', classifyFile('models/model.safetensors', '').subtype, 'binary')
check('normal source stays source', classifyFile('src/main.js', '').subtype, 'source')
check('pb2 stays source', classifyFile('src/foo_pb2.py', '').subtype, 'source')

// ---- 依赖目录 ----
for (const path of [
  'app/node_modules/react/index.js',
  'app/bower_components/jquery/jquery.js',
  'app/jspm_packages/system.js',
  'app/web_modules/vue.js',
  'venv/lib/python3/site-packages/requests/__init__.py',
  'venv/lib/python3/dist-packages/foo.py',
  'app/.m2/repository/foo.jar',
  'web/WEB-INF/lib/spring.jar',
]) {
  check(`dependency dir: ${path.split('/').slice(-2).join('/')}`, classifyFile(path, '').subtype, 'dependency')
}

// ---- 按语料语言补的高置信库名：仍然要两条信号 ----
check(
  'react-router-dom high with license',
  detectVendor('static/js/react-router-dom.min.js', '// MIT License')?.confidence,
  'high',
)
check(
  'bulma high with license',
  detectVendor('static/css/bulma.min.css', '/* MIT License */')?.confidence,
  'high',
)
check(
  'alpinejs high with license',
  detectVendor('static/js/alpinejs.min.js', '// MIT License')?.confidence,
  'high',
)
check(
  'react without license is only medium',
  detectVendor('static/js/react.js', 'const x = 1')?.confidence,
  'medium',
)
check('python file is not judged by bare name', detectVendor('src/requests.py', '# MIT License'), null)

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
