<script setup lang="ts">
/**
 * 术语小卡：点正文里的术语后，在它旁边浮出来的一张解释卡。
 *
 * 为什么用 Teleport 到 body：右栏是 `lg:overflow-hidden` 的，
 * 卡片留在面板内部会被**裁掉**（尤其是靠边的术语）。挂到 body 上、
 * 用 position: fixed 按视口坐标摆，就不受任何祖先的 overflow 影响。
 *
 * 定位策略：默认贴在术语下方；下方空间不够就翻到上方；左右夹在视口内。
 */
import type { GlossaryTerm } from '~/types/analysis'

const props = defineProps<{
  term: GlossaryTerm | null
  /** 被点术语的位置（视口坐标） */
  anchor: { left: number; right: number; top: number; bottom: number } | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const CARD_W = 320
const CARD_H_ESTIMATE = 170

const style = computed(() => {
  const r = props.anchor
  // SSR / 未打开时 anchor 为空，这里直接返回，避免碰到 window
  if (!r || typeof window === 'undefined') return {}

  const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - CARD_W - 8))
  const flipUp = r.bottom + CARD_H_ESTIMATE > window.innerHeight && r.top > CARD_H_ESTIMATE

  return flipUp
    ? { left: `${left}px`, bottom: `${window.innerHeight - r.top + 8}px`, width: `${CARD_W}px` }
    : { left: `${left}px`, top: `${r.bottom + 8}px`, width: `${CARD_W}px` }
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // 页面一滚动，卡片跟术语就对不上了 —— 直接收起来，比错位地飘着好
  window.addEventListener('scroll', () => emit('close'), { capture: true, passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="term" class="term-card" :style="style" role="dialog" :aria-label="`术语：${term.term}`">
      <div class="flex items-start justify-between gap-2">
        <span class="text-[13px] font-semibold text-emerald-700">{{ term.term }}</span>
        <button
          type="button"
          class="-mr-1 -mt-0.5 rounded px-1 text-slate-400 transition hover:text-slate-600"
          aria-label="关闭"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <p class="mt-1.5 text-[12.5px] leading-6 text-slate-600">{{ term.short }}</p>

      <a
        :href="term.source.url"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-2 inline-flex items-center gap-0.5 text-[11px] text-emerald-600 transition hover:text-emerald-700 hover:underline"
      >
        {{ term.source.label }} ↗
      </a>
    </div>
  </Teleport>
</template>

<style scoped>
.term-card {
  position: fixed;
  z-index: 60;
  border-radius: 0.5rem;
  border: 1px solid #d1fae5;
  background: #fff;
  padding: 0.625rem 0.75rem;
  box-shadow:
    0 8px 24px rgb(15 23 42 / 12%),
    0 2px 6px rgb(15 23 42 / 8%);
}
</style>
