/**
 * 缓存命中探针：量「公共前缀的顺序」值多少钱。
 *
 * ── 起因 ──
 * 官方定价里，输入的 **缓存命中 0.02 元/百万 token**、**未命中 1 元/百万 token** ——
 * **差 50 倍**。而缓存是按"**从开头开始**的公共前缀"匹配的，所以：
 *   · 每个请求的**开头**逐字节一样 → 后面那截再变，前面照样命中
 *   · 把变动的内容（比如当前文件名）**放到最前面** → 前缀每次不同 → **全部未命中**
 *
 * 这不是理论推断，是量出来的（见下面"实测结果"）。
 *
 * ── 实测结果（2026-10-15，deepseek-flash）──
 *     第 1 次（铺前缀）                 命中率  0.0%
 *     第 2 次（前缀相同、尾部不同）      命中率 72.3%
 *     第 3 次（前缀相同、尾部不同）      命中率 72.5%
 *     第 4 次（把变动内容放到最前面）    命中率  0.0%
 *   ——**同样一段内容，只把顺序换一下，命中率从 72% 掉到 0%。**
 *
 * ── 它对设计的约束 ──
 * 「上传项目 → 逐个文件解析」时，每个文件的请求结构必须是：
 *     system（逐字节不变） → 项目结构结论（逐字节不变） → 该文件的代码（唯一的变量）
 * 所以第一层出的那份"整个项目是什么"，**同时是每个文件调用的公共前缀** —— 一份东西两个用途。
 *
 * ── 前置条件 ──
 *   `.env` 里要有 NUXT_LLM_API_KEY（脚本用 --env-file=.env 读）
 *   ⚠️ 这个探针**只打模型接口**，不需要 dev server、不需要 Chrome
 *
 * ── 用法 ──
 *   npm run cache:probe
 *
 * 说明：用非流式 + max_tokens=1，**只为了拿 usage 里的
 * `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 两个数**，不要输出。
 */
import { loadSamples } from './lib/code-samples.mjs'

const BASE = (process.env.NUXT_LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
const KEY = process.env.NUXT_LLM_API_KEY
const MODEL = process.env.NUXT_LLM_MODEL || 'deepseek-chat'

if (!KEY)
  throw new Error('缺少 NUXT_LLM_API_KEY —— 请用 `npm run cache:probe`（它会带上 --env-file=.env）')

/**
 * 一段"项目结构结论"，当公共前缀用。
 * 造得足够大是为了触发缓存；真实场景里它来自第一层那次"整个项目是什么"的调用结果。
 */
const PROJECT_PREFIX =
  '以下是这个项目的结构说明：' +
  'src/index.js 是入口，负责初始化与路由；src/api/client.js 封装了 HTTP 请求与错误重试；' +
  'src/api/users.js 提供用户相关的接口；src/utils/format.js 负责日期与数字格式化；' +
  'src/utils/validate.js 负责表单校验；src/components/ 下是 UI 组件；' +
  'tests/ 下是单元测试。整体是一个前端项目，依赖 axios 与 dayjs。'.repeat(40)

async function callModel(system, user, label) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      max_tokens: 1, // 只要 usage，不要输出
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  const j = await res.json()
  if (!res.ok) {
    console.log(`  ${label.padEnd(30)} HTTP ${res.status}  ${JSON.stringify(j).slice(0, 120)}`)
    return
  }
  const u = j.usage || {}
  const hit = u.prompt_cache_hit_tokens ?? 0
  const miss = u.prompt_cache_miss_tokens ?? 0
  const total = u.prompt_tokens ?? 0
  console.log(
    `  ${label.padEnd(30)} prompt ${String(total).padStart(6)} ｜ 命中 ${String(hit).padStart(6)} ｜ 未命中 ${String(miss).padStart(6)} ｜ 命中率 ${((hit / (total || 1)) * 100).toFixed(1)}%`,
  )
}

const code = loadSamples()[0].code.replace(/\n+/g, ' ')

console.log(`模型 ${MODEL}`)
console.log('规则：命中 0.02 元/M、未命中 1 元/M —— 差 50 倍\n')

// 前三次：前缀逐字节相同，只有尾部在变
await callModel(PROJECT_PREFIX, `文件一：\n${code.slice(0, 400)}`, '第1次（铺前缀）')
await callModel(PROJECT_PREFIX, `文件二：\n${code.slice(400, 800)}`, '第2次（前缀相同·尾部不同）')
await callModel(PROJECT_PREFIX, `文件三：\n${code.slice(800, 1200)}`, '第3次（前缀相同·尾部不同）')
// 第四次：把变动的内容挪到最前面 —— 前缀从此不同
await callModel(
  `文件四：\n${code.slice(0, 200)}\n\n${PROJECT_PREFIX}`,
  '尾巴',
  '第4次（变动内容放最前）',
)

console.log('\n第 1 次通常全未命中（缓存还没建），第 2、3 次才是要看的。')
console.log('第 4 次要和它们对比 —— 内容差不多，只换了顺序，命中率应该掉到 0。')
