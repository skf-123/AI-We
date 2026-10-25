import type {
  AgentStep,
  CrossFileEvidence,
  ProjectFileEntry,
  ProjectGraphData,
} from '~/types/project'
import { createProjectToolExecutor } from '~/utils/project-tools'
import { sanitizeProjectGraph } from '~/utils/project-graph'
import { formatStepResult } from '~/utils/agent-trace'
import type { GraphSuspicion } from '~/utils/project-graph-candidates'

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
  /** 程序从 import 和图的边里找到的差异；自检只核对这批项 */
  suspicions?: GraphSuspicion[]
  /** 候选边的覆盖情况，写进初始内容让模型知道证据边界 */
  candidateSummary?: {
    parsed: number
    edges: number
    supported: number
    unknown: number
    unresolved: number
  }
  /** 本次最多执行多少次工具调用；到上限就强制收尾 */
  maxToolCalls?: number
}

const MAX_ROUNDS_HARD = 40
const MAX_SELF_CHECK_ROUNDS = 10
const MAX_CONTEXT_CHARS = 1_400_000
const MAX_TREE_CHARS = 150_000
const MAX_CONTEXT_TEXT = 100_000
const MAX_READABLE_LIST = 300

/** 工具轮数用完后的收尾指令：先告诉它不要再调工具，再要 JSON */
function finalInstruction(mode: 'map' | 'self-check'): string {
  if (mode === 'self-check') {
    return '工具轮数或工具调用次数已用完。不要再调用工具；基于你已经读到的内容，只输出修正后的完整图 JSON，不要解释，不要 Markdown 代码围栏。'
  }
  return '工具轮数或工具调用次数已用完。不要再调用工具；基于你已经读到的内容，只输出项目地图 JSON（summary、folders、files、crossFileNotes、crossFileEvidence、readingPlan、backend），不要解释，不要 Markdown 代码围栏。'
}

/** 收尾仍然不是合法 JSON 时，只给它一次修复机会 */
const REPAIR_INSTRUCTION =
  '上面这段不是合法 JSON。只把它修成合法 JSON，保持内容不变，不要解释，不要 Markdown 代码围栏。'

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
  /** 可选：整段运行最多执行多少次工具调用；到上限就收尾 */
  maxToolCalls?: number
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
  /** 这次运行真正读过的文件路径；自检摘要用它说“读了 N 个文件” */
  const readFiles = ref<string[]>([])

  let controller: AbortController | null = null

  interface AskResult {
    message: AgentMessage
    finishReason: string
  }

  async function ask(
    mode: 'map' | 'self-check',
    messages: AgentMessage[],
    final: boolean,
  ): Promise<AskResult> {
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

    const data = (await res.json()) as { message?: AgentMessage; finishReason?: string }
    return {
      message: data.message ?? { role: 'assistant', content: '' },
      finishReason: data.finishReason ?? '',
    }
  }

  async function runLoop<T>(options: LoopOptions<T>): Promise<T | null> {
    reset()
    running.value = true
    maxRounds.value = options.maxRounds

    const messages: AgentMessage[] = [{ role: 'user', content: options.initialContent }]
    const readPaths = new Set<string>()
    const maxToolCalls = options.maxToolCalls ?? Number.POSITIVE_INFINITY
    let capReached = false

    try {
      for (let round = 1; round <= options.maxRounds; round++) {
        if (stopped.value) return null

        const { message } = await ask(options.mode, messages, false)
        messages.push(message)
        rounds.value = round

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const rawCall of message.tool_calls) {
            const call = rawCall as {
              id?: unknown
              function?: { name?: unknown; arguments?: unknown }
            }
            const id = typeof call.id === 'string' ? call.id : `call_${round}_${steps.value.length}`

            // 工具调用总量到上限后，不再执行；每条调用都要补一个 tool 消息，
            // 否则下一轮的消息结构不完整。
            if (steps.value.length >= maxToolCalls) {
              capReached = true
              messages.push({
                role: 'tool',
                tool_call_id: id,
                content: '已达到本次检查的工具调用上限，停止读取，请直接输出 JSON。',
              })
              continue
            }

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
            if (
              (name === 'read_file_slice' || name === 'read_config') &&
              typeof args.path === 'string' &&
              !toolResult.startsWith('错误')
            ) {
              readPaths.add(args.path)
            }
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

          if (capReached) break

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

      // 工具轮数用完：先明确告诉它“不要再调工具，只交 JSON”，再禁掉工具
      messages.push({ role: 'user', content: finalInstruction(options.mode) })
      const final = await ask(options.mode, messages, true)
      let parsed = options.parse(final.message.content)
      if (parsed) {
        result.value = parsed
        return parsed
      }

      // 收尾仍然不是合法 JSON：给它一次修复机会，只修格式，不重新调查
      if (final.message.content.trim()) {
        messages.push({ role: 'assistant', content: final.message.content })
      }
      messages.push({ role: 'user', content: REPAIR_INSTRUCTION })
      const repaired = await ask(options.mode, messages, true)
      parsed = options.parse(repaired.message.content)
      if (parsed) {
        result.value = parsed
        return parsed
      }

      error.value =
        final.finishReason === 'length' || repaired.finishReason === 'length'
          ? 'Agent 输出被截断，没有拿到完整 JSON，已停止'
          : 'Agent 没有给出合法的 JSON，已停止'
      return null
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        stopped.value = true
        return null
      }
      error.value = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      readFiles.value = [...readPaths]
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

    const suspicions = input.suspicions ?? []
    const candidate = input.candidateSummary
    const suspicionLines = suspicions.slice(0, 8).map((item, index) => {
      const kind = item.kind === 'reversed' ? '方向相反' : '没有 import 依据'
      return `${index + 1}. ${kind}：${item.detail.slice(0, 300)}`
    })
    const moreSuspicions =
      suspicions.length > 8 ? `\n……另有 ${suspicions.length - 8} 条未列出。` : ''
    const programSection = candidate
      ? `【程序预检】
已解析 ${candidate.parsed} 个文件，从 import 里找到 ${candidate.edges} 条文件级候选边；图里 ${candidate.supported} 条有依据，${candidate.unknown} 条无法判断，${candidate.unresolved} 条 import 没能解析到文件。
${
  suspicionLines.length
    ? suspicionLines.join('\n') + moreSuspicions
    : '没有发现图里的边和 import 明显矛盾。不要为了找问题读文件；检查分组和标签后直接输出原图 JSON。'
}
最多核对上面列出的 5–8 条；确认 3–5 条关键关系就输出；不要为了补全项目关系读更多文件。`
      : ''

    return runLoop<ProjectGraphData>({
      mode: 'self-check',
      initialContent: `【当前项目图】
${JSON.stringify(input.graph, null, 2)}

【项目结构结论】
${context}

【已勾选、可读取的文件】
${readableList || '（没有可读文件）'}
${programSection ? `\n${programSection}` : ''}

请检查这张图：有没有文件节点浮着没有连线、有没有只有分组到分组的边、有没有写反或编造的关系。需要时读代码确认，最后输出修正后的图 JSON。`,
      maxRounds: Math.max(1, Math.min(input.parseCount || 1, MAX_SELF_CHECK_ROUNDS)),
      maxToolCalls: input.maxToolCalls,
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
    readFiles.value = []
  }

  return {
    running,
    stopped,
    error,
    steps,
    result,
    rounds,
    maxRounds,
    readFiles,
    run,
    runSelfCheck,
    stop,
    reset,
  }
}
