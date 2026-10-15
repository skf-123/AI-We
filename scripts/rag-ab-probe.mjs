/**
 * RAG 开关的 A/B 探针：同一段代码、同一个模型、同一套参数，只把「有没有检索到资料」换掉，
 * 看第四部分「技术溯源」到底变了什么。
 *
 * 用途：回答评分表里那一句「生成质量是否因检索增强而**显著**提升」——
 *      不是写一句"我们实现了 RAG"，而是把数字量出来。
 *
 * ── 两条臂怎么做到只差"有没有资料" ──
 *   A 开：直接打本机的 POST /api/analyze —— 那就是生产链路本身，检索、组提示词、调模型全都走真的
 *   B 关：脚本自己组提示词。系统提示词用同一个 SYSTEM_PROMPT（从 server/utils/prompt.ts 导入，
 *         不复制），用户消息用 buildUserPrompt(code, [])，模型参数照抄 analyze.post.ts
 *         （temperature 0.3 / max_tokens 8192）
 *   所以两臂的差异只有：RAG_INSTRUCTION 那一段 + 「参考资料」块。
 *
 * ── 为什么 A 臂要打接口、而不是自己跑检索 ──
 *   server/rag/retrieve.ts 里的 import 不带扩展名（'./corpus'），那是 Nitro 的解析方式，
 *   普通 node 认不了。硬要在脚本里跑检索就只能把 detectBucket / buildQuery / cosine 再抄一份 ——
 *   而 rag-probe.mjs 已经抄了一份，再抄一份就是三份。打接口等于直接用真货，一行都不用抄。
 *
 * ⚠️ 前置：开发服务器要在跑（默认 http://localhost:3000），且 .env 里两把 key 都填了。
 *    必须带 --experimental-strip-types，因为要 import 一个 .ts（见 package.json 的 rag:ab）。
 *
 * 用法：
 *   npm run rag:ab                        # 跑内置的三个示例（从 CodePane.vue 里读，不另抄一份）
 *   npm run rag:ab -- "Python · 装饰器"    # 只跑指定那一个
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const BASE = (process.env.NUXT_LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
const KEY = process.env.NUXT_LLM_API_KEY
const MODEL = process.env.NUXT_LLM_MODEL || 'deepseek-chat'
const APP = process.env.NUXT_PUBLIC_APP_URL || 'http://localhost:3000'

/** 从提示词模块导入 —— 提示词是核心资产，探针必须用同一份，不能复制 */
const { SYSTEM_PROMPT, buildUserPrompt } = await import(
  new URL('../server/utils/prompt.ts', import.meta.url).href
)

/**
 * 示例代码从 app/components/CodePane.vue 里读。
 * 这样「探针量的样本」永远等于「演示时用的样本」，不会各写一份然后漂移。
 */
function loadSamples() {
  const src = fs.readFileSync(join(ROOT, 'app/components/CodePane.vue'), 'utf8')
  const start = src.indexOf('const SAMPLES')
  // 注意：要从「= 」之后的第一个 [ 开始。类型注解 `{ label: string; code: string }[]`
  // 里本身就有一对中括号，从 start 往后找会提前配平，得到一个空数组。
  const eq = src.indexOf('=', start)
  const head = src.indexOf('[', eq)

  let depth = 0
  let end = -1
  for (let i = head; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new Error('没能从 CodePane.vue 里解析出 SAMPLES')

  // 只读本地源码里的一段字面量，不执行任何外部输入
  return eval(`(${src.slice(head, end + 1)})`)
}

/** 读一条 SSE 流，拼成纯文本 */
async function readTextStream(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const payload = s.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) out += delta
      } catch {
        /* 半截 JSON，跳过 */
      }
    }
  }
  return out
}

/** A 臂：打真实接口（production 链路） */
async function runWithRag(code) {
  const res = await fetch(`${APP}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error(`${APP}/api/analyze 返回 ${res.status}（dev server 起了吗？）`)

  const header = res.headers.get('x-rag-sources')
  const sources = header ? JSON.parse(decodeURIComponent(header)) : []

  // ⚠️ 这里读的是**纯文本**，不是 SSE —— /api/analyze 在服务端已经把上游的 SSE
  //    拆成纯文本再转发（见 server/utils/stream.ts）。拿 SSE 解析器读它只会得到空串。
  //    只有 B 臂直连模型时才是 SSE。
  return { text: await res.text(), sources }
}

/** B 臂：不打接口，自己组「无资料」的提示词 —— 参数照抄 analyze.post.ts */
async function runWithoutRag(code) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      temperature: 0.3,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(code, []) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`模型接口返回 ${res.status}：${(await res.text()).slice(0, 200)}`)
  return { text: await readTextStream(res.body), sources: [] }
}

/** 抠出第四部分「技术溯源」 */
function section4(text) {
  const start = text.indexOf('## 四、技术溯源')
  if (start === -1) return ''
  const end = text.indexOf('## 五、')
  return text.slice(start, end === -1 ? undefined : end).trim()
}

async function main() {
  if (!KEY) throw new Error('缺少 NUXT_LLM_API_KEY，请确认用 --env-file=.env 运行')

  const only = process.argv[2]
  const samples = loadSamples().filter((s) => !only || s.label === only)
  if (samples.length === 0) throw new Error(`没有匹配的示例：${only}`)

  console.log(`模型 ${MODEL} ｜ 真实链路 ${APP} ｜ 样本 ${samples.length} 个`)
  console.log('两臂的差异只有「有没有检索到资料」；模型参数、提示词其余部分完全相同。')

  const rows = []

  for (const s of samples) {
    process.stdout.write(`\n跑「${s.label}」… `)
    const withRag = await runWithRag(s.code)
    const without = await runWithoutRag(s.code)
    process.stdout.write('完成\n')

    const a = section4(withRag.text)
    const b = section4(without.text)
    const cite = (t) => (t.match(/\[\d+\]/g) || []).length

    rows.push({
      label: s.label,
      aLen: a.length,
      bLen: b.length,
      aCite: cite(a),
      bCite: cite(b),
      ids: withRag.sources.map((x) => x.id),
    })
  }

  console.log('\n════════ 第四部分「技术溯源」对比 ════════')
  console.log('样本                  开RAG字数  引用   关RAG字数  引用   检索到')
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(20)} ${String(r.aLen).padStart(6)} ${String(r.aCite).padStart(5)} ` +
        `${String(r.bLen).padStart(9)} ${String(r.bCite).padStart(5)}   ${r.ids.join('、') || '（无）'}`,
    )
  }

  const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length
  console.log(
    `\n平均：开 RAG ${avg('aLen').toFixed(0)} 字 / 关 RAG ${avg('bLen').toFixed(0)} 字` +
      `（${((avg('aLen') / avg('bLen') - 1) * 100).toFixed(0)}%）`,
  )

  const reversed = rows.filter((r) => r.bLen >= r.aLen)
  console.log(`引用编号：开 RAG ${rows.reduce((s, r) => s + r.aCite, 0)} 处 / 关 RAG 0 处`)
  if (reversed.length) {
    console.log(
      `\n⚠️ 有 ${reversed.length} 个样本是关 RAG 反而更长（${reversed.map((r) => r.label).join('、')}）——`,
    )
    console.log('   说明增益不是必然的：语料覆盖到的点才有增量，模型本来就知道的点没有。')
  }
  console.log('\n注：样本量小、每样本只跑一次，模型有温度，看趋势不要看单点。')
}

main().catch((err) => {
  console.error('❌ 探测失败：', err.message)
  process.exit(1)
})
