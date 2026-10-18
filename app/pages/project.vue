<script setup lang="ts">
import type { ProjectTreeNode } from '~/types/project'
import { useProjectSession, type ProjectSelectionPayload } from '~/composables/useProjectSession'
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
  stopSelfCheck,
  rerunSelfCheck,
  progress,
  total,
  finished,
  runningCount,
  allSettled,
  limit,
  poolStopped,
  summaryOutput,
  summaryLoading,
  summaryDone,
  summaryError,
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
  canGenerateSummary,
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

function onSelect(payload: ProjectSelectionPayload) {
  void selectProject(payload)
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

/** 重新生成：全部完成后用完整输入，否则用已完成文件 */
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
        <ProjectUploader @select="onSelect" @error="setUploadError" />

        <div
          v-if="uploadError"
          class="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {{ uploadError }}
        </div>

        <p class="mt-4 px-1 text-xs leading-relaxed text-slate-400">
          项目不会上传到任何存储：文件只在浏览器里读取，解析结果也只留在当前页面。
        </p>
      </template>

      <!-- 目录树 + 逐文件结果 -->
      <template v-else>
        <div class="grid gap-4 lg:grid-cols-2 lg:items-stretch">
          <section
            class="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div class="flex items-start gap-3 border-b border-slate-100 px-4 py-3.5">
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
              class="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-700"
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
              class="border-t border-rose-100 bg-rose-50 px-4 py-2.5 text-[11.5px] leading-relaxed text-rose-700"
            >
              选中的用户相关文件共 {{ formatSize(stats.parseBytes) }}，超过
              {{ formatSize(userBudget) }} 上限。请取消一些文件后再开始解析。
            </div>

            <div
              class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 px-4 py-3"
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
                    v-if="!allSettled && canGeneratePartial"
                    type="button"
                    class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    @click="generatePartialSummary"
                  >
                    {{ poolStopped ? '用已完成的生成总览 + 图' : '不再解析，用已完成的生成' }}
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

            <p class="px-4 pb-3 text-[11px] text-slate-400">解析结果只保存在当前页面，刷新会丢。</p>
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
                fill-height
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
              {{ doneCount > 0 ? '全部文件已解析完' : '没有成功解析的文件' }}
            </p>
            <p class="mt-0.5 text-xs text-emerald-700/80">
              <template v-if="doneCount > 0">
                将基于已完成的 {{ doneCount }} /
                {{ total }} 个文件，生成一段项目总览和唯一一张项目图。
              </template>
              <template v-else> 可以先重试失败的文件，再生成项目总览。 </template>
            </p>
          </div>
          <button
            type="button"
            class="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            :disabled="!canGenerateSummary"
            @click="generateSummary"
          >
            生成项目总览 + 项目图 →
          </button>
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
              v-if="!summaryLoading && (canGenerateSummary || canGeneratePartial)"
              type="button"
              class="ml-auto text-xs text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
              :disabled="!(canGenerateSummary || canGeneratePartial)"
              @click="onRegenerate"
            >
              重新生成
            </button>
          </div>

          <p v-if="summarySkippedCount > 0" class="mb-3 text-[11px] text-amber-700">
            另有 {{ summarySkippedCount }} 个文件超出本次汇总的输入预算，未纳入。
          </p>
          <p v-if="summaryScopeNote" class="mb-3 text-[11px] text-amber-700">
            {{ summaryScopeNote }}
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
            @stop="stopSelfCheck"
            @rerun="rerunSelfCheck"
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
          <p v-else-if="summaryDone && !displayGraph" class="mt-3 text-xs text-amber-700">
            项目图没有解析成功，上面的项目文字仍然有效。
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
  </div>
</template>
