import { z } from 'zod'
import { callLlmMessage } from '../../utils/llm'
import { logLlmUsage } from '../../utils/usage-log'
import {
  PROJECT_AGENT_SYSTEM_PROMPT,
  PROJECT_AGENT_TOOLS,
  PROJECT_SELF_CHECK_SYSTEM_PROMPT,
} from '../../utils/project-agent-prompt'

/**
 * POST /api/project/agent
 *
 * 项目侦查 / 图自检 Agent 的**单轮**模型代理。
 * 工具在浏览器里执行（文件本来就在本地），所以服务端不跑循环、不存状态：
 * 客户端把当前对话发过来，这里补上系统提示词和工具定义，返回模型这一轮的动作
 * （tool_calls 或最终 JSON）。客户端执行工具后再发下一轮。
 *
 * 上下文预算：整段对话按字符数卡在 150 万以内（约 45 万 token），给模型输出留余量。
 * 消息条数另设 10000 的上限：100 轮、每轮最多 20 个工具调用时最坏约 2100 条；
 * 旧的 60 条会在十几轮时误伤正常侦查。
 */

const MAX_TOTAL_CHARS = 1_500_000
const MAX_MESSAGES = 10_000

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().max(200_000).default(''),
  tool_call_id: z.string().max(200).optional(),
  tool_calls: z.array(z.unknown()).max(20).optional(),
})

const RequestSchema = z.object({
  mode: z.enum(['map', 'self-check']).default('map'),
  /** 工具轮数用完后的收尾请求：禁用工具，只要最终 JSON */
  final: z.boolean().default(false),
  messages: z
    .array(MessageSchema)
    .min(1)
    .max(MAX_MESSAGES, 'Agent 对话轮数过多，请直接输出当前结论'),
})

export default defineEventHandler(async (event) => {
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  const totalChars = parsed.data.messages.reduce(
    (sum, m) => sum + m.content.length + JSON.stringify(m.tool_calls ?? '').length,
    0,
  )
  if (totalChars > MAX_TOTAL_CHARS) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Agent 对话已经达到上下文上限，请直接输出当前结论',
    })
  }

  const config = useRuntimeConfig(event)
  const systemPrompt =
    parsed.data.mode === 'self-check'
      ? PROJECT_SELF_CHECK_SYSTEM_PROMPT
      : PROJECT_AGENT_SYSTEM_PROMPT

  const startedAt = Date.now()
  const { message, finishReason, usage } = await callLlmMessage(
    {
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
      model: config.llmModel,
    },
    {
      messages: [{ role: 'system', content: systemPrompt }, ...parsed.data.messages],
      stream: false,
      temperature: 0.2,
      // 地图 Agent 的最终 JSON 要覆盖所有可读文件；4096 在 100 多个文件时
      // 就会截断（线上 187 个文件的实测）。官方 /models 对 deepseek-flash
      // 报的 max_output_tokens 是 393216，5 万是一个足够宽、又低于模型上限的值。
      maxTokens: 50_000,
      tools: PROJECT_AGENT_TOOLS,
      toolChoice: parsed.data.final ? 'none' : 'auto',
      timeoutMs: 90_000,
    },
  )

  logLlmUsage(
    parsed.data.mode === 'self-check' ? 'project/agent:self-check' : 'project/agent:map',
    usage,
    startedAt,
    {
      model: config.llmModel,
      finishReason,
      final: parsed.data.final,
    },
  )

  return { message, finishReason }
})
