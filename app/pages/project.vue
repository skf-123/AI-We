<script setup lang="ts">
import type { ProjectTreeNode } from '~/types/project'
import { useProjectSession, type ProjectSelectionPayload } from '~/composables/useProjectSession'
import { useSelectionAsk } from '~/composables/useSelectionAsk'
import { useSystemIncludeHint } from '~/composables/useSystemIncludeHint'
import { formatSize, PROJECT_LIMITS } from '~/utils/project-files'

useHead({ title: '整个项目 · 麦穗 · 代码理解助手' })

/**
 * 项目入口主页面。
 *
 * 这个文件只做排版与编排：
 *   上传区、目录树、右侧单文件结果、项目总览、按钮的接线。
 * 状态与请求全部在 useProjectSession 里（它再组合地图 / 并发池 / 汇总）；
 * 展示组件只管 props 进、事件出，不碰网络。
 */

const STEPS = ['上传项目', '勾选要解析的文件', '逐文件解析', '项目总览 + 框架图']

const {
  projectName,
  files,
  started,
  phase,
  preparing,
  uploadError,
  summarySkippedCount,
  mapSummary,
  mapDegraded,
  mapError,
  mapBackend,
  mapReadingPlan,
  notesLoading,
  agentOutcome,
  vendorNote,
  agentRunning,
  agentStopped,
  agentError,
  agentSteps,
  agentRounds,
  agentMaxRounds,
  stopAgent,
  selfCheckRunning,
  selfCheckStopped,
  selfCheckError,
  selfCheckSteps,
  selfCheckRounds,
  selfCheckMaxRounds,
  selfCheckSummary,
  canRestoreSelfCheck,
  restoreSelfCheck,
  stopSelfCheck,
  rerunSelfCheck,
  progress,
  textOf,
  total,
  finished,
  runningCount,
  allSettled,
  limit,
  poolStopped,
  summaryOutput,
  summaryLoading,
  summaryDone,
  summaryOutputTruncated,
  summaryError,
  summaryAction,
  newSelectedCount,
  failedCount,
  retryFailedSelected,
  runGraphOnly,
  canRunGraphOnly,
  canShowGraphOnly,
  graphOnlyLoading,
  graphOnlyError,
  tree,
  stats,
  queueFiles,
  activePath,
  activeProgress,
  totalBytes,
  stepIndex,
  summaryText,
  displayGraph,
  summaryHasResult,
  canGeneratePartial,
  summaryScopeNote,
  doneCount,
  selectedFolder,
  selectedGroup,
  selectionFiles,
  selectionLabel,
  crossFileNotes,
  activeTitle,
  emptyHint,
  selectProject,
  setUploadError,
  toggleFile: toggleFileState,
  toggleFolder: toggleFolderState,
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
  retryFile,
} = useProjectSession()

const analysisRef = ref<{ scrollIntoView: () => void } | null>(null)

/**
 * 项目模式追问：与贴代码页共用同一份页面状态。
 * 只接“当前文件的四段解析”，项目总览和项目图没有单一文件上下文，不接。
 */
const {
  open: askOpen,
  selection: askSelection,
  range: askRange,
  setSelection,
  close: closeAsk,
} = useSelectionAsk()

/**
 * 追问的代码上下文 = 当前文件原文。
 *
 * 与服务端 project/analyze 的 FILE_MAX 对齐：解析时看到多少，追问就带多少，
 * 否则两万到五万字符的文件会出现“能解析、不能问”。
 */
const ASK_CODE_MAX = 50_000
const activeFileText = computed(() => {
  const path = activePath.value
  return path ? textOf(path).slice(0, ASK_CODE_MAX) : ''
})

/** 当前文件刚生成的解析；带上它，回答才能和用户刚读到的说法一致 */
const activeExplanation = computed(() => activeProgress.value?.output ?? '')

// 切文件就清掉追问：旧 Range 指着上一份正文，留着会定位错，也会拖住旧 DOM。
watch(activePath, () => closeAsk())

/** 勾选系统文件前的 AI 提示；只负责请求与文案，不碰勾选状态 */
const {
  open: hintOpen,
  loading: hintLoading,
  text: hintText,
  target: hintTarget,
  ask: askHint,
  close: closeHint,
} = useSystemIncludeHint()

type PendingInclude =
  { kind: 'file'; path: string } | { kind: 'folder'; node: ProjectTreeNode } | null
