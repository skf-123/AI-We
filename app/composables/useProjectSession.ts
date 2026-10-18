import type {
  ConfigMode,
  ProjectFileEntry,
  ProjectGraphData,
  ProjectTreeNode,
} from '~/types/project'
import {
  buildTree,
  computeStats,
  countUncheckedSystem,
  extractImports,
  filesForMap,
  filesToParse,
  isBinaryFile,
  makeFileEntry,
  setFolderIncluded,
  thirdSection,
  treeToText,
} from '~/utils/project-files'
import { parseProjectSummary } from '~/utils/project-graph'
import {
  composeVendorReason,
  detectVendor,
  isVendorReviewCandidate,
  shouldProbeVendor,
  type VendorCandidate,
} from '~/utils/project-vendor'
import { useProjectAgent } from './useProjectAgent'
import { useProjectMap } from './useProjectMap'
import { useProjectAnalysis } from './useProjectAnalysis'
import { useProjectSummary } from './useProjectSummary'
import { useProjectVendorReview } from './useProjectVendorReview'

/**
 * 项目页的状态机。
 *
 * 页面只负责排版与编排；「上传了什么、勾了哪些、解析到哪、汇总到哪」
 * 全部在这里。页面不直接拼请求体，也不自己算汇总输入。
 *
 * 组合关系（单向）：
 *   useProjectSession
 *     ├─ useProjectMap        目录说明 + 项目结构结论
 *     ├─ useProjectAnalysis   逐文件并发池
 *     └─ useProjectSummary    手动触发的一次汇总调用
 *
 * 这个 composable 不碰 DOM：滚动、beforeunload、文件全屏都留在页面。
 */

/** 汇总输入的字符预算：role 总长度到这里就停止加入，避免一次调用被撑爆 */
export const SUMMARY_CHAR_BUDGET = 300_000

/** 最多读多少个文件的头做第三方库识别，防止超大项目卡住上传 */
const MAX_VENDOR_PROBES = 2000

/** 文件所在目录；根目录文件返回 null */
function folderOf(path: string): string | null {
  const i = path.lastIndexOf('/')
  return i === -1 ? null : path.slice(0, i)
}

export interface ProjectSelectionPayload {
  root: string
  files: { path: string; file: File }[]
}

/** 勾选文件的结果：系统文件从没勾到勾时，需要页面先弹出 AI 提示 */
export interface ToggleFileResult {
  changed: boolean
  needsHint: boolean
  entry?: ProjectFileEntry
}

/** 勾选文件夹的结果 */
export interface ToggleFolderResult {
  changed: boolean
  needsHint: boolean
  node?: ProjectTreeNode
  systemCount?: number
}

