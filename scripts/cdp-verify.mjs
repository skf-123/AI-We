/**
 * 红线校验：**跑一次真实流程**，把「浏览器渲染出来的文字」和「接口返回的原始文本」
 * 逐字对照 —— 去掉 markdown 标记之后**必须相等**。
 *
 * ── 为什么用这个判据，而不是"看截图" ──
 * 模型有 temperature，**每次输出长度都不同**，所以跨次 diff 没有意义。
 * 但**同一次运行里**，「接口返回的原文」和「页面上渲染出来的字」必须一致（只少掉标记符）。
 * 这一条能抓到那些眼睛看不出来的问题：丢了半句话、术语被切碎、转义字符漏出来、标签把文字吃掉。
 *
 * 还有第二条判据在 `dom.articles[].height` 里：**加标记前后，同一段落的高度必须相同** ——
 * 用来确认"新加的可点标记没有挤动排版"。
 *
 * ── 前置条件（两个都要在）──
 *   1. 开发服务器跑着：      npm run dev            → http://localhost:3000
 *   2. headless Chrome 开着远程调试端口 9222：
 *      chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<临时目录> about:blank
 *
 * ── 用法 ──
 *   npm run cdp:verify                    # 用第一个内置示例
 *   npm run cdp:verify -- "Python · 装饰器"  # 指定示例（名字必须和页面上的按钮一致）
 *
 * 产物写在 `.cache/`（该目录已被 .gitignore 排除）：原文一份、DOM 快照一份。
 */
import fs from 'node:fs'
import { join } from 'node:path'
import { loadSamples, REPO_ROOT } from './lib/code-samples.mjs'

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222'
const TARGET_URL = process.env.APP_URL || 'http://localhost:3000/'
const OUT_DIR = join(REPO_ROOT, '.cache')

const samples = loadSamples()
const wanted = process.argv[2]
const SAMPLE = wanted ?? samples[0]?.label
if (!samples.some((s) => s.label === SAMPLE)) {
  throw new Error(`示例名不匹配。可选：${samples.map((s) => s.label).join(' / ')}`)
}
const PREFIX = process.argv[3] || 'cdp-verify'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------- 连上 Chrome 的调试端口 ----------------
let targets
try {
  targets = await (await fetch(`${CDP}/json/list`)).json()
} catch {
  throw new Error(
    `连不上 ${CDP} —— Chrome 的远程调试端口开了吗？\n` +
      `  chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<临时目录> about:blank`,
  )
}
const target = targets.find((t) => t.type === 'page')
if (!target) throw new Error('连上了 Chrome，但没有可用的页面')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = () => rej(new Error(`连不上 ${CDP} —— Chrome 的远程调试端口开了吗？`))
})

let nextId = 1
const pending = new Map()
/** 从网络层抓下来的 /api/analyze 原始响应体 */
let analyzeBody = null
const reqUrls = new Map()

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    return
  }
  // 抓 /api/analyze 的响应体：这是"接口返回的原文"，红线的另一半
  if (msg.method === 'Network.responseReceived') {
    reqUrls.set(msg.params.requestId, msg.params.response.url)
  }
  if (msg.method === 'Network.loadingFinished') {
    const url = reqUrls.get(msg.params.requestId)
    if (url && url.includes('/api/analyze')) {
      send('Network.getResponseBody', { requestId: msg.params.requestId })
        .then((r) => {
          analyzeBody = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body
        })
        .catch(() => {})
    }
  }
}

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

// ---------------- 走一遍真实流程 ----------------
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Page.navigate', { url: TARGET_URL })
await sleep(3500)

// 先点示例按钮，再点「开始解析」
await evaluate(
  `[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(SAMPLE)})).click()`,
)
await sleep(300)
await evaluate(
  `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '开始解析').click()`,
)

// 等流式结束：右栏那条「知识框架图已生成」出现 = 图 JSON 也解析成功了
let waited = 0
while (waited < 150000) {
  await sleep(2000)
  waited += 2000
  const finished = await evaluate(
    `!![...document.querySelectorAll('button')].find(b => b.textContent.includes('知识框架图已生成'))`,
  )
  if (finished) break
}
await sleep(1200)