const pendingInclude = ref<PendingInclude>(null)

/** 用户相关文件的选中总量上限；系统文件勾上后也计入 */
const userBudget = PROJECT_LIMITS.maxUserBytes
const overBudget = computed(() => stats.value.parseBytes > userBudget)
const uploadDialogOpen = ref(false)

function onSelect(payload: ProjectSelectionPayload) {
  uploadDialogOpen.value = false
  void selectProject(payload)
}

/** 上传失败统一用弹窗提示，不再在页面里摆一条红字 */
function onUploadError(message: string) {
  setUploadError(message)
  uploadDialogOpen.value = true
}

function onCloseUploadError() {
  uploadDialogOpen.value = false
  setUploadError('')
}

function onOpenFile(path: string) {
  openFile(path)
  scrollToAnalysis()
}

/** 勾选文件：系统文件从「不勾」到「勾」时，先问一次模型再决定 */
function onToggleFile(path: string) {
  const result = toggleFileState(path)
  if (!result.needsHint || !result.entry) return

  pendingInclude.value = { kind: 'file', path }
  void askHint({
    kind: 'file',
    path,
    label: result.entry.path,
    reason: result.entry.skipReason ?? '',
    size: result.entry.size,
  })
}

/** 勾选文件夹：目录里还有没勾的系统文件时，先弹提示 */
function onToggleFolder(node: ProjectTreeNode) {
  const result = toggleFolderState(node)
  if (!result.needsHint) return

  pendingInclude.value = { kind: 'folder', node }
  void askHint({
    kind: 'folder',
    path: node.path,
    label: node.path,
    reason: '目录里包含默认不勾的系统文件',
    count: result.systemCount ?? 0,
  })
}

function onConfirmInclude() {
  const pending = pendingInclude.value
  if (pending?.kind === 'file') includeFile(pending.path)
  else if (pending?.kind === 'folder') includeFolder(pending.node)

  pendingInclude.value = null
  closeHint()
}

function onCancelInclude() {
  pendingInclude.value = null
  closeHint()
}

function onSelectFolder(node: ProjectTreeNode) {
  selectFolder(node)
  scrollToAnalysis()
}

function onGraphSelectFile(path: string) {
  openFile(path)
  scrollToAnalysis(true)
}

function onGraphSelectGroup(id: string) {
  selectGroup(id)
  scrollToAnalysis(true)
}

async function onStart() {
  if (overBudget.value) return
  const ok = await startParsing()
  if (ok) scrollToAnalysis()
}

/** 主按钮只保留「生成 / 重新生成」两种说法；新增解析放到提示里，不再塞进按钮名 */
const summaryPrimaryLabel = computed(() => {
  if (summaryAction.value === 'parsing-new') return '正在解析新增文件…'
  if (summaryAction.value === 'retry-failed' || summaryAction.value === 'blocked')
    return '没有可生成的文件'
  return '生成总览 + 思维导图 →'
})

const regenerateLabel = computed(() => {
  if (summaryAction.value === 'parsing-new') return '正在解析新增文件…'
  if (summaryAction.value === 'retry-failed' || summaryAction.value === 'blocked')
    return '没有可生成的文件'
  return '重新生成总览 + 思维导图 →'
})

const canRunSummaryPrimary = computed(
  () => summaryAction.value === 'parse-new' || summaryAction.value === 'generate',
)

/** 重新生成：全部完成后用完整输入，否则用已完成文件；新增文件由 runSummary 先补解析 */
function onRegenerate() {
  if (allSettled.value) void generateSummary()
  else void generatePartialSummary()
}

/** 项目图在页面下方，从图里选中后把右侧面板带回视野 */
function scrollToAnalysis(always = false) {
  if (always || window.matchMedia('(max-width: 1023px)').matches) {
    nextTick(() => analysisRef.value?.scrollIntoView())
  }
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (started.value && !allSettled.value && !summaryDone.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  cleanup()
})
</script>

