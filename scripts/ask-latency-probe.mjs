/**
 * 追问上下文预算的实测探针：量「历史长度 → 首字延迟」。
 *
 * 用法（和 scripts/rag-probe.mjs 一个路子，都要 --env-file 才能读到密钥）：
 *   npm run ask:probe
 *
 * 为什么直接打模型、不走 /api/ask：
 *   那个接口有 schema 上限，发不出长历史 —— 而这正是要测的东西。
 *
 * ── 两个坑（都踩过，所以写在这里）──
 *
 * 1. **必须打断前缀缓存，否则测不出来**
 *    DeepSeek 有上下文缓存，按**前缀**命中。如果历史是确定性生成的，
 *    长历史的开头就是短历史 —— 各档之间互相污染，差别全被缓存抹平。
 *    所以这里在系统提示词最前面插一段随机串，让缓存必不命中（"冷"），
 *    紧接着原样再发一次拿到"热"。两个数都有用：
 *      · 冷 = 最坏情况（第一次问）
 *      · 热 = 真实情况（每轮都在重发同一段前缀，缓存几乎全命中）
 *
 * 2. **不要"跑两次取较快的一次"**
 *    第二次基本都命中缓存，取较快的一次 = 系统性挑缓存样本来报，
 *    会得出"输入越长越快"这种反直觉的假结论。冷热分开记才有意义。
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

const KEY = process.env.NUXT_LLM_API_KEY
const BASE = (process.env.NUXT_LLM_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
const MODEL = process.env.NUXT_LLM_MODEL ?? 'deepseek-chat'

if (!KEY) {
  console.error('读不到 NUXT_LLM_API_KEY —— 用 npm run ask:probe 跑（它会带上 --env-file=.env）')
  process.exit(1)
}

/** 系统提示词从接口文件里原样抽出来，保证和线上一致 */
const askSrc = fs.readFileSync(new URL('../server/api/ask.post.ts', import.meta.url), 'utf8')
const m = askSrc.match(/const SYSTEM_PROMPT = `([\s\S]*?)`\n/)
if (!m) {
  console.error('抽不出 SYSTEM_PROMPT（server/api/ask.post.ts 的结构变了吗？）')
  process.exit(1)
}
const SYSTEM_PROMPT = m[1]

/** 代码负载：造一份接近 2 万字符上限的代码，取最坏情况（一行约 158 字符 × 124 行 ≈ 19,600） */
const CODE = Array.from(
  { length: 124 },
  (_, i) =>
    `export function step${i}(input, options) {\n  const normalized = input ?? [];\n  return normalized.map((item) => ({ id: item.id, value: item.value * ${i + 1} }));\n}`,
).join('\n\n')

const SELECTION = 'const normalized = input ?? [];'

const FILLER =
  '这段代码里 wrapper 是真正干活的内层函数，它负责计时、调用原函数、再把结果返回。' +
  '装饰器的思路是把"计时"这件事单独抽出来，谁需要就在谁头上贴一个，业务函数保持干净。'

function makeHistory(targetChars) {
  const out = []
  let used = 0
  let i = 0
  while (used < targetChars) {
    const q = `第 ${i + 1} 问：这几行的顺序为什么这样安排？`
    const a = FILLER.repeat(4)
    out.push({ role: 'user', content: q })
    out.push({ role: 'assistant', content: a })
    used += q.length + a.length
    i++
  }
  return out
}

function buildMessages(targetChars, nonce) {
  const history = targetChars > 0 ? makeHistory(targetChars) : []
  const userMessage =
    `# 完整代码\n\n\`\`\`\n${CODE}\n\`\`\`` +
    `\n\n# 他选中的那一小段\n\n\`\`\`\n${SELECTION}\n\`\`\`` +
    `\n\n# 他的问题\n\n这一行在干什么？`
  return [
    // 随机前缀放最前面：只要它变了，后面整段的缓存就都失效
    { role: 'system', content: `[会话标记 ${nonce}]\n\n${SYSTEM_PROMPT}` },
    ...history,
    { role: 'user', content: userMessage },
  ]
}

async function call(messages) {
  const t0 = performance.now()
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      temperature: 0.3,
      max_tokens: 64, // 只要首字时间，输出给短一点就够
      messages,
      stream_options: { include_usage: true }, // 拿缓存命中数，用来证明缓存控制住了
    }),
  })
  if (!res.ok || !res.body) {
    return { error: `HTTP ${res.status} ${(await res.text()).slice(0, 120)}` }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let ttfb = null
  let usage = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const chunk = JSON.parse(payload)
        if (chunk?.choices?.[0]?.delta?.content && ttfb === null) ttfb = performance.now() - t0
        if (chunk?.usage) usage = chunk.usage
      } catch {
        /* 上游偶尔切出不完整分片，忽略 */
      }
    }
  }

  return {
    ttfbMs: ttfb === null ? null : Math.round(ttfb),
    promptTokens: usage?.prompt_tokens ?? null,
    cacheHit: usage?.prompt_cache_hit_tokens ?? null,
  }
}

const SIZES = [0, 5000, 15000, 40000, 80000, 150000]

console.log(`模型：${MODEL}`)
console.log(`代码负载：${CODE.length} 字符（接近 2 万上限，取最坏情况）`)
console.log()
console.log('历史字数 | prompt token | 冷启动首字（缓存命中数） | 缓存命中首字（缓存命中数）')
console.log('---------|--------------|--------------------------|--------------------------')

for (const size of SIZES) {
  const messages = buildMessages(size, crypto.randomUUID().slice(0, 8))
  const cold = await call(messages) // 随机前缀 → 必不命中
  const warm = await call(messages) // 原样再发 → 前缀应全命中

  const f = (r) =>
    r.error ? r.error : `${String(r.ttfbMs).padStart(5)} ms  (命中 ${r.cacheHit ?? '?'})`

  console.log(
    `${String(size).padStart(8)} | ${String(cold.promptTokens ?? '-').padStart(12)} | ${f(cold).padEnd(24)} | ${f(warm)}`,
  )
}

console.log()
console.log('看什么：')
console.log('  · 冷启动那一列的**增长幅度** —— 它决定"输入变大到底要不要等"')
console.log('  · 缓存命中那一列 —— 真实使用就是这一列（每轮都在重发同一段前缀）')
console.log('  · 如果冷/热的"命中"数看着不对，说明缓存没控制住，数据不可信')
