import { z } from 'zod'
import { OUTPUT_TRUNCATED_MARKER, stripOutputTruncation } from '#shared/stream-meta'
import { callLlm } from '../../utils/llm'
import { toLoggedTextStream } from '../../utils/stream'
import {
  PROJECT_GRAPH_SYSTEM_PROMPT,
  buildProjectGraphPrompt,
  type SummaryFileInput,
} from '../../utils/project-prompt'

/**
 * POST /api/project/graph
 *
 * 只生成项目图，不写项目总览正文。
 *
 * 和 /api/project/summary 的关系：
 *   · 正常路径仍然走 summary，一次出正文和图；
 *   · 这个接口只在用户想「只重画图」时用，图失败、图不好看，都不用重跑正文；
 *   · 它和 summary 共用同一份输入格式和同一套图规则，但不共享请求状态。
 *
 * 为什么输入也用同一份：图和正文要对得上。前端会把上次汇总时冻结的文件清单、
 * 目录树和项目结构结论原样发过来；如果有正文，也一起带上，让图按正文的分层画。
 *
 * 为什么要流式再自己攒：非流式请求要等整段生成完才拿到响应头，图很大时会被
 * 超时掐掉。这里先拿到上游响应头（计时只覆盖这一段），再在服务端把文本攒完。
 */

const RequestSchema = z.object({
  projectName: z.string().trim().max(200).default(''),
  projectContext: z.string().max(50_000).default(''),
  treeText: z.string().max(200_000).default(''),
  files: z
    .array(
      z.object({
        path: z.string().trim().min(1).max(1000),
        role: z.string().max(2000),
        imports: z.array(z.string().max(500)).max(20).default([]),
      }),
    )
    .max(2000),
  /** 上一次汇总的正文；可为空，有的话图会尽量按正文的分层画 */
  text: z.string().max(20_000).default(''),
})

export default defineEventHandler(async (event) => {
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  const config = useRuntimeConfig(event)
  const files: SummaryFileInput[] = parsed.data.files

  const userPrompt = buildProjectGraphPrompt(
    parsed.data.projectContext,
    files,
    parsed.data.treeText,
    parsed.data.text,
  )

  const startedAt = Date.now()
  const upstream = await callLlm(
    {
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
      model: config.llmModel,
    },
    {
      messages: [
        { role: 'system', content: PROJECT_GRAPH_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      temperature: 0.3,
      // 和汇总那次保持一致；30 万低于模型单次最大输出 393,216，只是上限
      maxTokens: 300_000,
      // 只覆盖等响应头；流开始后由生成过程决定
      timeoutMs: 120_000,
    },
  )

  let content = ''
  try {
    for await (const chunk of toLoggedTextStream(
      upstream.body as ReadableStream<Uint8Array>,
      { truncatedMarker: OUTPUT_TRUNCATED_MARKER },
      { feature: 'project/graph', model: config.llmModel, startedAt },
    )) {
      content += chunk
    }
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `项目图读取中断：${err instanceof Error ? err.message : String(err)}`,
    })
  }

  const stripped = stripOutputTruncation(content)
  if (!stripped.text.trim()) {
    throw createError({
      statusCode: 502,
      statusMessage: '项目图没有生成出内容，请重试',
    })
  }

  return {
    content: stripped.text,
    truncated: stripped.truncated,
  }
})
