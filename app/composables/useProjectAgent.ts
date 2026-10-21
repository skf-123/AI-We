import type {
  AgentStep,
  CrossFileEvidence,
  ProjectFileEntry,
  ProjectGraphData,
} from '~/types/project'
import { createProjectToolExecutor } from '~/utils/project-tools'
import { sanitizeProjectGraph } from '~/utils/project-graph'
import { formatStepResult } from '~/utils/agent-trace'

/**
 * 项目 Agent 的循环。一个实例只跑一种任务：
 *   run           项目侦查，产出项目地图
 *   runSelfCheck  图自检，产出修正后的项目图
 *
 * 服务端只做单轮模型代理；这里负责：
 *   规划循环 → 执行浏览器里的只读工具 → 把结果作为 tool 消息发回 → 直到模型给出 JSON
 *
 * 边界：
 *   · 最多工具轮数 = min(需要解析的文件数, 40)；自检再收紧到 10
 *   · 整段对话按字符数卡在 1.4M 以内（同一个模型上下文，不是新额度）
 *   · 任何一步失败/用户停止 → 返回 null，调用方回退到原来的结果
 *
 * 不碰 DOM，也不认识目录树 / 项目图组件。
 */

export interface ProjectAgentMapResult {
  summary: string
  folders: { path: string; note: string }[]
  files: { path: string; note: string }[]
  readingPlan: string[]
  crossFileNotes: string[]
  /** 可选：每条线索对应的原文行；旧输出没有这个字段也照常工作 */
  crossFileEvidence: CrossFileEvidence[]
  backend: { hasBackend: boolean; evidence: string } | null
}

export interface ProjectAgentInput {
  projectName: string
  entries: ProjectFileEntry[]
  treeText: string
  /** 项目树里需要解析的文件数，用来决定最多跑几轮工具 */
  parseCount: number
  /** 允许读取的路径（用户勾选的非二进制文件） */
  readablePaths: string[]
  getFile: (path: string) => File | undefined
}

export interface ProjectSelfCheckInput {
  graph: ProjectGraphData
  projectContext: string
  entries: ProjectFileEntry[]
  parseCount: number
  readablePaths: string[]
  getFile: (path: string) => File | undefined
}

const MAX_ROUNDS_HARD = 40
const MAX_SELF_CHECK_ROUNDS = 10
const MAX_CONTEXT_CHARS = 1_400_000
const MAX_TREE_CHARS = 150_000
const MAX_CONTEXT_TEXT = 100_000
const MAX_READABLE_LIST = 300

type AgentMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: unknown[]
}

interface LoopOptions<T> {
  mode: 'map' | 'self-check'
  initialContent: string
  maxRounds: number
  executor: ReturnType<typeof createProjectToolExecutor>
  parse: (content: string) => T | null
}

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