export function useProjectSession() {
  // ---------------------------------------------------------------- 状态

  const projectName = ref('')
  const files = ref<ProjectFileEntry[]>([])
  const activePath = ref<string | null>(null)
  const started = ref(false)
  const phase = ref<'upload' | 'review' | 'parsing' | 'summary'>('upload')
  const uploadError = ref('')
  /** 因预算未纳入汇总的文件数（0 表示全部纳入） */
  const summarySkippedCount = ref(0)
  /** 目录树里选中的文件夹；选中文件时也设为它的父目录 */
  const selectedFolder = ref<string | null>(null)
  /** 项目图里选中的分组节点 id */
  const selectedGroup = ref<string | null>(null)

  /** 文件内容按路径存放：地图只读头部，逐文件解析时才整份读 */
  const fileHandles = new Map<string, File>()

  const map = useProjectMap()
  const agent = useProjectAgent()
  const selfCheck = useProjectAgent()
  const pool = useProjectAnalysis()
  const summary = useProjectSummary()
  const vendorReview = useProjectVendorReview()

  /** 防止上一个项目的候选评审结果落到新项目上 */
  let vendorGeneration = 0

  /** 自检修正后的图；没有自检结果时用汇总原图 */
  const selfCheckGraph = ref<ProjectGraphData | null>(null)
  const selfCheckStarted = ref(false)

  /** 目录说明阶段：Agent 侦查或固定地图，任一在跑都算还没准备好 */
  const notesLoading = computed(() => map.loading.value || agent.running.value)

  // ---------------------------------------------------------------- 派生

  const tree = computed(() => buildTree(files.value, map.folderNotes))
  const stats = computed(() => computeStats(files.value))
  const queueFiles = computed(() => filesToParse(files.value))
  const activeEntry = computed(() => files.value.find((f) => f.path === activePath.value) ?? null)
  const activeProgress = computed(() =>
    activePath.value ? pool.progress[activePath.value] : undefined,
  )

  const totalBytes = computed(() => files.value.reduce((sum, f) => sum + f.size, 0))

  const stepIndex = computed(() => {
    if (phase.value === 'upload') return 0
    if (!started.value) return 1
    if (phase.value === 'summary' || summary.done.value) return 3
    return 2
  })

  const summaryParsed = computed(() =>
    parseProjectSummary(
      summary.output.value,
      files.value.map((f) => f.path),
    ),
  )
  const summaryText = computed(() => summaryParsed.value.text)
  const summaryGraph = computed(() => summaryParsed.value.graph)
  const summaryHasResult = computed(() => summary.output.value.length > 0)
  const displayGraph = computed(() => selfCheckGraph.value ?? summaryGraph.value)

  const doneFiles = computed(() =>
    queueFiles.value.filter((entry) => pool.progress[entry.path]?.status === 'done'),
  )
  const doneCount = computed(() => doneFiles.value.length)

  /** 项目图里当前选中的分组节点 */
  const selectedGroupNode = computed(() => {
    if (!selectedGroup.value) return null
    return summaryGraph.value?.nodes.find((n) => n.id === selectedGroup.value) ?? null
  })

  /**
   * 当前选中范围里的文件（文件夹或图分组）。
   * 选中单个文件时，范围是它所在的文件夹 —— 这样右侧可以显示同目录的兄弟文件。
   */
  const selectionFiles = computed(() => {
    if (selectedGroup.value) {
      const paths = new Set(selectedGroupNode.value?.files?.map((f) => f.path) ?? [])
      return queueFiles.value.filter((f) => paths.has(f.path))
    }
    if (selectedFolder.value) {
      const prefix = `${selectedFolder.value}/`
      return queueFiles.value.filter((f) => f.path.startsWith(prefix))
    }
    return []
  })

  const selectionLabel = computed(() => {
    if (selectedGroup.value) return selectedGroupNode.value?.label ?? selectedGroup.value
    return selectedFolder.value ?? ''
  })

  /** 文件夹 / 分组里各文件第三段的摘录，给「跨文件线索」用 */
  const crossFileNotes = computed(() =>
    selectionFiles.value
      .map((file) => ({
        path: file.path,
        text: thirdSection(pool.progress[file.path]?.output ?? '').slice(0, 240),
      }))
      .filter((note) => note.text),
  )

  /** 点击生成按钮的条件：解析已落定、不是被停止、至少有一个成功文件 */
  const canGenerateSummary = computed(
    () =>
      started.value &&
      pool.allSettled.value &&
      !pool.stopped.value &&
      doneFiles.value.length > 0 &&
      !summary.loading.value,
  )

  /** 用已完成的文件生成总览：至少 2 个成功文件，不要求全部解析完 */
  const canGeneratePartial = computed(
    () => started.value && doneFiles.value.length >= 2 && !summary.loading.value,
  )

  /** 失败文件数（不含用户主动停止）；用于说明本次总览的覆盖范围 */
  const failedCount = computed(
    () =>
      queueFiles.value.filter((entry) => {
        const p = pool.progress[entry.path]
        return p?.status === 'error' && p.error !== '已停止'
      }).length,
  )

  /** 只用了部分文件时，页面上的说明；全部完成则返回空串 */
  const summaryScopeNote = computed(() => {
    if (!started.value || doneCount.value === pool.total.value) return ''

    const unparsed = Math.max(0, pool.total.value - doneCount.value - failedCount.value)
    return `本次只用了 ${doneCount.value} / ${pool.total.value} 个已完成文件；失败 ${failedCount.value} 个、未解析 ${unparsed} 个未纳入。`
  })

  const activeTitle = computed(() => {
    if (!activeEntry.value) {
      if (selectedFolder.value) return selectedFolder.value
      if (selectedGroupNode.value) return selectedGroupNode.value.label
      return ''
    }
    return activeProgress.value?.truncated
      ? `${activeEntry.value.path}（已截断）`
      : activeEntry.value.path
  })

  const emptyHint = computed(() => {
    if (selectedFolder.value && selectionFiles.value.length === 0) {
      return '这个文件夹里没有勾选要解析的文件。'
    }
    if (selectedGroup.value && selectionFiles.value.length === 0) {
      return '这个分组里没有可解析的文件。'
    }
    if (!started.value) {
      return '勾选文件后点「开始解析」；这里会显示当前文件的四段解释。'
    }
    if (!activeProgress.value) {
      return '这个文件还在排队。点它一下可以优先解析。'
    }
    return '正在等待这个文件的内容…'
  })

  /** 侦查收尾的产出摘要；没有结果就返回空串 */
  const agentOutcome = computed(() => {
    if (!map.ran.value) return ''

    const noteCount = Object.keys(map.fileNotes).length
    const parts: string[] = []
    if (map.summary.value) parts.push('概述 1 条')
    if (noteCount > 0) parts.push(`文件说明 ${noteCount} 条`)
    if (map.readingPlan.value.length > 0) parts.push(`建议先读 ${map.readingPlan.value.length} 个`)
    if (map.backend.value) {
      parts.push(map.backend.value.hasBackend ? '后端：有' : '后端：没有')
    }
    return parts.join(' · ')
  })

  /** 第三方库核对状态：没有可说的就返回空串 */
  const vendorNote = computed(() => {
    if (vendorReview.running.value) return 'AI 正在核对疑似第三方库…'
    if (vendorReview.reviewed.value === 0) return ''

    const suggested = files.value.filter((entry) => entry.vendorSuggestion).length
    const parts = [`AI 已核对 ${vendorReview.reviewed.value} 个疑似文件`]
    if (suggested > 0) parts.push(`建议不勾 ${suggested} 个`)
    if (vendorReview.skipped.value > 0) parts.push(`另有 ${vendorReview.skipped.value} 个未核对`)
    return parts.join(' · ')
  })

  // ---------------------------------------------------------------- 上传

  /** 读候选文件的前 4KB；并发 8 个，避免一次打开太多 File */
  async function readHeaders(items: { path: string; file: File }[]): Promise<Map<string, string>> {
    const headers = new Map<string, string>()
    const queue = [...items]

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift()
        if (!item) break
        try {
          headers.set(item.path, await item.file.slice(0, 4096).text())
        } catch {
          headers.set(item.path, '')
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker))
    return headers
  }

  /**
   * 第三方库识别：
   *   · 高置信度：文件名和文件头都对上 → 改成系统文件、默认不勾
   *   · 中置信度：只打「疑似第三方库」标签，仍然默认勾着
   *   · 规则拿不准：进入候选池，交给 Agent 评审（只出建议）
   */
  async function detectVendorEntries(
    items: { path: string; file: File }[],
  ): Promise<VendorCandidate[]> {
    const fileByPath = new Map(items.map((item) => [item.path, item.file]))
    const probe = files.value
      .filter(shouldProbeVendor)
      .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
      .slice(0, MAX_VENDOR_PROBES)

    const headers = await readHeaders(
      probe
        .map((entry) => {
          const file = fileByPath.get(entry.path)
          return file ? { path: entry.path, file } : null
        })
        .filter((item): item is { path: string; file: File } => item !== null),
    )

    const candidates: VendorCandidate[] = []

    for (const entry of probe) {
      const header = headers.get(entry.path) ?? ''
      const hint = detectVendor(entry.path, header)

      if (hint?.confidence === 'high') {
        const baseReason = entry.category === 'system' ? entry.skipReason : undefined

        entry.category = 'system'
        // 压缩产物等形态保留自己的子类，库名是另一维信息
        if (entry.subtype === 'source' || entry.subtype === 'unknown') entry.subtype = 'vendor'
        entry.include = false
        entry.skipReason = composeVendorReason(baseReason, hint.name)
        entry.vendor = hint
        continue
      }

      if (hint) {
        entry.vendor = hint
        if (entry.category === 'system') {
          entry.skipReason = composeVendorReason(entry.skipReason, hint.name, true)
        }
        continue
      }

      if (isVendorReviewCandidate(entry, header)) {
        candidates.push({ path: entry.path, header, size: entry.size })
      }
    }

    return candidates
  }

  /** 异步拿 Agent 建议；换项目或重置后丢弃旧结果 */
  function runVendorReview(candidates: VendorCandidate[]) {
    if (candidates.length === 0) return

    const token = ++vendorGeneration
    void vendorReview.run(candidates).then((suggestions) => {
      if (token !== vendorGeneration) return

      const byPath = new Map(files.value.map((entry) => [entry.path, entry]))
      for (const [path, evidence] of Object.entries(suggestions)) {
        const entry = byPath.get(path)
        if (entry) entry.vendorSuggestion = evidence
      }
    })
  }

  async function selectProject(payload: ProjectSelectionPayload) {
    resetAll()
    projectName.value = payload.root || '未命名项目'

    for (const item of payload.files) fileHandles.set(item.path, item.file)
    files.value = payload.files.map((item) =>
      makeFileEntry(item.path, item.file.size, item.file.type),
    )

    let candidates: VendorCandidate[] = []
    try {
      candidates = await detectVendorEntries(payload.files)
    } catch {
      /* 识别失败不影响上传与逐文件解析 */
    }

    phase.value = 'review'
    runVendorReview(candidates)

    await loadNotes()
  }

  function setUploadError(message: string) {
    uploadError.value = message
  }

  async function readHead(file: File): Promise<string> {
    const text = await file.slice(0, 2000).text()
    return text.split('\n').slice(0, 5).join('\n').slice(0, 600)
  }

  /**
   * 项目地图：只发目录树 + 每个文件头部几行。
   * 最多发 300 个文件的头部 —— 再多的项目，说明留白好过把一次调用撑爆。
   */
  async function loadNotes() {
    const selected = filesForMap(files.value)
    const readablePaths = selected.map((entry) => entry.path)

    // 先让 Agent 自己决定看什么；失败或超预算时回退到原来的固定地图
    const agentResult = await agent.run({
      projectName: projectName.value,
      entries: files.value,
      treeText: treeToText(tree.value),
      parseCount: filesToParse(files.value).length,
      readablePaths,
      getFile: (path) => fileHandles.get(path),
    })

    if (agentResult) {
      map.apply(agentResult)
    } else {
      const heads = await Promise.all(
        selected.slice(0, 300).map(async (entry) => {
          const file = fileHandles.get(entry.path)
          return file ? { path: entry.path, head: await readHead(file) } : null
        }),
      )

      await map.run(
        projectName.value,
        treeToText(tree.value),
        heads.filter((h): h is { path: string; head: string } => h !== null),
      )
    }

    // map 返回后把文件说明贴回登记项；树是 computed，会自动重建。
    // 模型漏写说明时，补一句来源明确的提示，不替它编造用途。
    for (const entry of files.value) {
      const note = map.fileNotes[entry.path]
      if (note) {
        entry.note = note
        continue
      }

      entry.note =
        entry.include && entry.category !== 'system' && !isBinaryFile(entry.path)
          ? '未识别：AI 没有返回说明'
          : undefined
    }
  }

  // ---------------------------------------------------------------- 勾选

  function toggleFile(path: string): ToggleFileResult {
    const entry = files.value.find((f) => f.path === path)
    if (!entry) return { changed: false, needsHint: false }

    // 系统文件默认不勾；从「不勾」到「勾」时，先让页面弹 AI 提示
    if (entry.category === 'system' && !entry.include) {
      return { changed: false, needsHint: true, entry }
    }

    entry.include = !entry.include
    return { changed: true, needsHint: false }
  }

  /** 用户在提示弹窗里确认后，真正把系统文件勾上 */
  function includeFile(path: string) {
    const entry = files.value.find((f) => f.path === path)
    if (entry) entry.include = true
  }

  function toggleFolder(node: ProjectTreeNode): ToggleFolderResult {
    const allSelected = node.selectableCount > 0 && node.selectedCount === node.selectableCount
    if (allSelected) {
      setFolderIncluded(node, false)
      return { changed: true, needsHint: false }
    }

    // 目录里还有没勾的系统文件：先让页面说明一下
    const systemCount = countUncheckedSystem(node)
    if (systemCount > 0) {
      return { changed: false, needsHint: true, node, systemCount }
    }

    setFolderIncluded(node, true)
    return { changed: true, needsHint: false }
  }

  /** 用户在提示弹窗里确认后，真正把整个文件夹勾上 */
  function includeFolder(node: ProjectTreeNode) {
    setFolderIncluded(node, true)
  }

  function setFileMode(path: string, mode: ConfigMode) {
    const entry = files.value.find((f) => f.path === path)
    if (!entry) return

    if (entry.category === 'system') {
      // 二进制文件无法逐行解释，只能作上下文
      if (mode === 'explain' && isBinaryFile(entry.path)) return
      entry.systemMode = mode
    } else {
      entry.configMode = mode
    }

    // 切成「仍需解释」就意味着要解析它
    if (mode === 'explain') entry.include = true
  }

  /** 用户点「取消勾选」时才真正执行 AI 建议；程序不自动改 */
  function uncheckSuggested(path: string) {
    const entry = files.value.find((item) => item.path === path)
    if (entry) entry.include = false
  }

  // ---------------------------------------------------------------- 解析

  /** 在候选文件里挑一个优先展示的：已完成 > 解析中 > 第一个 */
  function pickDefault(list: ProjectFileEntry[]): ProjectFileEntry | null {
    return (
      list.find((f) => pool.progress[f.path]?.status === 'done') ??
      list.find((f) => pool.progress[f.path]?.status === 'running') ??
      list[0] ??
      null
    )
  }

  function openFile(path: string) {
    const entry = files.value.find((f) => f.path === path)
    if (!entry || entry.category === 'system') return

    activePath.value = path
    selectedFolder.value = folderOf(path)
    selectedGroup.value = null
    if (started.value && !pool.allSettled.value) pool.prioritize(path)
  }

  /** 选中目录树里的文件夹：右侧切到该文件夹下的文件，文件夹高亮 */
  function selectFolder(node: ProjectTreeNode) {
    if (node.type !== 'folder') return

    selectedFolder.value = node.path
    selectedGroup.value = null

    const prefix = `${node.path}/`
    const inFolder = queueFiles.value.filter((f) => f.path.startsWith(prefix))
    activePath.value = pickDefault(inFolder)?.path ?? null
  }

  /** 选中项目图里的分组节点：右侧切到该分组下的文件，分组高亮 */
  function selectGroup(id: string) {
    const node = summaryGraph.value?.nodes.find((n) => n.id === id)
    if (!node) return

    selectedGroup.value = id
    selectedFolder.value = null

    const paths = new Set(node.files?.map((f) => f.path) ?? [])
    const inGroup = queueFiles.value.filter((f) => paths.has(f.path))
    activePath.value = pickDefault(inGroup)?.path ?? null
  }

  /** 返回 true 表示真的开始了（页面据此决定要不要滚到结果区） */
  async function startParsing(): Promise<boolean> {
    if (started.value || queueFiles.value.length === 0) return false

    const sources = queueFiles.value
      .map((entry) => ({ path: entry.path, file: fileHandles.get(entry.path) }))
      .filter((item): item is { path: string; file: File } => Boolean(item.file))

    if (sources.length === 0) return false

    started.value = true
    phase.value = 'parsing'
    activePath.value = activePath.value ?? sources[0]!.path

    await pool.start(sources, map.context(projectName.value))

    return true
  }

  function stopParsing() {
    pool.stop()
  }

  function resumeParsing() {
    phase.value = 'parsing'
    pool.resume()
  }

  /**
   * 生成项目总览 + 项目图。
   *
   * 只发摘要：每文件第三段（截断 300 字）+ import 关系 + 项目地图，
   * 不把全文再喂一遍（快照第十一节第 30 条第 3 小节）。
   * role 总长度到预算就停止加入，剩余文件数如实告诉用户。
   *
   * partial = true 时用于「不再解析」：先停掉池子、保留已完成文件，
   * 至少 2 个成功文件才生成，不要求全部解析完。
   */
  async function runSummary(partial: boolean) {
    if (summary.loading.value) return
    if (!started.value) return

    if (partial) {
      if (doneFiles.value.length < 2) return
      if (!pool.allSettled.value) pool.stop()
    } else if (!canGenerateSummary.value) {
      return
    }

    phase.value = 'summary'

    const payloadFiles: { path: string; role: string; imports: string[] }[] = []
    let used = 0
    let skipped = 0

    for (const entry of doneFiles.value) {
      const role = thirdSection(pool.progress[entry.path]?.output ?? '').slice(0, 300)
      if (used + role.length > SUMMARY_CHAR_BUDGET) {
        skipped++
        continue
      }
      used += role.length
      payloadFiles.push({
        path: entry.path,
        role,
        imports: extractImports(pool.textOf(entry.path)),
      })
    }

    summarySkippedCount.value = skipped

    // 重新生成总览时，把上一轮的自检结果一起清掉
    selfCheck.reset()
    selfCheckGraph.value = null
    selfCheckStarted.value = false

    await summary.run({
      projectName: projectName.value,
      projectContext: map.context(projectName.value),
      treeText: treeToText(tree.value),
      files: payloadFiles,
    })
  }

  async function generateSummary() {
    await runSummary(false)
  }

  /** 不再解析：保留已完成文件，用它们生成总览 + 图 */
  async function generatePartialSummary() {
    await runSummary(true)
  }

  /**
   * 图自检：汇总图出现后，再让模型检查有没有浮着的文件、只有分组级的边。
   * 自检失败/被停止就保留原图；整个过程在页面上有轨迹、可打断。
   */
  async function runSelfCheck(graph: ProjectGraphData) {
    const result = await selfCheck.runSelfCheck({
      graph,
      projectContext: map.context(projectName.value),
      entries: files.value,
      parseCount: filesToParse(files.value).length,
      readablePaths: filesForMap(files.value).map((entry) => entry.path),
      getFile: (path) => fileHandles.get(path),
    })

    if (result) selfCheckGraph.value = result
  }

  /**
   * 用户手动重新自检：总是从汇总原图重来，不在上一轮的自检结果上叠改。
   * 失败或被停止时保留当前显示的图（如果有上一轮自检结果，它也还在）。
   */
  async function rerunSelfCheck() {
    const graph = summaryGraph.value
    if (!graph || selfCheck.running.value) return

    selfCheckStarted.value = true
    await runSelfCheck(graph)
  }

  watch([summaryGraph, summary.done], ([graph, done]) => {
    if (!graph || !done || !started.value || selfCheckStarted.value) return
    selfCheckStarted.value = true
    void runSelfCheck(graph)
  })

  // ---------------------------------------------------------------- 收尾

  function resetAll() {
    pool.stop()
    summary.stop()

    agent.reset()
    selfCheck.reset()
    vendorGeneration++
    vendorReview.reset()
    selfCheckGraph.value = null
    selfCheckStarted.value = false
    pool.reset()
    map.reset()
    summary.reset()

    files.value = []
    fileHandles.clear()
    activePath.value = null
    selectedFolder.value = null
    selectedGroup.value = null
    started.value = false
    phase.value = 'upload'
    uploadError.value = ''
    projectName.value = ''
    summarySkippedCount.value = 0
  }

  /** 页面卸载时调用：abort 所有在飞请求 */
  function cleanup() {
    agent.stop()
    selfCheck.stop()
    vendorReview.reset()
    pool.stop()
    summary.stop()
  }

  return {
    // 状态
    projectName,
    files,
    activePath,
    started,
    phase,
    uploadError,
    summarySkippedCount,
    // 地图
    mapSummary: map.summary,
    mapLoading: map.loading,
    mapDegraded: map.degraded,
    mapError: map.error,
    mapCrossFileNotes: map.crossFileNotes,
    mapReadingPlan: map.readingPlan,
    mapBackend: map.backend,
    notesLoading,
    agentOutcome,
    vendorReviewRunning: vendorReview.running,
    vendorNote,
    // Agent 侦查轨迹
    agentRunning: agent.running,
    agentStopped: agent.stopped,
    agentError: agent.error,
    agentSteps: agent.steps,
    agentRounds: agent.rounds,
    agentMaxRounds: agent.maxRounds,
    agentResult: agent.result,
    stopAgent: agent.stop,
    // 图自检
    displayGraph,
    selfCheckRunning: selfCheck.running,
    selfCheckStopped: selfCheck.stopped,
    selfCheckError: selfCheck.error,
    selfCheckSteps: selfCheck.steps,
    selfCheckRounds: selfCheck.rounds,
    selfCheckMaxRounds: selfCheck.maxRounds,
    selfCheckResult: selfCheck.result,
    stopSelfCheck: selfCheck.stop,
    rerunSelfCheck,
    // 并发池
    progress: pool.progress,
    total: pool.total,
    finished: pool.finished,
    runningCount: pool.runningCount,
    allSettled: pool.allSettled,
    limit: pool.limit,
    poolStopped: pool.stopped,
    // 汇总
    summaryOutput: summary.output,
    summaryLoading: summary.loading,
    summaryDone: summary.done,
    summaryError: summary.error,
    // 派生
    tree,
    stats,
    queueFiles,
    activeEntry,
    activeProgress,
    totalBytes,
    stepIndex,
    summaryText,
    summaryGraph,
    summaryHasResult,
    canGenerateSummary,
    canGeneratePartial,
    summaryScopeNote,
    doneCount,
    selectedFolder,
    selectedGroup,
    selectedGroupNode,
    selectionFiles,
    selectionLabel,
    crossFileNotes,
    activeTitle,
    emptyHint,
    // 动作
    selectProject,
    setUploadError,
    toggleFile,
    toggleFolder,
    includeFile,
    includeFolder,
    setFileMode,
    uncheckSuggested,
    openFile,
    selectFolder,
    selectGroup,
    startParsing,
    stopParsing,
    resumeParsing,
    generateSummary,
    generatePartialSummary,
    resetAll,
    cleanup,
    retryFile: pool.retry,
  }
}
