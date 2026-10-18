<script setup lang="ts">
/**
 * 勾选系统文件前的提示弹窗。
 *
 * 纯展示：开不开、显示什么、要不要等，都由页面和 useSystemIncludeHint 决定。
 * 这里只负责把「仍然勾选 / 取消」两个动作抛出去。
 */

const props = defineProps<{
  open: boolean
  title: string
  text: string
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm' | 'cancel'): void
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="include-hint-title"
      @click.self="emit('cancel')"
    >
      <div class="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div class="flex items-start gap-3">
          <span
            class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-sm text-amber-600"
          >
            !
          </span>
          <div class="min-w-0">
            <h2 id="include-hint-title" class="text-base font-semibold text-slate-900">
              建议先别勾选
            </h2>
            <p
              class="mt-0.5 min-w-0 truncate font-mono text-[11px] text-slate-400"
              :title="props.title"
            >
              {{ props.title }}
            </p>
          </div>
        </div>

        <div
          class="mt-3 min-h-[72px] rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600"
        >
          <span v-if="props.loading" class="inline-flex items-center gap-2 text-slate-400">
            <span
              class="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500"
            />
            正在判断为什么默认不勾…
          </span>
          <span v-else>{{ props.text }}</span>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50"
            @click="emit('cancel')"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            :disabled="props.loading"
            @click="emit('confirm')"
          >
            仍然勾选
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
