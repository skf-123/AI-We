<script setup lang="ts">
/**
 * 三个页面共用的顶栏。
 *
 * 只认两样东西：品牌链接、当前在哪个入口。
 * 它不 import 任何页面、不持有业务状态 —— 页面之间因此没有互相引用。
 */
defineProps<{
  /** 当前所在的入口，决定导航哪一项高亮 */
  active?: 'home' | 'code' | 'project'
}>()

const settingsOpen = ref(false)

const ACTIVE_CLASS = 'rounded-full bg-white px-3 py-1 font-medium text-emerald-700 shadow-sm'
const IDLE_CLASS = 'rounded-full px-3 py-1 text-slate-500 transition hover:text-slate-800'
</script>

<template>
  <header class="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
    <div class="mx-auto flex max-w-[1400px] items-center justify-between gap-3">
      <NuxtLink to="/" class="flex min-w-0 items-baseline gap-3">
        <span class="truncate text-base font-semibold tracking-wide text-slate-900 sm:text-lg">
          麦穗 · 代码理解助手
        </span>
        <span class="hidden text-xs text-slate-400 sm:block">WheatBend</span>
      </NuxtLink>

      <div class="flex shrink-0 items-center gap-2">
        <nav
          v-if="active !== 'home'"
          class="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 p-1 text-xs"
        >
          <NuxtLink to="/code" :class="active === 'code' ? ACTIVE_CLASS : IDLE_CLASS">
            复制代码
          </NuxtLink>
          <NuxtLink to="/project" :class="active === 'project' ? ACTIVE_CLASS : IDLE_CLASS">
            整个项目
          </NuxtLink>
        </nav>

        <NuxtLink
          v-else
          to="/code"
          class="shrink-0 rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-600"
        >
          开始使用 →
        </NuxtLink>

        <button
          type="button"
          class="shrink-0 rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
          aria-label="设置"
          title="设置"
          @click="settingsOpen = true"
        >
          <svg
            viewBox="0 0 24 24"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
            />
          </svg>
        </button>
      </div>

      <SettingsDialog v-model:open="settingsOpen" />
    </div>
  </header>
</template>
