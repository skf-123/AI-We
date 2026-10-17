import { z } from 'zod'
import { callLlmText } from '../../utils/llm'
import {
  PROJECT_MAP_SYSTEM_PROMPT,
  buildProjectMapPrompt,
  type MapFileHead,
} from '../../utils/project-prompt'

/**
 * POST /api/project/map
 *
 * 项目入口的第一次模型调用：只发「目录树 + 每个文件头部几行」，不读全文。
 * 目的是给目录树补上大白话说明，同时产出一段以后每次逐文件请求都要原样带上的
 * 「项目结构结论」—— 它同时是前缀缓存的公共前缀（快照第十一节第 18 条）。
 *
 * 输出是 JSON，不是流：前端要拿这些说明去渲染整棵树，流式没有意义。
 * 模型偶尔不听话（带围栏、带解释），这里做一次宽松解析；
 * 解析失败不算致命错误 —— 树照样能看，逐文件解析照常开始（验收标准 2.3）。
 */

const RequestSchema = z.object({
  projectName: z.string().trim().max(200).default(''),
  treeText: z.string().trim().min(1).max(200_000),
  fileHeads: z
    .array(
      z.object({
        path: z.string().trim().min(1).max(1000),
        head: z.string().max(2000),
      }),
    )
    .max(2000),
})

interface MapNote {
  path: string
  note: string
}

interface MapResult {
  summary: string
  folders: MapNote[]
  files: MapNote[]
  degraded: boolean
}

/** 模型可能包一层 ```json 围栏，也可能前后带几句话 —— 取第一个 { 到最后一个 } */
function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/** 只接受形状对的条目，别把模型编出来的杂项透给前端 */
function toNotes(value: unknown): MapNote[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      const row = item as { path?: unknown; note?: unknown }
      if (typeof row?.path !== 'string' || typeof row?.note !== 'string') return null
      const path = row.path.trim()
      const note = row.note.trim()
      if (!path || !note) return null
      return { path, note: note.slice(0, 200) }
    })
    .filter((item): item is MapNote => item !== null)
}

export default defineEventHandler(async (event): Promise<MapResult> => {
  const parsed = RequestSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? '请求参数有误',
    })
  }

  const config = useRuntimeConfig(event)
  const fileHeads: MapFileHead[] = parsed.data.fileHeads

  let raw: string
  try {
    raw = await callLlmText(
      {
        apiKey: config.llmApiKey,
        baseUrl: config.llmBaseUrl,
        model: config.llmModel,
      },
      {
        messages: [
          { role: 'system', content: PROJECT_MAP_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildProjectMapPrompt(
              parsed.data.projectName,
              parsed.data.treeText,
              fileHeads,
            ),
          },
        ],
        stream: false,
        temperature: 0.2,
        maxTokens: 4096,
        timeoutMs: 60_000,
      },
    )
  } catch (err) {
    // 地图生成失败不该挡住后面的逐文件解析：返回空说明，让前端降级
    console.warn('[project/map] 模型调用失败，降级为空说明：', err)
    return { summary: '', folders: [], files: [], degraded: true }
  }

  const data = extractJson(raw) as { summary?: unknown; folders?: unknown; files?: unknown } | null
  if (!data) {
    console.warn('[project/map] 模型输出不是合法 JSON，降级')
    return { summary: '', folders: [], files: [], degraded: true }
  }

  return {
    summary: typeof data.summary === 'string' ? data.summary.trim().slice(0, 300) : '',
    folders: toNotes(data.folders),
    files: toNotes(data.files),
    degraded: false,
  }
})
