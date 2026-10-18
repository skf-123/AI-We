<script setup lang="ts">
/**
 * 上传失败的提示弹窗。
 *
 * 纯展示：开不开、显示什么由页面决定；只把「知道了」抛回去。
 */
const props = defineProps<{
  open: boolean
  message: string
  title?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-error-title"
      @click.self="emit('close')"
    >
      <div class="w-full max-w-md rounded-xl border border-rose-100 bg-white p-5 shadow-xl">
        <div class="flex items-start gap-3">
          <span
            class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-50 text-sm font-semibold text-rose-600"
          >
            !
          </span>
          <div class="min-w-0">
            <h2 id="upload-error-title" class="text-base font-semibold text-slate-900">
              {{ props.title || '无法读取这个文件夹' }}
            </h2>
            <p class="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
              {{ props.message }}
            </p>
          </div>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-900"
            autofocus
            @click="emit('close')"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