// ---------------- 采集 DOM ----------------
const dom = await evaluate(`(() => {
  const articles = [...document.querySelectorAll('article')]
  const box = [...document.querySelectorAll('div')].find(d => d.className.includes('overscroll-contain'))
  const firstP = document.querySelector('article p')
  const cs = firstP ? getComputedStyle(firstP) : null
  return {
    articles: articles.map(a => ({
      title: a.querySelector('h2')?.textContent?.trim() ?? '',
      text: a.innerText,
      height: Math.round(a.getBoundingClientRect().height * 100) / 100,
      paraCount: a.querySelectorAll('p').length,
    })),
    fontSize: cs?.fontSize ?? null,
    lineHeight: cs?.lineHeight ?? null,
    boxWidth: box ? Math.round(box.clientWidth) : -1,
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    termCount: document.querySelectorAll('.term').length,
    citeCount: document.querySelectorAll('.cite').length,
  }
})()`)

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(join(OUT_DIR, `${PREFIX}-raw.txt`), analyzeBody ?? '(未抓到)')
fs.writeFileSync(join(OUT_DIR, `${PREFIX}-dom.json`), JSON.stringify(dom, null, 2))

// ---------------- 核心检查 ----------------
/**
 * 把两侧都归一化成"只剩字"：
 * 原文那一侧要剥掉 markdown 标记，渲染那一侧本来就没有标记。
 */
function normalize(s) {
  return (
    s
      // 整个代码围栏行（含 ```js 这种语言标记）——只去反引号会剩下一个 "js"
      .replace(/^[ \t]*```.*$/gm, '')
      // 去掉 markdown 的强调 / 代码 / 标题 / 引用标记。
      // ⚠️ 必须排在"去列表标记"之前，否则两边不对称：
      //    原文里 `**1. xxx` 行首是 *，逃过列表替换；渲染出来是行首 `1. xxx` 却被去掉。
      .replace(/[`*#_>]/g, '')
      // 去掉列表项的行首标记（渲染成 <li> 之后，这些标记不在 innerText 里）
      .replace(/^[ \t]*(?:\d+\.|[-+])[ \t]+/gm, '')
      // 表格分隔线那种纯符号行
      .replace(/^\s*\|?[\s:-]*\|?\s*$/gm, '')
      // 所有空白
      .replace(/\s+/g, '')
  )
}

let check = { skipped: true }
if (analyzeBody) {
  // 只取正文四段 —— 第五段是图 JSON，它不渲染成 article
  const cut = analyzeBody.indexOf('## 五、知识框架图')
  const rawBody = cut === -1 ? analyzeBody : analyzeBody.slice(0, cut)
  // article.innerText 里已经含 <h2> 标题，不要再手动拼一次
  const renderedText = dom.articles.map((a) => a.text).join('\n')

  const a = normalize(rawBody)
  const b = normalize(renderedText)

  // 找出第一个分叉点，方便定位（比只报"不相等"有用得多）
  let at = -1
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      at = i
      break
    }
  }

  check = {
    skipped: false,
    rawLen: a.length,
    renderedLen: b.length,
    equal: a === b,
    firstDivergenceAt: at,
    rawAround: at >= 0 ? a.slice(Math.max(0, at - 40), at + 40) : '',
    renderedAround: at >= 0 ? b.slice(Math.max(0, at - 40), at + 40) : '',
  }
}

console.log(
  JSON.stringify(
    {
      sample: SAMPLE,
      waitedMs: waited,
      hOverflow: dom.hOverflow,
      termCount: dom.termCount,
      citeCount: dom.citeCount,
      articles: dom.articles.map((a) => ({
        title: a.title,
        height: a.height,
        paraCount: a.paraCount,
        chars: a.text.replace(/\s+/g, '').length,
      })),
      typography: { fontSize: dom.fontSize, lineHeight: dom.lineHeight, boxWidth: dom.boxWidth },
      textIntegrity: check,
    },
    null,
    2,
  ),
)

ws.close()
process.exit(check.equal === false ? 1 : 0)