function parseMapResult(raw: unknown, entries: ProjectFileEntry[]): ProjectAgentMapResult | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as {
    summary?: unknown
    folders?: unknown
    files?: unknown
    readingPlan?: unknown
    crossFileNotes?: unknown
    crossFileEvidence?: unknown
    backend?: unknown
  }

  const known = new Set(entries.map((entry) => entry.path))

  const notes = (value: unknown) =>
    Array.isArray(value)
      ? value
          .map((item) => {
            const row = item as { path?: unknown; note?: unknown }
            if (typeof row?.path !== 'string' || typeof row?.note !== 'string') return null
            return { path: row.path.trim(), note: row.note.trim().slice(0, 200) }
          })
          .filter((item): item is { path: string; note: string } => item !== null)
      : []

  const summary = typeof data.summary === 'string' ? data.summary.trim().slice(0, 300) : ''
  const folders = notes(data.folders)
  const files = notes(data.files).filter((row) => known.has(row.path))
  const readingPlan = Array.isArray(data.readingPlan)
    ? data.readingPlan
        .filter((path): path is string => typeof path === 'string' && known.has(path))
        .slice(0, 12)
    : []
  const crossFileNotes = Array.isArray(data.crossFileNotes)
    ? data.crossFileNotes
        .filter((note): note is string => typeof note === 'string')
        .map((note) => note.trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 20)
    : []

  const evidenceRows = Array.isArray(data.crossFileEvidence) ? data.crossFileEvidence : []
  const perNote = new Map<number, number>()
  const crossFileEvidence: CrossFileEvidence[] = []

  for (const rawRow of evidenceRows) {
    if (crossFileEvidence.length >= 20) break

    const row = rawRow as { note?: unknown; path?: unknown; line?: unknown; quote?: unknown }
    const note = Number(row?.note)
    const line = Number(row?.line)
    if (!Number.isInteger(note) || note < 1 || note > crossFileNotes.length) continue
    if (typeof row?.path !== 'string' || !known.has(row.path.trim())) continue
    if (!Number.isInteger(line) || line < 1) continue
    if (typeof row?.quote !== 'string') continue

    const quote = row.quote.trim().slice(0, 300)
    if (!quote) continue

    const used = perNote.get(note) ?? 0
    if (used >= 2) continue
    perNote.set(note, used + 1)
    crossFileEvidence.push({ note, path: row.path.trim(), line, quote })
  }

  const backendRow = data.backend as { hasBackend?: unknown; evidence?: unknown } | undefined
  const backend =
    backendRow && typeof backendRow === 'object'
      ? {
          hasBackend: Boolean(backendRow.hasBackend),
          evidence:
            typeof backendRow.evidence === 'string' ? backendRow.evidence.trim().slice(0, 300) : '',
        }
      : null

  if (!summary && folders.length === 0 && files.length === 0) return null

  return { summary, folders, files, readingPlan, crossFileNotes, crossFileEvidence, backend }
}

