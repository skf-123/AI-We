<script setup lang="ts">
import type { ProjectFileEntry, FileProgress, ProjectTreeNode, ConfigMode } from '~/types/project'
import { allSystem, formatSize, isBinaryFile } from '~/utils/project-files'

/**
 * 目录树的单个节点（文件夹或文件），递归渲染。
 *
 * 这个组件只管展示与转发事件：勾选、切换配置角色、打开文件都往上传，
 * 状态（哪些勾了、解析到哪一步）由页面和 composable 决定。
 */

const props = defineProps<{
  node: ProjectTreeNode
  progress: Record<string, FileProgress>
  depth: number
  /** 当前文件夹是否展开。展开状态由 ProjectTree 统一持有，这里只读 */
  open: boolean
  /** 所有文件夹的展开状态，递归往下传 */
  openMap: Record<string, boolean>
  /** 当前选中的文件夹 */
  selectedFolder?: string | null
  /** 当前展示的文件 */
  activePath?: string | null
}>()

const emit = defineEmits<{
  (e: 'toggle-file' | 'open-file' | 'retry' | 'toggle-open', path: string): void
  (e: 'toggle-folder' | 'select-folder', node: ProjectTreeNode): void
  (e: 'set-mode', path: string, mode: ConfigMode): void
}>()

const isFile = computed(() => props.node.type === 'file')
const isSystemFolder = computed(() => !isFile.value && allSystem(props.node))

const folderChecked = computed(
  () => props.node.selectableCount > 0 && props.node.selectedCount === props.node.selectableCount,
)
const folderIndeterminate = computed(
  () => props.node.selectedCount > 0 && props.node.selectedCount < props.node.selectableCount,
)

