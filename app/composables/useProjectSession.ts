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
  verifyEvidence,
} from '~/utils/project-files'
import { parseProjectSummary } from '~/utils/project-graph'
import { diffProjectGraph, type ProjectGraphDiff } from '~/utils/project-graph-diff'
import { enrichProjectGraph } from '~/utils/project-graph-enrich'
import { scanCandidateEdges } from '~/utils/project-candidate-edges'
import {
  compareGraphToCandidates,
  filterVerifiedSuspicions,
} from '~/utils/project-graph-candidates'
import { buildSelfCheckPlan, selfCheckBatchEnabled } from '~/utils/self-check-plan'
import { mergeSelfCheckDecisions } from '~/utils/self-check-merge'
import type { SelfCheckCoverage, SelfCheckEvidence } from '~/types/self-check'
import {
  composeVendorReason,
  detectVendor,
  isVendorReviewCandidate,
  shouldProbeVendor,
  type VendorCandidate,
} from '~/utils/project-vendor'
import { useProjectAgent, type ProjectAgentMapResult } from './useProjectAgent'
import { summaryRoleForFile } from '~/utils/project-facts'
import { useProjectMap } from './useProjectMap'
import { useProjectAnalysis } from './useProjectAnalysis'
import { useProjectGraph, type ProjectGraphPayload } from './useProjectGraph'
import { useProjectSummary } from './useProjectSummary'
import { useProjectVendorReview } from './useProjectVendorReview'
import {
  analyzeProjectStructure,
  structureFactsEnabled,
  type ProjectStructureResult,
} from '~/utils/structure'
import type { StructureSourceFile } from '~/types/structure'

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
 *     ├─ useProjectSummary    手动触发的一次汇总调用
 *     └─ useProjectGraph      只生成项目图的独立请求
 *
 * 这个 composable 不碰 DOM：滚动、beforeunload、文件全屏都留在页面。
 */

/** 汇总输入的字符预算：role 总长度到这里就停止加入，避免一次调用被撑爆 */
export const SUMMARY_CHAR_BUDGET = 300_000

/** 最多读多少个文件的头做第三方库识别，防止超大项目卡住上传 */
const MAX_VENDOR_PROBES = 2000

