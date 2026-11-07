<script setup lang="ts">
import { formatSize, normalizePath, PROJECT_LIMITS, stripCommonRoot } from '~/utils/project-files'

/**
 * 项目入口的上传区（第一里程碑只做文件夹，zip 在第二里程碑）。
 *
 * 两条路都收：
 *   · 点选：input[webkitdirectory]，webkitRelativePath 自带相对路径
 *   · 拖入：DataTransferItem.webkitGetAsEntry 递归读目录
 * 两条路都不需要解压，也不需要额外的 zip 依赖。
 *
 * 上限在这里先挡一次（整个文件夹 1 GB / 文件数 50000），免得把浏览器拖死；
 * 用户相关文件的选中总量 1.9 MB 预算在纯函数与页面里算，和这两个上限不是一回事。
 */

const props = defineProps<{
  /**
   * 父组件正在建树 / 识别第三方库。
   * 和拖拽时的 reading 合成同一个忙碌状态；手机上文件多时这段最明显。
   */
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', payload: { root: string; files: { path: string; file: File }[] }): void
  (e: 'error', message: string): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const reading = ref(false)

/** 已经拿到的文件数与总大小；拿不到时显示一句“请稍等” */
const picked = ref<{ count: number; size: number } | null>(null)

const isBusy = computed(() => Boolean(props.busy) || reading.value)

/**
 * 让浏览器先画一帧，再交给父组件做同步建树。
 *
 * 只 await nextTick 不够：它只保证 DOM 更新，不保证浏览器真的画出来；
 * 紧接着的同步映射会把主线程占住，转圈和文件数就来不及显示。
 * rAF 在后台标签页可能不触发，加一个超时兜底。
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
    setTimeout(resolve, 50)
  })
}

function pick() {
  inputRef.value?.click()
}

function readEntry(entry: FileSystemEntry): Promise<{ path: string; file: File }[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      ;(entry as FileSystemFileEntry).file(
        (file) => resolve([{ path: entry.fullPath.replace(/^\//, ''), file }]),
        (err) => reject(err),
      )
    })
  }

  const dir = entry as FileSystemDirectoryEntry
  const reader = dir.createReader()

  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = []

    // readEntries 一次最多给 100 条，要反复读到空为止
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          Promise.all(entries.map(readEntry))
            .then((groups) => resolve(groups.flat()))
            .catch(reject)
          return
        }
        entries.push(...batch)
        readBatch()
      }, reject)
    }

    readBatch()
  })
}

async function onDrop(e: DragEvent) {
  dragging.value = false
  if (isBusy.value) return

  reading.value = true
  picked.value = null

  try {
    const transfer = e.dataTransfer
    const items = transfer?.items

    const entries: FileSystemEntry[] = []
    if (items) {
      for (const item of Array.from(items)) {
        const entry = item.webkitGetAsEntry?.()
        if (entry) entries.push(entry)
      }
    }

    if (entries.length > 0) {
      const groups = await Promise.all(entries.map(readEntry))
      const flat = groups.flat()
      picked.value = {
        count: flat.length,
        size: flat.reduce((sum, item) => sum + item.file.size, 0),
      }
      // 让文件数与转圈先画一帧，再交给父组件做同步建树
      await nextTick()
      await nextPaint()
      emitFiles(flat)
      return
    }

    // 浏览器不支持目录 API 时的兜底：只能拿到平铺的文件，没有相对路径
    const flat = transfer?.files
    if (flat && flat.length > 0) {
      const files = Array.from(flat)
      picked.value = {
        count: files.length,
        size: files.reduce((sum, file) => sum + file.size, 0),
      }
      await nextTick()
      await nextPaint()
      emitFiles(files.map((file) => ({ path: file.name, file })))
      return
    }

    emit('error', '没有读到文件。请拖入一个文件夹，或点下面的按钮选择。')
  } catch (err) {
    emit('error', `读取文件夹失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    reading.value = false
  }
}

async function onInputChange(e: Event) {
  const list = (e.target as HTMLInputElement).files
  if (!list || list.length === 0) return

  const files = Array.from(list)
  reading.value = true
  picked.value = {
    count: files.length,
    size: files.reduce((sum, file) => sum + file.size, 0),
  }

  // 先让转圈和文件数画出来，再做同步映射与父组件的建树
  await nextTick()
  await nextPaint()

  emitFiles(
    files.map((file) => ({
      path: file.webkitRelativePath || file.name,
      file,
    })),
  )

  reading.value = false
  // 允许再次选择同一个文件夹
  ;(e.target as HTMLInputElement).value = ''
}

function emitFiles(raw: { path: string; file: File }[]) {
  const normalized = raw.map((item) => ({ path: normalizePath(item.path), file: item.file }))

  if (normalized.length === 0) {
    emit('error', '这个文件夹是空的。')
    return
  }

  // 第一版只做文件夹；拖进来一个压缩包时明确说清楚，别让它变成「未命名项目」
  const archive = /\.(zip|rar|7z|tar|tgz|gz)$/i
  if (normalized.length === 1 && archive.test(normalized[0]!.path)) {
    emit('error', '第一版只支持拖入文件夹；zip 压缩包在后续版本支持。')
    return
  }
  if (normalized.length > PROJECT_LIMITS.maxFiles) {
    emit('error', `文件太多了（${normalized.length} 个），上限是 ${PROJECT_LIMITS.maxFiles} 个。`)
    return
  }

  const total = normalized.reduce((sum, item) => sum + item.file.size, 0)
  if (total > PROJECT_LIMITS.maxTotal) {
    emit(
      'error',
      `项目太大了（${formatSize(total)}），上限是 ${formatSize(PROJECT_LIMITS.maxTotal)}。`,
    )
    return
  }

  const stripped = stripCommonRoot(normalized.map((item) => item.path))
  const files = normalized.map((item, i) => ({ path: stripped.paths[i]!, file: item.file }))

  emit('select', { root: stripped.root, files })
}
</script>

<template>
  <section
    class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    :aria-busy="isBusy"
  >
    <div
      class="flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition sm:py-12"
      :class="dragging ? 'border-emerald-400 bg-emerald-50/60' : 'border-slate-200 bg-slate-50/60'"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <div
        class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"
      >
        <span
          v-if="isBusy"
          class="h-6 w-6 animate-spin rounded-full border-[3px] border-emerald-500 border-t-transparent"
          aria-hidden="true"
        />
        <AppIcon v-else name="upload" class="h-6 w-6" />
      </div>

      <p class="text-base font-semibold text-slate-800" role="status" aria-live="polite">
        {{ isBusy ? '正在读取文件夹…' : '将项目文件夹拖到这里' }}
      </p>

      <template v-if="isBusy">
        <p class="mt-1.5 text-sm text-slate-500">
          <template v-if="picked">
            {{ picked.count }} 个文件 · 约 {{ formatSize(picked.size) }}
          </template>
          <template v-else>文件多的时候会慢一点，请稍等</template>
        </p>
        <p class="mt-1 text-xs text-slate-400">文件只在浏览器里读取</p>
      </template>

      <template v-else>
        <p class="mt-1.5 text-sm text-slate-500">也可以点击下方按钮选择本地文件夹</p>
        <button
          type="button"
          class="mt-4 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500"
          @click="pick"
        >
          选择文件夹
        </button>
        <p class="mt-3 text-xs text-slate-400">
          支持的项目目录原始大小不超过 {{ formatSize(PROJECT_LIMITS.maxTotal) }}，文件数不超过
          {{ PROJECT_LIMITS.maxFiles.toLocaleString() }}
        </p>
      </template>

      <input
        ref="inputRef"
        type="file"
        webkitdirectory
        multiple
        class="hidden"
        @change="onInputChange"
      />
    </div>

    <p class="mt-4 text-xs leading-relaxed text-slate-400">
      依赖（node_modules / target / .idea 等）只登记位置，不会上传给模型。用户相关文件选中总量上限
      1.9 MB（依赖 / 产物不计入）。zip 压缩包在后续版本支持。
    </p>

    <div class="mt-6 border-t border-slate-100 pt-5">
      <h3 class="text-sm font-semibold text-slate-800">麦穗将为你完成</h3>
      <ul class="mt-3 grid gap-2 text-sm text-slate-500 sm:grid-cols-2">
        <li class="flex items-center gap-2">
          <AppIcon name="project" class="h-4 w-4 shrink-0 text-emerald-600" />
          识别项目目录与配置线索
        </li>
        <li class="flex items-center gap-2">
          <AppIcon name="code" class="h-4 w-4 shrink-0 text-emerald-600" />
          筛选文件并逐个理解源码
        </li>
        <li class="flex items-center gap-2">
          <AppIcon name="book" class="h-4 w-4 shrink-0 text-emerald-600" />
          生成项目整体说明
        </li>
        <li class="flex items-center gap-2">
          <AppIcon name="graph" class="h-4 w-4 shrink-0 text-emerald-600" />
          构建可交互的项目关系图
        </li>
      </ul>
    </div>
  </section>
</template>
