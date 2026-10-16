/**
 * 并发实测：**在真实浏览器里**同时发 N 个 `/api/analyze`，量出"并发到底能到几"。
 *
 * ── 为什么必须在浏览器里发，而不是用 Node 脚本 ──
 * 因为这里要量的瓶颈是**浏览器自己的同源连接数限制**（HTTP/1.1 每域约 6 条）。
 * 从 Node 直发是量不出来的 —— Node 不受这条限制放，测出来的是"服务端能扛多少"，
 * 而那个数（官方并发上限 2500）根本不是我们的瓶颈。
 *
 * ── 看什么 ──
 * TTFB（首字节时间）的**分布**。如果被连接数卡住，会出现"一批一批"的现象：
 *     并发 10：0.7 0.7 0.7 0.8 0.9 1.0 │ 14.7 14.8 14.8 16.0
 *              └──── 6 个立刻开始 ────┘   └── 4 个白等了 15 秒 ──┘
 * 6 个一批、批间隔约等于一次请求的时长 —— 这就是教科书式的连接池行为。
 *
 * ── 这份数据用在哪 ──
 * 它决定了「一个项目里同时解析几个文件」那个数（见项目快照第十一节第 17 条）。
 * **本地是 HTTP/1.1，所以本地最优是 5（6 是天花板）；部署后走 HTTP/2，
 * 多路复用会让这条限制消失，那时要拿同一个脚本在线上再量一次。**
 *
 * ── 前置条件（两个都要在）──
 *   1. 开发服务器跑着：      npm run dev            → http://localhost:3000
 *   2. headless Chrome 开着远程调试端口 9222
 *
 * ── 用法 ──
 *   npm run cdp:concurrency              # 默认测 5 / 10 / 20 / 40
 *   npm run cdp:concurrency -- 5 10      # 只测这两档
 *
 * ⚠️ 每档都会真跑 N 次完整生成，40 档那一轮会真花掉 40 次调用的钱。
 */
import { loadSamples } from './lib/code-samples.mjs'

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222'
const TARGET_URL = process.env.APP_URL || 'http://localhost:3000/'

const levels = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => n > 0)
const LEVELS = levels.length ? levels : [5, 10, 20, 40]

const samples = loadSamples()
const sample = samples[0]
if (!sample) throw new Error('CodePane.vue 里一个示例都没有')
const CODE = JSON.stringify(sample.code)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
}
function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 300000,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: TARGET_URL })
await sleep(3000)

console.log(`示例：${sample.label}（${sample.code.length} 字符）`)

for (const n of LEVELS) {
  // 在页面上下文里发 N 个并发 —— 用的就是浏览器自己的连接池
  const expr = `(async () => {
    const code = ${CODE};
    const t0 = performance.now();
    const rs = await Promise.all(Array.from({length: ${n}}, async (_, i) => {
      const t = performance.now();
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const ttfb = Math.round(performance.now() - t);   // 首字节：含"排队等连接"的时间
        const text = await res.text();
        return { i, st: res.status, ttfb, done: Math.round(performance.now() - t0), len: text.length };
      } catch (e) {
        return { i, st: 'ERR', ttfb: Math.round(performance.now() - t), done: Math.round(performance.now() - t0) };
      }
    }));
    return { total: Math.round(performance.now() - t0), rs };
  })()`

  const r = await evaluate(expr)
  const tts = r.rs.map((x) => x.ttfb).sort((a, b) => a - b)
  const statuses = {}
  for (const x of r.rs) statuses[x.st] = (statuses[x.st] || 0) + 1

  const fastest = tts[0]
  const delayed = tts.filter((x) => x > fastest + 5000).length

  console.log(`\n并发 ${String(n).padStart(2)} ｜ 总墙钟 ${(r.total / 1000).toFixed(1)}s`)
  console.log(`   状态码：${JSON.stringify(statuses)}`)
  console.log(
    `   TTFB：最快 ${(fastest / 1000).toFixed(1)}s ｜ 中位 ${(tts[Math.floor(tts.length / 2)] / 1000).toFixed(1)}s ｜ 最慢 ${(tts[tts.length - 1] / 1000).toFixed(1)}s`,
  )
  console.log(`   被推迟的（TTFB 比最快那批晚 >5 秒）：${delayed} / ${n}  ← 大于 0 就说明在排队`)
  console.log(`   明细：${tts.map((x) => (x / 1000).toFixed(1)).join(' ')}`)
}

console.log('\n提示：出现"6 个一批"就是浏览器的同源连接数限制。')
console.log('      部署到 HTTP/2 之后（多路复用）这条限制消失，要拿这个脚本在线上再量一次。')

ws.close()
process.exit(0)