/** 结构事实最多读多少个文件；再多的项目只做逐文件解释，不做结构核对 */
const MAX_STRUCTURE_FILES = 2000

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
  /**
   * 选完文件夹到目录树出现之间的准备状态。
   *
   * 这段在做同步建登记、读文件头识别第三方库；手机上文件一多就要几秒。
   * 上传区靠它显示转圈，否则用户看到的是“点了没反应”。
   */
  const preparing = ref(false)
  const uploadError = ref('')
  /** 因预算未纳入汇总的文件数（0 表示全部纳入） */
  const summarySkippedCount = ref(0)
  /** 目录树里选中的文件夹；选中文件时也设为它的父目录 */
  const selectedFolder = ref<string | null>(null)
  /** 项目图里选中的分组节点 id */
  const selectedGroup = ref<string | null>(null)

  /** 文件内容按路径存放：地图只读头部，逐文件解析时才整份读 */
  const fileHandles = new Map<string, File>()
  /**
   * 程序解析出的项目结构事实图；没有支持的语言时为 null。
   * 只作为逐文件解析的附加输入，不参与地图、总览和图。
   */
  const structure = shallowRef<ProjectStructureResult | null>(null)

  const map = useProjectMap()
  const agent = useProjectAgent()
  const selfCheck = useProjectAgent()
  const pool = useProjectAnalysis()
  const summary = useProjectSummary()
  const graph = useProjectGraph()
  const vendorReview = useProjectVendorReview()

  /** 防止上一个项目的候选评审结果落到新项目上 */
  let vendorGeneration = 0

  /**
   * 第三方库检查的完成情况。
   * probed = 实际看过文件名 / 文件头的文件数；total = 按规则该看的文件数。
   * 检查完成时一定有值，所以图例里任何时候都能说清「这次查了没有」。
   */
  const vendorCheck = ref<{ probed: number; total: number; failed: boolean } | null>(null)

  /** 自检修正后的图；没有自检结果时用汇总原图 */
  const selfCheckGraph = ref<ProjectGraphData | null>(null)
  const selfCheckStarted = ref(false)
  /** 分批自检是否启用；默认开，?selfcheck=legacy 回旧路径 */
  const selfCheckBatchMode = ref(selfCheckBatchEnabled())
  /** 分批自检的覆盖率；旧路径为 null */
  const selfCheckCoverage = ref<SelfCheckCoverage | null>(null)
  const selfCheckEvidence = ref<SelfCheckEvidence[]>([])
  const selfCheckApplied = ref<ReturnType<typeof mergeSelfCheckDecisions>['applied']>([])
  /** 自检前的图：用于比较改动，以及“恢复自检前的图” */
  const preSelfCheckGraph = ref<ProjectGraphData | null>(null)
  const selfCheckDiff = ref<ProjectGraphDiff | null>(null)
  const selfCheckRestored = ref(false)
  /** 用户单独重画出来的图；优先于汇总原图，但排在自检结果之后 */
  const graphOverride = ref<ProjectGraphData | null>(null)
  /** 上一次汇总时冻结的输入；重画图沿用它，保证图和正文用的是同一批文件 */
  const lastSummaryInput = ref<
    (Omit<ProjectGraphPayload, 'text'> & { skipped: number }) | null
  >(null)
  /** 是否正在补解析新增文件；和首次解析区分开 */
  const parsingAdditional = ref(false)
  /** 这次补解析涉及的路径；停止后「继续解析」只续这一批 */
  const activeParsingPaths = ref<string[]>([])

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

  function withGraphEvidence(graph: ProjectGraphData): ProjectGraphData {
    return enrichProjectGraph(
      graph,
      structure.value?.allFacts ?? [],
      structure.value?.symbols ?? {},
      filesForMap(files.value).map((entry) => entry.path),
    )
  }

  const displayGraph = computed(() => {
    const graph = selfCheckGraph.value ?? graphOverride.value ?? summaryGraph.value
    return graph ? withGraphEvidence(graph) : null
  })

  const doneFiles = computed(() =>
    queueFiles.value.filter((entry) => pool.progress[entry.path]?.status === 'done'),
  )
  const doneCount = computed(() => doneFiles.value.length)

  /** 当前勾选里从来没有解析记录的文件；这是「新增」的准确口径 */
  const newSelected = computed(() =>
    queueFiles.value.filter((entry) => !pool.progress[entry.path]),
  )
  const newSelectedCount = computed(() => newSelected.value.length)

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
      !summary.loading.value &&
      !graph.loading.value,
  )

  /** 用已完成的文件生成总览：至少 2 个成功文件，不要求全部解析完 */
  const canGeneratePartial = computed(
    () =>
      started.value &&
      doneFiles.value.length >= 2 &&
      !summary.loading.value &&
      !graph.loading.value,
  )

  /** 只重画图：至少 2 个成功文件；汇总和图都没有在跑。图自检在跑时不挡，点了会先停自检 */
  const canRunGraphOnly = computed(
    () =>
      started.value &&
      doneFiles.value.length >= 2 &&
      !summary.loading.value &&
      !graph.loading.value,
  )

  /** 按钮本身什么时候出现；跑到一半也要显示，好让用户看到「图生成中」 */
  const canShowGraphOnly = computed(
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

  /**
   * 汇总主按钮现在该做什么。
   * 有新增未解析文件时先解析新增；解析完再由用户点生成，不自动跑。
   */
  const summaryAction = computed<
    'parse-new' | 'parsing-new' | 'generate' | 'retry-failed' | 'blocked'
  >(() => {
    if (parsingAdditional.value) return 'parsing-new'
    if (newSelectedCount.value > 0) return 'parse-new'
    if (doneFiles.value.length > 0) return 'generate'
    if (failedCount.value > 0) return 'retry-failed'
    return 'blocked'
  })

  /** 当前勾选里已完成 / 待解析 / 失败的数量说明；全完成则不显示 */
  const summaryScopeNote = computed(() => {
    if (!started.value) return ''

    const totalSelected = queueFiles.value.length
    if (totalSelected === 0) return ''

    const unparsed = Math.max(0, totalSelected - doneCount.value - failedCount.value)
    if (unparsed === 0 && failedCount.value === 0) return ''

    return `当前选中 ${totalSelected} 个：已完成 ${doneCount.value} 个、待解析 ${unparsed} 个、失败 ${failedCount.value} 个。`
  })

  const activeTitle = computed(() => {
    if (!activeEntry.value) {
      if (selectedFolder.value) return selectedFolder.value
      if (selectedGroupNode.value) return selectedGroupNode.value.label
      return ''
    }
    const path = activeEntry.value.path
    const inputTruncated = activeProgress.value?.truncated
    const outputTruncated = activeProgress.value?.outputTruncated

    if (inputTruncated && outputTruncated) return `${path}（已截断 · 输出超限）`
    if (outputTruncated) return `${path}（输出超限）`
    if (inputTruncated) return `${path}（已截断）`
    return path
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

  /**
   * 第三方库检查状态。
   *
   * 检查完成（目录树出现之前就完成）后一定有话说：没有疑似文件时也要
   * 报「已检查 N 个 · 没有需要 AI 复核的疑似文件」，否则这个能力在
   * 没触发的项目里完全看不见。失败要和「查了没有」分开，不能把没跑成
   * 显示成未发现。
   */
  const vendorNote = computed(() => {
    if (vendorCheck.value?.failed) return '第三方库检查没完成，不影响解析'
    if (vendorReview.failed.value) return 'AI 复核没跑完，只显示规则识别的结果'
    if (vendorReview.running.value) return 'AI 正在核对疑似第三方库…'

    if (vendorReview.reviewed.value > 0) {
      const suggested = files.value.filter((entry) => entry.vendorSuggestion).length
      const parts = [`AI 已核对 ${vendorReview.reviewed.value} 个疑似第三方库文件`]
      if (suggested > 0) parts.push(`建议不勾 ${suggested} 个`)
      if (vendorReview.skipped.value > 0) parts.push(`另有 ${vendorReview.skipped.value} 个未核对`)
      return parts.join(' · ')
    }

    const checked = vendorCheck.value
    if (!checked) return ''
    if (checked.probed === 0) return '没有需要 AI 复核的疑似第三方库文件'

    const rest = checked.total - checked.probed
    const suffix = rest > 0 ? `（另有 ${rest} 个未检查）` : ''
    return `已看 ${checked.probed} 个文件的文件名和文件头${suffix} · 没有需要 AI 复核的疑似第三方库文件`
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
  ): Promise<{ candidates: VendorCandidate[]; probed: number; total: number }> {
    const fileByPath = new Map(items.map((item) => [item.path, item.file]))
    const shouldProbe = files.value
      .filter(shouldProbeVendor)
      .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
    const probe = shouldProbe.slice(0, MAX_VENDOR_PROBES)

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

    return { candidates, probed: probe.length, total: shouldProbe.length }
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
    preparing.value = true
    try {
      // 先让“正在读取文件夹”这一帧画出来，再做同步建树与第三方库识别。
      // 少了这一步，主线程会被占住，转圈动画根本不动。
      await nextTick()

      resetAll()
      projectName.value = payload.root || '未命名项目'

      for (const item of payload.files) fileHandles.set(item.path, item.file)
      files.value = payload.files.map((item) =>
        makeFileEntry(item.path, item.file.size, item.file.type),
      )

      let candidates: VendorCandidate[] = []
      try {
        const checked = await detectVendorEntries(payload.files)
        candidates = checked.candidates
        vendorCheck.value = { probed: checked.probed, total: checked.total, failed: false }
      } catch {
        // 识别失败不影响上传与逐文件解析；图例里如实说没检查完
        vendorCheck.value = { probed: 0, total: 0, failed: true }
      }

      // 结构事实图只读本地文件；失败不影响上传、地图和逐文件解析
      await buildStructure()
      pool.setStructure(structure.value)

      phase.value = 'review'
      runVendorReview(candidates)

      await loadNotes()
    } finally {
      preparing.value = false
    }
  }

  function setUploadError(message: string) {
    uploadError.value = message
  }

  async function readHead(file: File): Promise<string> {
    const text = await file.slice(0, 2000).text()
    return text.split('\n').slice(0, 5).join('\n').slice(0, 600)
  }

  /**
   * 建一次项目结构事实图。
   *
   * 只读用户代码和配置，不读依赖/产物/系统文件；单文件 ≤1MB。
   * 失败就置空，逐文件解析照常走 —— 结构层是加法，不能拖垮上传。
   */
  async function buildStructure() {
    if (!structureFactsEnabled()) {
      structure.value = null
      return
    }

    const entries = files.value
      .filter(
        (entry) =>
          entry.category !== 'system' &&
          entry.size <= 1_000_000 &&
          !isBinaryFile(entry.path),
      )
      .slice(0, MAX_STRUCTURE_FILES)

    const sources: StructureSourceFile[] = []
    for (const entry of entries) {
      const file = fileHandles.get(entry.path)
      if (!file) continue
      try {
        sources.push({ path: entry.path, text: await file.text() })
      } catch {
        /* 读不到就跳过这个文件，结构图仍然是部分覆盖 */
      }
    }

    try {
      structure.value = analyzeProjectStructure(sources)
    } catch {
      structure.value = null
    }
  }

  /**
   * 核对地图 Agent 带回的引文：只把真实文件里能对上的带进项目结构结论。
   *
   * 读文件放在这里，是因为 File 句柄只在这个会话里；纯比对在 utils，
   * 这样规则可以脱离浏览器单独测。
   */
  async function verifyAgentEvidence(
    result: ProjectAgentMapResult,
  ): Promise<ProjectAgentMapResult> {
    const evidence = result.crossFileEvidence ?? []
    if (evidence.length === 0) return result

    const texts = new Map<string, string>()
    for (const path of new Set(evidence.map((item) => item.path))) {
      const file = fileHandles.get(path)
      if (!file || file.size > 1_000_000) continue
      try {
        texts.set(path, await file.text())
      } catch {
        /* 读不到就跳过这条证据，不影响地图本身 */
      }
    }

    return { ...result, crossFileEvidence: verifyEvidence(evidence, texts) }
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
      map.apply(await verifyAgentEvidence(agentResult))
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
    parsingAdditional.value = false
    activeParsingPaths.value = []

    await pool.start(sources, map.context(projectName.value))

    return true
  }

  /** 只解析当前勾选里新增的、从来没解析过的文件；旧结果不动，也不自动汇总 */
  async function parseNewSelected(): Promise<void> {
    if (parsingAdditional.value) return

    const sources = newSelected.value
      .map((entry) => ({ path: entry.path, file: fileHandles.get(entry.path) }))
      .filter((item): item is { path: string; file: File } => Boolean(item.file))

    if (sources.length === 0) return

    parsingAdditional.value = true
    activeParsingPaths.value = sources.map((item) => item.path)
    activePath.value = activePath.value ?? sources[0]!.path

    try {
      await pool.startAdditional(sources, map.context(projectName.value))
    } finally {
      parsingAdditional.value = false
    }
  }

  /** 重试当前勾选里失败的文件；由用户点，不自动触发 */
  function retryFailedSelected() {
    for (const entry of queueFiles.value) {
      const p = pool.progress[entry.path]
      if (p?.status === 'error' && p.error !== '已停止') pool.retry(entry.path)
    }
  }

  function stopParsing() {
    pool.stop()
  }

  function resumeParsing() {
    phase.value = 'parsing'
    if (activeParsingPaths.value.length > 0) pool.resumePaths(activeParsingPaths.value)
    else pool.resume()
  }

  /**
   * 把当前已完成文件拼成汇总和图共用的输入。
   * role 总长度到预算就停止加入，剩余文件数如实返回。
   */
  function buildSummaryInput(): Omit<ProjectGraphPayload, 'text'> & { skipped: number } {
    const payloadFiles: ProjectGraphPayload['files'] = []
    let used = 0
    let skipped = 0

    for (const entry of doneFiles.value) {
      const progress = pool.progress[entry.path]
      const role = summaryRoleForFile(
        thirdSection(progress?.output ?? '').slice(0, 300),
        [...(progress?.factWarnings ?? []), ...(progress?.claimWarnings ?? [])],
        progress?.hardFacts ?? [],
      )
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

    return {
      projectName: projectName.value,
      projectContext: map.context(projectName.value),
      treeText: treeToText(tree.value, 0, true),
      files: payloadFiles,
      skipped,
    }
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
    if (summary.loading.value || parsingAdditional.value) return
    if (!started.value) return

    const hasNew = newSelectedCount.value > 0

    if (partial) {
      if (doneFiles.value.length < 2 && !hasNew) return
      if (!pool.allSettled.value) pool.stop()
    } else if (!hasNew && !canGenerateSummary.value) {
      return
    }

    // 同一个按钮：先把当前勾选里新增的文件补解析，再用全部已完成文件生成
    if (hasNew) {
      await parseNewSelected()
      if (pool.stopped.value) return
      if (doneFiles.value.length === 0) return
    }

    if (partial && doneFiles.value.length < 2) return

    phase.value = 'summary'

    const input = buildSummaryInput()
    summarySkippedCount.value = input.skipped

    // 冻结这一次的输入，供「只重画图」复用；两次调用用同一批文件
    lastSummaryInput.value = {
      projectName: input.projectName,
      projectContext: input.projectContext,
      treeText: input.treeText,
      files: input.files.map((f) => ({ ...f, imports: [...f.imports] })),
      skipped: input.skipped,
    }

    // 重新生成总览时，上一轮单独重画的图和自检结果都不再适用
    graphOverride.value = null
    selfCheck.reset()
    selfCheckGraph.value = null
    selfCheckStarted.value = false
    selfCheckCoverage.value = null
    selfCheckEvidence.value = []
    selfCheckApplied.value = []
    preSelfCheckGraph.value = null
    selfCheckDiff.value = null
    selfCheckRestored.value = false

    await summary.run({
      projectName: input.projectName,
      projectContext: input.projectContext,
      treeText: input.treeText,
      files: input.files,
    })
  }

  /**
   * 只重画项目图。
   * 沿用上一次汇总冻结的输入；没有冻结输入时用当前已完成文件。
   * 成功后替换图，并重新跑图自检；失败时保留旧图。
   */
  async function runGraphOnly() {
    if (!canRunGraphOnly.value) return

    // 用户点重画图就是要换一张图；图自检还在跑时先停掉它，别让两条线抢同一张图
    if (selfCheck.running.value) selfCheck.stop()

    const frozen = lastSummaryInput.value
    const input: ProjectGraphPayload = frozen
      ? { ...frozen, text: summaryText.value }
      : { ...buildSummaryInput(), text: summaryText.value }

    const next = await graph.run(
      input,
      files.value.map((entry) => entry.path),
    )
    if (!next) return

    selfCheck.reset()
    selfCheckGraph.value = null
    selfCheckStarted.value = false
    selfCheckCoverage.value = null
    selfCheckEvidence.value = []
    selfCheckApplied.value = []
    preSelfCheckGraph.value = null
    selfCheckDiff.value = null
    selfCheckRestored.value = false

    graphOverride.value = next
    selfCheckStarted.value = true
    void runSelfCheck(next)
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
    graph = withGraphEvidence(graph)
    preSelfCheckGraph.value = null
    selfCheckDiff.value = null
    selfCheckRestored.value = false

    // 候选边只从已经解析完的文件的原文里扫；没解析的文件不参与判断，
    // 避免把“没读到”误判成“没有关系”。
    const candidateSources = files.value
      .filter((entry) => pool.progress[entry.path]?.status === 'done')
      .map((entry) => ({ path: entry.path, text: pool.textOf(entry.path) }))
      .filter((entry) => entry.text)

    const candidateScan = scanCandidateEdges(candidateSources)
    const candidateReport = compareGraphToCandidates(graph, candidateScan)
    const parseCount = filesToParse(files.value).length

    // 程序已经用事实核实过的边，旧路径也不再重复审。
    const suspicions = filterVerifiedSuspicions(graph, candidateReport.suspicions)

    if (selfCheckBatchMode.value) {
      const plan = buildSelfCheckPlan(graph, suspicions)
      if (plan.batches.length === 0) {
        selfCheckCoverage.value = {
          total: plan.total,
          checked: plan.supported,
          unknown: 0,
          conflict: 0,
          supported: plan.supported,
        }
        selfCheckGraph.value = graph
        preSelfCheckGraph.value = graph
        selfCheckDiff.value = diffProjectGraph(graph, graph)
        return
      }

      const batchResult = await selfCheck.runSelfCheckBatch({
        plan,
        projectContext: map.context(projectName.value),
        entries: files.value,
        readablePaths: filesForMap(files.value).map((entry) => entry.path),
        getFile: (path) => fileHandles.get(path),
      })

      if (batchResult) {
        const merged = mergeSelfCheckDecisions(
          graph,
          plan.items,
          batchResult.decisions,
          plan.supported,
          files.value.map((entry) => entry.path),
        )
        selfCheckGraph.value = merged.graph
        preSelfCheckGraph.value = graph
        selfCheckDiff.value = diffProjectGraph(graph, merged.graph)
        selfCheckCoverage.value = merged.coverage
        selfCheckEvidence.value = batchResult.evidence
        selfCheckApplied.value = merged.applied
      }
      return
    }

    const result = await selfCheck.runSelfCheck({
      graph,
      projectContext: map.context(projectName.value),
      entries: files.value,
      parseCount,
      readablePaths: filesForMap(files.value).map((entry) => entry.path),
      getFile: (path) => fileHandles.get(path),
      suspicions,
      candidateSummary:
        candidateScan.filesParsed > 0
          ? {
              parsed: candidateScan.filesParsed,
              edges: candidateScan.edges.length,
              supported: candidateReport.supported,
              unknown: candidateReport.unknown,
              unresolved: candidateScan.unresolved.length,
            }
          : undefined,
    })

    if (result) {
      selfCheckGraph.value = result
      preSelfCheckGraph.value = graph
      selfCheckDiff.value = diffProjectGraph(graph, result)
    }
  }

  /** 自检结果可以恢复时才显示按钮；没有改动就不需要恢复 */
  const canRestoreSelfCheck = computed(
    () =>
      !selfCheck.running.value &&
      !selfCheckRestored.value &&
      Boolean(preSelfCheckGraph.value) &&
      Boolean(selfCheckDiff.value?.changed),
  )

  /** 结构动作账本：每条决定是接受还是被拒，以及原因 */
  const selfCheckLedger = computed(() =>
    selfCheckApplied.value
      .map((row) => {
        const detail = row.conflictReason
          ? `（${row.conflictReason}）`
          : row.nodeId
            ? `（${row.nodeId}${row.node?.label ? ` → ${row.node.label}` : ''}${row.moveFilesTo ? `，文件移到 ${row.moveFilesTo}` : ''}）`
            : row.pairs?.length
              ? `（${row.pairs.map((pair) => `${pair.from}→${pair.to}`).join('，')}）`
              : row.path
                ? `（${row.path} → ${row.toNode ?? ''}）`
                : ''
        return `${row.id} ${row.action} ${row.accepted ? '接受' : '拒绝'}${detail}`
      })
      .join('\n'),
  )

  /** 轨迹里的一行结果：读了多少文件、图有没有改动 */
  const selfCheckSummary = computed(() => {
    if (selfCheck.running.value || selfCheck.error.value) return ''
    if (selfCheckRestored.value) return '已恢复自检前的图'

    if (selfCheckBatchMode.value) {
      const coverage = selfCheckCoverage.value
      if (!coverage) return ''
      const parts = [
        `已核对 ${coverage.checked}/${coverage.total} 条边`,
        `${selfCheck.rounds.value} 批`,
        `未核 ${coverage.unknown}`,
        `冲突 ${coverage.conflict}`,
      ]
      if (coverage.structural) {
        parts.push(`结构项 ${coverage.structuralChecked ?? 0}/${coverage.structural}`)
      }
      if (coverage.floating) parts.push(`浮节点 ${coverage.floating}`)
      if (coverage.groupOnly) parts.push(`分组边 ${coverage.groupOnly}`)
      if (coverage.unowned) parts.push(`未归属 ${coverage.unowned}`)
      if (coverage.duplicate) parts.push(`重复归属 ${coverage.duplicate}`)
      return `自检完成：${parts.join('，')}`
    }

    const diff = selfCheckDiff.value
    if (!diff) return ''

    const head = `自检完成：读了 ${selfCheck.readFiles.value.length} 个文件`
    if (!diff.changed) return `${head}，图没有改动`

    const parts: string[] = []
    const nodeChanges = diff.nodesAdded + diff.nodesRemoved + diff.nodesChanged
    const edgeChanges = diff.edgesAdded + diff.edgesRemoved + diff.edgesRelabeled
    const fileChanges = diff.filesAdded + diff.filesRemoved + diff.filesMoved
    if (nodeChanges) parts.push(`节点 ${nodeChanges} 处`)
    if (edgeChanges) parts.push(`边 ${edgeChanges} 处`)
    if (fileChanges) parts.push(`文件归属 ${fileChanges} 处`)

    return `${head}，${parts.join('、')}`
  })

  /** 回到自检前的那张图；不重新请求 */
  function restoreSelfCheck() {
    if (!canRestoreSelfCheck.value || !preSelfCheckGraph.value) return
    selfCheckGraph.value = preSelfCheckGraph.value
    selfCheckRestored.value = true
  }

  /**
   * 用户手动重新自检：从当前显示图去掉自检结果的那一份重来，
   * 不在上一轮的自检结果上叠改。只重画过图时，检查的是重画后的图。
   */
  async function rerunSelfCheck() {
    const graph = graphOverride.value ?? summaryGraph.value
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
    graph.stop()

    agent.reset()
    selfCheck.reset()
    vendorGeneration++
    vendorReview.reset()
    vendorCheck.value = null
    selfCheckGraph.value = null
    selfCheckStarted.value = false
    selfCheckCoverage.value = null
    selfCheckEvidence.value = []
    selfCheckApplied.value = []
    preSelfCheckGraph.value = null
    selfCheckDiff.value = null
    selfCheckRestored.value = false
    graphOverride.value = null
    lastSummaryInput.value = null
    parsingAdditional.value = false
    activeParsingPaths.value = []
    pool.setStructure(null)
    pool.reset()
    map.reset()
    summary.reset()
    graph.reset()

    files.value = []
    fileHandles.clear()
    structure.value = null
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
    preparing,
    uploadError,
    summarySkippedCount,
    // 结构事实（程序解析；没有支持的语言时为 null）
    structure,
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
    selfCheckBatchMode,
    selfCheckCoverage,
    selfCheckEvidence,
    selfCheckApplied,
    selfCheckLedger,
    selfCheckRunning: selfCheck.running,
    selfCheckStopped: selfCheck.stopped,
    selfCheckError: selfCheck.error,
    selfCheckSteps: selfCheck.steps,
    selfCheckRounds: selfCheck.rounds,
    selfCheckMaxRounds: selfCheck.maxRounds,
    selfCheckResult: selfCheck.result,
    selfCheckSummary,
    canRestoreSelfCheck,
    selfCheckRestored,
    restoreSelfCheck,
    stopSelfCheck: selfCheck.stop,
    rerunSelfCheck,
    // 并发池
    progress: pool.progress,
    /** 当前会话里某个文件的原文（已解析过才有）。项目模式追问拿它当代码上下文 */
    textOf: pool.textOf,
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
    summaryOutputTruncated: summary.outputTruncated,
    summaryError: summary.error,
    // 只重画图
    runGraphOnly,
    canRunGraphOnly,
    canShowGraphOnly,
    graphOnlyLoading: graph.loading,
    graphOnlyDone: graph.done,
    graphOnlyError: graph.error,
    graphOnlyTruncated: graph.truncated,
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
    summaryAction,
    newSelectedCount,
    failedCount,
    parsingAdditional,
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
    parseNewSelected,
    retryFailedSelected,
    generateSummary,
    generatePartialSummary,
    resetAll,
    cleanup,
    retryFile: pool.retry,
  }
}