export function useProjectAgent() {
  const running = ref(false)
  const stopped = ref(false)
  const error = ref('')
  const steps = ref<AgentStep[]>([])
  const result = ref<unknown>(null)
  const rounds = ref(0)
  const maxRounds = ref(0)

  let controller: AbortController | null = null

  async function ask(
    mode: 'map' | 'self-check',
    messages: AgentMessage[],
    final: boolean,
  ): Promise<AgentMessage> {
    controller ??= new AbortController()

    const res = await fetch('/api/project/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, final, messages }),
      signal: controller.signal,
    })

    if (!res.ok) {
      let msg = `Agent 请求失败（HTTP ${res.status}）`
      try {
        const data = await res.json()
        msg = data?.statusMessage || data?.message || msg
      } catch {
        /* 保持默认提示 */
      }
      throw new Error(msg)
    }

    const data = (await res.json()) as { message?: AgentMessage }
    return data.message ?? { role: 'assistant', content: '' }
  }

  async function runLoop<T>(options: LoopOptions<T>): Promise<T | null> {
    reset()
    running.value = true
    maxRounds.value = options.maxRounds

    const messages: AgentMessage[] = [{ role: 'user', content: options.initialContent }]

    try {
      for (let round = 1; round <= options.maxRounds; round++) {
        if (stopped.value) return null

        const message = await ask(options.mode, messages, false)
        messages.push(message)
        rounds.value = round

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const rawCall of message.tool_calls) {
            const call = rawCall as {
              id?: unknown
              function?: { name?: unknown; arguments?: unknown }
            }
            const id = typeof call.id === 'string' ? call.id : `call_${round}_${steps.value.length}`
            const name = typeof call.function?.name === 'string' ? call.function.name : ''
            const rawArgs = call.function?.arguments
            let args: Record<string, unknown> = {}

            if (typeof rawArgs === 'string') {
              try {
                const parsed = JSON.parse(rawArgs)
                if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
              } catch {
                /* 参数不是合法 JSON，按空对象执行，工具会返回错误 */
              }
            } else if (rawArgs && typeof rawArgs === 'object') {
              args = rawArgs as Record<string, unknown>
            }

            const toolResult = await options.executor.execute(name, args)
            messages.push({ role: 'tool', tool_call_id: id, content: toolResult })
            const note = message.content.trim().slice(0, 300)
            const argsText = JSON.stringify(args).slice(0, 300)
            steps.value.push({
              round,
              name,
              args: argsText,
              result: toolResult.slice(0, 600),
              note: note || undefined,
              summary: formatStepResult({ round, name, args: argsText, result: toolResult }),
            })

            if (stopped.value) return null
          }

          if (JSON.stringify(messages).length > MAX_CONTEXT_CHARS) {
            error.value = 'Agent 对话达到上下文上限，停止继续读'
            return null
          }

          continue
        }

        const parsed = options.parse(message.content)
        if (parsed) {
          result.value = parsed
          return parsed
        }

        messages.push({
          role: 'user',
          content:
            '请只输出最终 JSON，不要解释文字，不要 Markdown 代码围栏。结构必须和系统提示里给的一致。',
        })
      }

      // 工具轮数用完：禁掉工具，让它基于已有信息收尾
      const finalMessage = await ask(options.mode, messages, true)
      const parsed = options.parse(finalMessage.content)
      if (parsed) {
        result.value = parsed
        return parsed
      }

      error.value = 'Agent 没有给出合法的 JSON，已停止'
      return null
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        stopped.value = true
        return null
      }
      error.value = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      running.value = false
      controller = null
    }
  }

  async function run(input: ProjectAgentInput): Promise<ProjectAgentMapResult | null> {
    const executor = createProjectToolExecutor({
      entries: input.entries,
      readablePaths: input.readablePaths,
      getFile: input.getFile,
    })

    const readableSet = new Set(input.readablePaths)
    const readable = input.entries.filter((entry) => readableSet.has(entry.path))
    const readableList = readable
      .slice(0, MAX_READABLE_LIST)
      .map((entry) => `- ${entry.path} (${entry.size} B)`)
      .join('\n')

    const treeText =
      input.treeText.length > MAX_TREE_CHARS
        ? input.treeText.slice(0, MAX_TREE_CHARS) + '\n……目录树太长，已截断'
        : input.treeText

    return runLoop<ProjectAgentMapResult>({
      mode: 'map',
      initialContent: `项目名：${input.projectName}
需要解析的文件数：${input.parseCount}

【目录树】
${treeText}

【已勾选、可读取的文件（最多列出 ${MAX_READABLE_LIST} 个，读取时只能用这些路径）】
${readableList || '（没有可读文件）'}

请开始侦查：先判断项目像什么，再按需读配置和关键文件，最后输出项目地图 JSON。`,
      maxRounds: Math.max(1, Math.min(input.parseCount || 1, MAX_ROUNDS_HARD)),
      executor,
      parse: (content) => parseMapResult(extractJson(content), input.entries),
    })
  }

  async function runSelfCheck(input: ProjectSelfCheckInput): Promise<ProjectGraphData | null> {
    const executor = createProjectToolExecutor({
      entries: input.entries,
      readablePaths: input.readablePaths,
      getFile: input.getFile,
    })

    const readableSet = new Set(input.readablePaths)
    const readableList = input.entries
      .filter((entry) => readableSet.has(entry.path))
      .slice(0, MAX_READABLE_LIST)
      .map((entry) => `- ${entry.path}`)
      .join('\n')

    const context =
      input.projectContext.length > MAX_CONTEXT_TEXT
        ? input.projectContext.slice(0, MAX_CONTEXT_TEXT) + '\n……已截断'
        : input.projectContext

    return runLoop<ProjectGraphData>({
      mode: 'self-check',
      initialContent: `【当前项目图】
${JSON.stringify(input.graph, null, 2)}

【项目结构结论】
${context}

【已勾选、可读取的文件】
${readableList || '（没有可读文件）'}

请检查这张图：有没有文件节点浮着没有连线、有没有只有分组到分组的边、有没有写反或编造的关系。需要时读代码确认，最后输出修正后的图 JSON。`,
      maxRounds: Math.max(1, Math.min(input.parseCount || 1, MAX_SELF_CHECK_ROUNDS)),
      executor,
      parse: (content) =>
        sanitizeProjectGraph(
          extractJson(content),
          input.entries.map((e) => e.path),
        ),
    })
  }

  function stop() {
    stopped.value = true
    controller?.abort()
    controller = null
  }

  function reset() {
    stop()
    running.value = false
    stopped.value = false
    error.value = ''
    steps.value = []
    result.value = null
    rounds.value = 0
    maxRounds.value = 0
  }

  return {
    running,
    stopped,
    error,
    steps,
    result,
    rounds,
    maxRounds,
    run,
    runSelfCheck,
    stop,
    reset,
  }
}