/** 只有顶层文件夹显示三类标签；容器目录（src/main/com）不写，避免一长串废话 */
const folderCategory = computed<'user' | 'config' | 'system' | null>(() => {
  if (isFile.value || props.depth !== 0) return null
  if (isSystemFolder.value) return 'system'

  const found = new Set<string>()
  const walk = (node: ProjectTreeNode) => {
    if (node.type === 'file') {
      if (node.file && node.file.category !== 'system') found.add(node.file.category)
      return
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(props.node)

  if (found.has('user')) return 'user'
  if (found.has('config')) return 'config'
  return null
})

const file = computed<ProjectFileEntry | undefined>(() => props.node.file)
const pg = computed<FileProgress | undefined>(() => props.progress[props.node.path])

/** 当前文件的角色；配置和系统文件共用同一个切换控件 */
const modeValue = computed<ConfigMode>(() => {
  if (!file.value) return 'context'
  return file.value.category === 'system' ? file.value.systemMode : file.value.configMode
})

/** 系统文件里的二进制：只能作上下文，不能逐行解释 */
const binarySystem = computed(
  () => file.value?.category === 'system' && isBinaryFile(file.value.path),
)

const showModeSwitch = computed(
  () =>
    Boolean(file.value?.include) &&
    (file.value?.category === 'config' || file.value?.category === 'system'),
)

const statusText = computed(() => {
  if (!pg.value) return ''
  if (pg.value.status === 'running') return '解析中'
  if (pg.value.status === 'done') return '已完成'
  if (pg.value.status === 'error') return '失败'
  return '待解析'
})

function onFolderCheck() {
  emit('toggle-folder', props.node)
}

function onFileCheck() {
  if (!file.value) return
  emit('toggle-file', props.node.path)
}
</script>

<template>
  <li>
    <!-- 文件夹 -->
    <div
      v-if="!isFile"
      class="flex min-h-[31px] items-center gap-2 rounded-lg px-2 py-1"
      :class="{
        'bg-emerald-50 ring-1 ring-emerald-200': selectedFolder === node.path,
        'hover:bg-slate-50': selectedFolder !== node.path,
        'opacity-65': isSystemFolder,
      }"
    >
      <input
        type="checkbox"
        class="h-3.5 w-3.5 shrink-0 accent-emerald-500"
        :checked="folderChecked"
        :indeterminate.prop="folderIndeterminate"
        :disabled="node.selectableCount === 0"
        @change="onFolderCheck"
      />
      <button
        type="button"
        class="w-3 shrink-0 text-[10px] text-slate-400"
        :aria-label="open ? '收起' : '展开'"
        @click="emit('toggle-open', node.path)"
      >
        {{ open ? '▾' : '▸' }}
      </button>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        class="h-4 w-4 shrink-0 text-slate-400"
      >
        <path
          d="M1.8 4.2c0-.7.6-1.2 1.2-1.2h3.1l1.3 1.4h5.6c.7 0 1.2.5 1.2 1.2v6.2c0 .7-.5 1.2-1.2 1.2H3c-.6 0-1.2-.5-1.2-1.2V4.2Z"
        />
      </svg>
      <button
        type="button"
        class="truncate text-[13px] font-semibold text-slate-700"
        @click="emit('select-folder', node)"
      >
        {{ node.name }}
      </button>

      <span
        v-if="folderCategory"
        class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        :class="{
          'bg-emerald-50 text-emerald-700': folderCategory === 'user',
          'bg-indigo-50 text-indigo-600': folderCategory === 'config',
          'bg-slate-100 text-slate-500': folderCategory === 'system',
        }"
      >
        {{ folderCategory === 'user' ? '用户' : folderCategory === 'config' ? '配置' : '系统' }}
      </span>

      <span v-if="node.note" class="hidden min-w-0 truncate text-[11.5px] text-slate-400 sm:block">
        {{ node.note }}
      </span>

      <span class="ml-auto shrink-0 text-[11px] text-slate-400">
        {{ node.fileCount }} 个文件 · {{ formatSize(node.size) }}
      </span>
    </div>

    <!-- 文件夹子节点 -->
    <ul v-if="!isFile && open && node.children?.length" class="ml-5 border-l border-slate-100 pl-1">
      <ProjectTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :progress="progress"
        :depth="depth + 1"
        :open="openMap[child.path] ?? true"
        :open-map="openMap"
        :selected-folder="selectedFolder"
        :active-path="activePath"
        @toggle-file="(p) => emit('toggle-file', p)"
        @toggle-folder="(n) => emit('toggle-folder', n)"
        @set-mode="(p, m) => emit('set-mode', p, m)"
        @open-file="(p) => emit('open-file', p)"
        @retry="(p) => emit('retry', p)"
        @toggle-open="(p) => emit('toggle-open', p)"
        @select-folder="(n) => emit('select-folder', n)"
      />
    </ul>

    <!-- 文件 -->
    <div
      v-if="isFile"
      class="flex min-h-[31px] items-center gap-2 rounded-lg px-2 py-1"
      :class="{
        'bg-emerald-50 ring-1 ring-emerald-200': activePath === node.path,
        'hover:bg-slate-50': activePath !== node.path,
        'opacity-60': file?.category === 'system',
      }"
    >
      <input
        type="checkbox"
        class="h-3.5 w-3.5 shrink-0 accent-emerald-500"
        :checked="file?.include"
        @change="onFileCheck"
      />

      <span
        class="ml-1 h-1.5 w-1.5 shrink-0 rounded-full"
        :class="{
          'bg-emerald-500': file?.category === 'user',
          'bg-indigo-400': file?.category === 'config',
          'bg-slate-300': file?.category === 'system',
        }"
      />

      <button
        type="button"
        class="shrink-0 font-mono text-[12.5px] text-slate-700 hover:text-emerald-700"
        @click="emit('open-file', node.path)"
      >
        {{ node.name }}
      </button>

      <span
        v-if="file?.unrecorded"
        class="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
        title="知识库未收录这门语言：仍然解析，但没有引用来源"
      >
        ⚠ 未收录语言
      </span>

      <span v-if="node.note" class="hidden min-w-0 truncate text-[11.5px] text-slate-400 sm:block">
        {{ node.note }}
      </span>

      <!-- 配置 / 系统文件：仅作上下文 / 仍需解释 -->
      <span
        v-if="showModeSwitch"
        class="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[10px]"
      >
        <button
          type="button"
          class="rounded px-1.5 py-0.5"
          :class="
            modeValue === 'context'
              ? 'bg-white font-semibold text-indigo-600 shadow-sm'
              : 'text-slate-400'
          "
          @click.stop="emit('set-mode', node.path, 'context')"
        >
          仅作上下文
        </button>
        <button
          type="button"
          class="rounded px-1.5 py-0.5 disabled:cursor-not-allowed disabled:text-slate-300"
          :class="
            modeValue === 'explain'
              ? 'bg-white font-semibold text-indigo-600 shadow-sm'
              : 'text-slate-400'
          "
          :disabled="binarySystem"
          :title="binarySystem ? '二进制文件无法逐行解释，只能作上下文' : '把它送进逐文件解析'"
          @click.stop="emit('set-mode', node.path, 'explain')"
        >
          仍需解释
        </button>
      </span>

      <!-- 解析状态 -->
      <span
        v-if="pg"
        class="ml-auto shrink-0 text-[10.5px]"
        :class="{
          'text-slate-400': pg.status === 'pending',
          'text-emerald-600': pg.status === 'running',
          'text-slate-500': pg.status === 'done',
          'text-rose-600': pg.status === 'error',
        }"
      >
        <span
          v-if="pg.status === 'running'"
          class="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"
        />
        {{ statusText }}
      </span>

      <span
        v-if="pg?.truncated"
        class="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
        title="文件超过 50000 字符，服务端只分析了前 50000 字符"
      >
        已截断
      </span>

      <button
        v-if="pg?.status === 'error'"
        type="button"
        class="shrink-0 text-[10.5px] text-rose-600 underline-offset-2 hover:underline"
        :title="pg.error"
        @click.stop="emit('retry', node.path)"
      >
        重试
      </button>

      <span
        v-if="file?.category === 'system' && !file.include && file.skipReason"
        class="ml-auto shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
      >
        默认不勾：{{ file.skipReason }}
      </span>

      <span
        v-else-if="file?.category !== 'config' && !pg"
        class="ml-auto shrink-0 text-[11px] text-slate-400"
      >
        {{ formatSize(node.size) }}
      </span>
      <span
        v-else-if="file?.category === 'config' && !pg"
        class="shrink-0 text-[11px] text-slate-400"
      >
        {{ formatSize(node.size) }}
      </span>
    </div>
  </li>
</template>
