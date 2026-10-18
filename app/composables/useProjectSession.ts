import type { ConfigMode, ProjectFileEntry, ProjectTreeNode } from '~/types/project'
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
import { useProjectAgent } from './useProjectAgent'
import { useProjectMap } from './useProjectMap'
import { useProjectAnalysis } from './useProjectAnalysis'
import { useProjectSummary } from './useProjectSummary'

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
  const pool = useProjectAnalysis()
  const summary = useProjectSummary()

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

  // ---------------------------------------------------------------- 上传

  async function selectProject(payload: ProjectSelectionPayload) {
    resetAll()
    projectName.value = payload.root || '未命名项目'

    for (const item of payload.files) fileHandles.set(item.path, item.file)
    files.value = payload.files.map((item) => makeFileEntry(item.path, item.file.size))
    phase.value = 'review'

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

    // map 返回后把文件说明贴回登记项；树是 computed，会自动重建
    for (const entry of files.value) entry.note = map.fileNotes[entry.path]
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
   * 手动生成项目总览 + 项目图。
   *
   * 只发摘要：每文件第三段（截断 300 字）+ import 关系 + 项目地图，
   * 不把全文再喂一遍（快照第十一节第 30 条第 3 小节）。
   * role 总长度到预算就停止加入，剩余文件数如实告诉用户。
   */
  async function generateSummary() {
    if (!canGenerateSummary.value) return

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

    await summary.run({
      projectName: projectName.value,
      projectContext: map.context(projectName.value),
      treeText: treeToText(tree.value),
      files: payloadFiles,
    })
  }

  // ---------------------------------------------------------------- 收尾

  function resetAll() {
    pool.stop()
    summary.stop()

    agent.reset()
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
    // Agent 侦查轨迹
    agentRunning: agent.running,
    agentStopped: agent.stopped,
    agentError: agent.error,
    agentSteps: agent.steps,
    agentRounds: agent.rounds,
    agentMaxRounds: agent.maxRounds,
    agentResult: agent.result,
    stopAgent: agent.stop,
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
    openFile,
    selectFolder,
    selectGroup,
    startParsing,
    stopParsing,
    resumeParsing,
    generateSummary,
    resetAll,
    cleanup,
    retryFile: pool.retry,
  }
}
