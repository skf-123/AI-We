import { z } from 'zod'
import { toTextStream } from '../utils/stream'
import { HISTORY_ITEM_GUARD, charBudgetOf, trimHistory } from '../utils/history'

/**
 * POST /api/ask —— 针对解析结果里选中的一小段代码追问。
 *
 * 这是「看懂 → 还不懂 → 就地追问 → 懂了」这条自学闭环的最后一环：
 * 主链路负责把代码讲一遍，讲完还有疑问时，不该逼用户把整段代码重贴一遍。
 *
 * 与 /api/analyze 的分工：
 *   analyze 是**一次性**的整套讲解（四段 + 图），提示词重、耗时长
 *   ask     是**局部**的追问，只盯住选中的那几行，回答要短要快
 *
 * 刻意保持**无状态**：对话历史由前端一并传上来，服务端不存会话。
 * 现有后端只有两个路由，保持这个轻量 —— 不用引存储、不用管并发、部署简单。
 *
 * v1 不接知识库检索：追问多是"这几行到底在干嘛"，属局部解释，
 * 检索带来的收益有限、却会明显拉长等待。留作后续可选项。
 */

const HistoryItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(8000),
})

const RequestSchema = z.object({
  /** 整段原始代码 —— 追问要有上下文，否则"这两行"指什么就说不清 */
  code: z.string().trim().min(1, '缺少代码上下文').max(20000),
  /** 用户在解析结果里选中的那一小段 */
  selection: z.string().trim().max(2000).default(''),
  question: z.string().trim().min(1, '请先写一个问题').max(500, '问题太长了，请精简一下'),
  /**
   * 之前问过的，让它可以接着往下答。
   *
   * ⚠️ 这里的 max 是**护栏**，只负责"接不接受这个请求"，**不决定带多少**。
   *    真正决定带多少的是下面的长度预算（见 server/utils/history.ts）。
   *    两者分开，顺序也不能反。
   */
  history: z.array(HistoryItemSchema).max(HISTORY_ITEM_GUARD).default([]),
})

const SYSTEM_PROMPT = `你是一位极其耐心的编程导师，正在辅导一个「自学编程、但看不懂别人代码」的人。

他刚才看了你对整段代码的讲解，现在**选中了其中一小段**来追问。

# 怎么回答

- **只回答他问的那件事**，不要顺势把整段代码再讲一遍 —— 那正是他不需要的
- 把上下文里那段代码当成"他指着问的地方"，回答要贴着它
- 答案**尽量短**：通常三五句话就够。能用一两句说清的，不要写成一段
- 全程用中文，说人话。尽量少用术语；万不得已要用，必须紧跟一句大白话解释
- 面向初学者：宁可把话说明白，也不要跳跃

# 诚实性要求（重要）

- **绝对不要编造。** 不确定就明说，例如："这一点从这段代码看不出来"
- 不要假装知道作者意图；推断时要说明"从代码看，这里像是……"
- 如果他的问题建立在一个误解上，**直接指出来**，别顺着答 —— 那对他更有帮助

# 格式

- 直接开始回答，**不要**任何开场白、寒暄、"好问题"之类的话
- 可以用 Markdown（列表、行内代码、代码块），但不要用小标题`

export default defineEventHandler(async (event) => {
  // ---- 1. 校验输入 ----
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  // ---- 2. 取配置（与 /api/analyze 共用同一组 LLM 配置）----
  const config = useRuntimeConfig(event)
  if (!config.llmApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: '服务端未配置大模型 API Key，请检查 .env 文件里的 NUXT_LLM_API_KEY',
    })
  }

  const { code, selection, question } = parsed.data

  // ---- 2.5 历史按**长度**裁（不是按条数）----
  // 从最近往前累加到预算为止。注意顺序：schema 那层只管"接不接受这个请求"，
  // 这里才决定"给模型看多少"。
  const charBudget = charBudgetOf(config.askHistoryTokens)
  const history = trimHistory(parsed.data.history, charBudget)

  // ---- 3. 组装消息 ----
  // 选中的那一段单独摆出来，并用「他选中了」说明它的身份 ——
  // 否则模型可能把它当成"用户随手贴的一段代码"，回答就跑偏了。
  const focus = selection
    ? `\n\n# 他选中的那一小段\n\n\`\`\`\n${selection}\n\`\`\``
    : '\n\n（他没有选中具体哪一段，问题针对整段代码。）'

  const userMessage = `# 完整代码\n\n\`\`\`\n${code}\n\`\`\`${focus}\n\n# 他的问题\n\n${question}`

  // ---- 4. 调用上游 ----
  let upstream: Response
  try {
    upstream = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        stream: true,
        temperature: 0.3, // 偏低：解释类任务要稳定、少发挥
        max_tokens: 2048, // 追问要短 —— 限制比主链路小一个数量级，这也是它更快的原因
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          // 之前问过的轮次原样带上，让它能接着上下文答
          ...history,
          { role: 'user', content: userMessage },
        ],
      }),
    })
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `无法连接大模型服务：${err instanceof Error ? err.message : String(err)}`,
    })
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    throw createError({
      statusCode: 502,
      statusMessage: `大模型返回异常（${upstream.status}）：${detail.slice(0, 300)}`,
    })
  }

  // ---- 5. 把文本流交给浏览器（与主链路同一套拆壳逻辑）----
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  }

  // 裁掉了多少轮，走响应头告诉前端。
  // 跟引用来源走 X-Rag-Sources 是同一个道理：这是**服务端已经确定的事实**，
  // 不该让前端自己再算一遍（两边各算一套，迟早会漂移）。
  //
  // ⚠️ 两个细节都踩过：
  //   · 判据用**条数**（有没有真裁掉东西），不用轮数 ——
  //     裁掉 1 条时 items 22→21，用 ceil 算轮数两边都是 11，头就带不上了，等于"裁了不说"
  //   · 轮数用 **floor**，它表示"少掉了几整轮"，跟用户的直觉一致
  const totalItems = parsed.data.history.length
  const usedItems = history.length
  if (usedItems < totalItems) {
    headers['X-Ask-History'] = encodeURIComponent(
      JSON.stringify({
        usedRounds: Math.floor(usedItems / 2),
        totalRounds: Math.floor(totalItems / 2),
      }),
    )
  }

  return new Response(toTextStream(upstream.body) as unknown as ReadableStream, { headers })
})