<template>
  <div class="min-h-dvh bg-[#f5f6f8] text-slate-800">
    <!-- 顶栏（三个页面共用） -->
    <SiteHeader active="project" />

    <main class="mx-auto w-full max-w-[1400px] px-4 py-4 sm:px-6 sm:py-6">
      <!-- 步骤条 -->
      <div class="mb-4 flex flex-wrap items-center gap-y-2 text-xs text-slate-400">
        <template v-for="(step, i) in STEPS" :key="step">
          <div class="flex items-center gap-2">
            <span
              class="grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold"
              :class="{
                'bg-emerald-500 text-white': i === stepIndex,
                'bg-emerald-50 text-emerald-700': i < stepIndex,
                'bg-slate-200 text-slate-500': i > stepIndex,
              }"
            >
              {{ i < stepIndex ? '✓' : i + 1 }}
            </span>
            <span :class="{ 'font-semibold text-slate-800': i === stepIndex }">{{ step }}</span>
          </div>
          <span v-if="i < STEPS.length - 1" class="mx-3 hidden h-px w-8 bg-slate-200 sm:block" />
        </template>

        <NuxtLink
          to="/"
          class="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
        >
          返回首页
        </NuxtLink>
      </div>

      <!-- 上传 -->
      <template v-if="phase === 'upload'">
        <ProjectUploader :busy="preparing" @select="onSelect" @error="onUploadError" />

        <p class="mt-4 px-1 text-xs leading-relaxed text-slate-400">
          项目不会上传到任何存储：文件只在浏览器里读取，解析结果也只留在当前页面。
        </p>
      </template>

      <!-- 目录树 + 逐文件结果 -->
      <template v-else>
        <!--
          桌面端左栏目录树的最大高度与解析结果面板原来的最大高度一致：
          树达到上限后在卡片内部滚动，右侧跟着同一高度走。
          否则目录树越长，整页和右侧空白就被一起拉得越高。
        -->
        <div class="grid gap-4 lg:grid-cols-2 lg:items-stretch">
          <section
            class="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:flex lg:flex-col"
          >
            <div class="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 py-3.5">
              <div
                class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-sm font-bold text-white"
              >
                {{ projectName.slice(0, 2) }}
              </div>
              <div class="min-w-0">
                <h1 class="truncate text-base font-semibold text-slate-800">
                  {{ projectName }}
                </h1>
                <p class="mt-0.5 text-xs text-slate-400">
                  {{ files.length }} 个文件 · {{ formatSize(totalBytes) }}
                  <span v-if="mapSummary"> · {{ mapSummary }}</span>
                </p>
                <p v-if="mapBackend" class="mt-0.5 text-[11px] text-slate-400">
                  {{ mapBackend.hasBackend ? '有后端' : '没有后端' }}
                  <template v-if="mapBackend.evidence"> · {{ mapBackend.evidence }}</template>
                </p>
                <p v-if="mapReadingPlan.length" class="mt-0.5 text-[11px] text-slate-400">
                  建议先读：{{ mapReadingPlan.slice(0, 3).join(' → ') }}
                </p>
              </div>
              <button
                type="button"
                class="ml-auto shrink-0 text-xs text-slate-400 hover:text-slate-700"
                @click="resetAll"
              >
                重新选择
              </button>
            </div>

            <div
              v-if="mapError"
              class="shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-700"
            >
              {{ mapError }}
            </div>

            <AgentTrace
              v-if="agentRunning || agentSteps.length || agentError"
              :steps="agentSteps"
              :running="agentRunning"
              :stopped="agentStopped"
              :error="agentError"
              :round="agentRounds"
              :max-rounds="agentMaxRounds"
              :fallback="Boolean(agentError && mapSummary)"
              :outcome="agentOutcome"
              @stop="stopAgent"
            />

            <ProjectTree
              :nodes="tree"
              :progress="progress"
              :loading-notes="notesLoading"
              :notes-degraded="mapDegraded"
              :selected-folder="selectedFolder"
              :active-path="activePath"
              :vendor-note="vendorNote"
              @toggle-file="onToggleFile"
              @toggle-folder="onToggleFolder"
              @set-mode="setFileMode"
              @uncheck="uncheckSuggested"
              @open-file="onOpenFile"
              @retry="retryFile"
              @select-folder="onSelectFolder"
            />

            <div
              v-if="overBudget"
              class="shrink-0 border-t border-rose-100 bg-rose-50 px-4 py-2.5 text-[11.5px] leading-relaxed text-rose-700"
            >
              选中的用户相关文件共 {{ formatSize(stats.parseBytes) }}，超过
              {{ formatSize(userBudget) }} 上限。请取消一些文件后再开始解析。
            </div>

            <div
              class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 px-4 py-3"
            >
              <span class="text-xs text-slate-500">
                <b class="text-slate-800">{{ stats.parseCount }}</b> 个文件会解析 +
                <b class="text-slate-800">{{ stats.contextCount }}</b> 个仅作上下文
                <span v-if="stats.systemCount" class="text-slate-400">
                  · 其中系统文件 {{ stats.systemCount }} 个</span
                >
                <span :class="overBudget ? 'font-medium text-rose-600' : 'text-slate-400'">
                  · {{ formatSize(stats.parseBytes) }} / {{ formatSize(userBudget) }}</span
                >
              </span>
              <span class="text-xs text-slate-400">
                跳过 {{ stats.skippedCount }} 个文件 · 约 {{ formatSize(stats.skippedBytes) }}
              </span>

              <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
                <template v-if="!started">
                  <button
                    type="button"
                    class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                    :disabled="queueFiles.length === 0 || notesLoading || overBudget"
                    @click="onStart"
                  >
                    {{ notesLoading ? 'Agent 正在侦查项目…' : '开始解析 →' }}
                  </button>
                </template>

                <template v-else>
                  <span class="text-xs text-slate-500">
                    {{ finished }} / {{ total }} · 并发 {{ limit }}
                    <span v-if="runningCount > 0">· 在飞 {{ runningCount }}</span>
                  </span>
                  <button
                    v-if="!poolStopped && !allSettled"
                    type="button"
                    class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    @click="stopParsing"
                  >
                    停止
                  </button>
                  <button
                    v-else-if="poolStopped"
                    type="button"
                    class="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                    @click="resumeParsing"
                  >
                    继续解析
                  </button>

                  <button
                    v-if="!summaryLoading && (summaryHasResult || !allSettled)"
                    type="button"
                    class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    :disabled="
                      summaryHasResult ? !canRunSummaryPrimary : !canGeneratePartial
                    "
                    :title="
                      summaryHasResult
                        ? '重新生成项目总览和思维导图；有新增文件会先解析新增'
                        : poolStopped
                          ? '用已完成文件生成项目总览和思维导图'
                          : '点击后会停止剩余解析，用已完成的文件生成'
                    "
                    @click="summaryHasResult ? onRegenerate() : generatePartialSummary()"
                  >
                    {{
                      summaryHasResult
                        ? regenerateLabel
                        : poolStopped
                          ? '生成项目总览 + 思维导图'
                          : `生成思维导图（用已完成的 ${doneCount} 个）`
                    }}
                  </button>
                  <span v-else-if="!allSettled && doneCount === 1" class="text-xs text-slate-500">
                    再解析 1 个文件就可以生成项目图
                  </span>
                  <span v-else-if="!allSettled && doneCount === 0" class="text-xs text-slate-400">
                    还没有成功解析的文件
                  </span>
                </template>

                <NuxtLink
                  to="/"
                  class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  返回首页
                </NuxtLink>
              </div>
            </div>

            <p class="shrink-0 px-4 pb-3 text-[11px] text-slate-400">解析结果只保存在当前页面，刷新会丢。</p>
          </section>

          <div class="relative min-w-0 lg:min-h-0">
            <div class="flex min-w-0 flex-col gap-2 lg:absolute lg:inset-0 lg:min-h-0">
              <!-- 选中文件夹 / 项目图分组时，右侧先列出范围内的文件；点一下切过去 -->
              <div
                v-if="selectionFiles.length > 1"
                class="shrink-0 rounded-xl border border-slate-200 bg-white p-2 shadow-sm"
              >
                <div class="flex flex-wrap items-center gap-2 px-1 pb-1.5">
                  <span class="min-w-0 truncate text-[11px] text-slate-400">{{
                    selectionLabel
                  }}</span>
                  <span class="text-[11px] text-slate-400"
                    >· {{ selectionFiles.length }} 个文件</span
                  >
                  <span class="ml-auto text-[10px] text-slate-300">点文件切换右侧结果</span>
                </div>

                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="file in selectionFiles"
                    :key="file.path"
                    type="button"
                    class="max-w-full truncate rounded-md border px-2 py-1 font-mono text-[10.5px] transition"
                    :class="
                      file.path === activePath
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                    "
                    :title="file.path"
                    @click="onOpenFile(file.path)"
                  >
                    {{ file.name }}
                  </button>
                </div>

                <details v-if="crossFileNotes.length" class="mt-2 border-t border-slate-100 pt-2">
                  <summary class="cursor-pointer select-none text-[11px] text-slate-500">
                    跨文件线索（各文件第三段，共 {{ crossFileNotes.length }} 条）
                  </summary>
                  <div class="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
                    <div v-for="note in crossFileNotes" :key="note.path">
                      <p class="truncate font-mono text-[10px] text-slate-400" :title="note.path">
                        {{ note.path }}
                      </p>
                      <p class="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">
                        {{ note.text }}
                      </p>
                    </div>
                  </div>
                </details>
              </div>

              <AnalysisPanel
                ref="analysisRef"
                class="min-h-0 flex-1"
                :output="activeProgress?.output ?? ''"
                :sources="activeProgress?.sources ?? []"
                :error-msg="activeProgress?.error ?? ''"
                :loading="
                  activeProgress?.status === 'running' ||
                  (started && activeProgress?.status === 'pending')
                "
                :done="activeProgress?.status === 'done'"
                :graph-ready="false"
                :subtitle="activeTitle"
                :empty-hint="emptyHint"
                :output-truncated="activeProgress?.outputTruncated ?? false"
                fill-height
                @selection="setSelection"
              />
            </div>
          </div>
        </div>

        <!-- 全部解析完 → 手动生成项目总览与项目图 -->
        <section
          v-if="started && allSettled && !summaryHasResult && !summaryLoading"
          class="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 sm:px-5"
        >
          <div class="min-w-0">
            <p class="text-sm font-semibold text-emerald-800">
              {{
                newSelectedCount > 0
                  ? '有新增文件还没解析'
                  : doneCount > 0
                    ? '全部文件已解析完'
                    : '没有成功解析的文件'
              }}
            </p>
            <p class="mt-0.5 text-xs text-emerald-700/80">
              <template v-if="newSelectedCount > 0">
                当前勾选：已完成 {{ doneCount }} 个、新增 {{ newSelectedCount }} 个待解析。
                点下面的按钮会先解析新增的，再生成；不想解析就取消勾选新增文件。
              </template>
              <template v-else-if="doneCount > 0">
                将基于已完成的 {{ doneCount }} 个文件，生成一段项目总览和唯一一张项目图。
              </template>
              <template v-else> 可以先重试失败的文件，再生成项目总览。 </template>
            </p>
          </div>
          <div class="ml-auto flex flex-wrap items-center gap-3">
            <button
              v-if="newSelectedCount === 0 && failedCount > 0 && doneCount === 0"
              type="button"
              class="text-xs text-rose-600 underline-offset-2 hover:underline"
              @click="retryFailedSelected"
            >
              重试失败的 {{ failedCount }} 个文件
            </button>
            <button
              type="button"
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              :disabled="!canRunSummaryPrimary"
              @click="generateSummary"
            >
              {{ summaryPrimaryLabel }}
            </button>
          </div>
        </section>

        <!-- 项目总览 -->
        <section
          v-if="phase === 'summary' || summaryOutput || summaryError"
          class="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
        >
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <h2 class="text-sm text-slate-500">项目总览</h2>
            <span
              v-if="summaryLoading"
              class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
            >
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              正在汇总
            </span>
            <span
              v-else-if="summaryDone && !summaryError"
              class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
            >
              已完成
            </span>
            <span class="text-[11px] text-slate-400">
              只出这一张项目图；展开 / 收起不重新请求
            </span>
            <button
              v-if="canShowGraphOnly"
              type="button"
              class="ml-auto rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              :disabled="!canRunGraphOnly || newSelectedCount > 0"
              :title="
                newSelectedCount > 0
                  ? '只重画图使用上次汇总的文件，不包含新增；请先解析新增文件'
                  : graphOnlyLoading
                    ? '项目图正在生成'
                    : selfCheckRunning
                      ? '图自检正在跑；点它会先停止自检，再只重画项目图'
                      : displayGraph
                        ? '只重画项目图，项目总览正文保持不变；沿用上次汇总的文件；想以任选节点生图，请点「重新生成总览 + 思维导图」'
                        : '图生成失败时，重画项目图；沿用上次汇总的文件，新图再失败仍保留原图；想以任选节点生图，请点「重新生成总览 + 思维导图」'
              "
              @click="runGraphOnly"
            >
              {{
                graphOnlyLoading
                  ? '项目图生成中…'
                  : displayGraph
                    ? '只重画项目图'
                    : graphOnlyError || (summaryDone && !displayGraph)
                      ? '重画项目图'
                      : '只生成项目图'
              }}
            </button>
          </div>

          <p v-if="summarySkippedCount > 0" class="mb-3 text-[11px] text-amber-700">
            另有 {{ summarySkippedCount }} 个文件超出本次汇总的输入预算，未纳入。
          </p>
          <p v-if="summaryScopeNote" class="mb-3 text-[11px] text-amber-700">
            {{ summaryScopeNote }}
            <button
              v-if="!summaryLoading && failedCount > 0 && doneCount === 0"
              type="button"
              class="ml-2 underline underline-offset-2 hover:text-amber-900"
              @click="retryFailedSelected"
            >
              重试失败的 {{ failedCount }} 个
            </button>
          </p>
          <p v-if="summaryOutputTruncated" class="mb-3 text-[11px] text-amber-700">
            这次汇总输出到达上限，正文或项目图可能没有讲完。
          </p>
          <p v-if="graphOnlyError" class="mb-3 text-[11px] text-rose-600">
            {{ displayGraph ? '这次图没生成成功，仍显示上一次的图。' : '' }}{{ graphOnlyError }}
          </p>

          <div
            v-if="summaryError"
            class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {{ summaryError }}
          </div>

          <article v-if="summaryText" class="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
            <MarkdownBlock :text="summaryText" />
          </article>

          <!-- 图自检：有轨迹、可打断；失败就保留原图 -->
          <AgentTrace
            v-if="
              selfCheckRunning ||
              selfCheckStopped ||
              selfCheckRounds > 0 ||
              selfCheckSteps.length ||
              selfCheckError
            "
            title="图自检"
            error-text="自检未完成，保留原图"
            :steps="selfCheckSteps"
            :running="selfCheckRunning"
            :stopped="selfCheckStopped"
            :error="selfCheckError"
            :round="selfCheckRounds"
            :max-rounds="selfCheckMaxRounds"
            :rerun="!selfCheckRunning"
            rerun-label="重新自检"
            :status-text="selfCheckSummary"
            :can-restore="canRestoreSelfCheck"
            @stop="stopSelfCheck"
            @rerun="rerunSelfCheck"
            @restore="restoreSelfCheck"
          />

          <div v-if="displayGraph" class="mt-4">
            <ProjectGraph
              :data="displayGraph"
              :selected-group="selectedGroup"
              :active-path="activePath"
              @select-file="onGraphSelectFile"
              @select-group="onGraphSelectGroup"
            />
          </div>
          <p v-else-if="graphOnlyLoading" class="mt-3 text-xs text-slate-500">
            图生成中…
          </p>
          <p v-else-if="summaryDone && !displayGraph" class="mt-3 text-xs text-amber-700">
            {{
              summaryOutputTruncated
                ? '项目图内容太长，被输出上限截断；上面的项目文字仍然有效。'
                : '项目图没有解析成功，上面的项目文字仍然有效。'
            }}
          </p>
        </section>
      </template>

      <footer class="px-1 pb-2 pt-5 text-center text-xs text-slate-400">
        麦穗团队 · 传智杯 AI Web 开发挑战赛
      </footer>
    </main>

    <!-- 勾选系统文件前的 AI 提示；纯展示组件，勾选动作由页面执行 -->
    <ConfirmIncludeDialog
      :open="hintOpen"
      :title="hintTarget?.label ?? ''"
      :text="hintText"
      :loading="hintLoading"
      @confirm="onConfirmInclude"
      @cancel="onCancelInclude"
    />

    <!-- 上传失败：用弹窗提示，避免页面里的红字被忽略 -->
    <UploadErrorDialog
      :open="uploadDialogOpen"
      :message="uploadError"
      @close="onCloseUploadError"
    />

    <!--
      当前文件的就地追问。选区来自右侧四段解析面板；
      代码上下文是当前文件原文，解析正文也一并带上。
    -->
    <SelectionAsk
      v-model:open="askOpen"
      :selection="askSelection"
      :range="askRange"
      :code="activeFileText"
      :explanation="activeExplanation"
      scope-hint="模型能看到当前文件的代码，问题不必只限于选中的几行。"
      @close="closeAsk"
    />
  </div>
</template>
