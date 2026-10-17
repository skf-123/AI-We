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

const ACTIVE_CLASS = 'rounded-full bg-white px-3 py-1 font-medium text-emerald-700 shadow-sm'
const IDLE_CLASS = 'rounded-full px-3 py-1 text-slate-500 transition hover:text-slate-800'
</script>

<template>
  <header class="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
    <div class="mx-auto flex max-w-[1400px] items-center justify-between gap-3">
      <NuxtLink to="/" class="flex min-w-0 items-baseline gap-3">
        <span class="truncate text-lg font-semibold tracking-wide text-slate-900">
          麦穗 · 代码理解助手
        </span>
        <span class="hidden text-xs text-slate-400 sm:block">WheatBend</span>
      </NuxtLink>

      <nav
        v-if="active !== 'home'"
        class="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 p-1 text-xs"
      >
        <NuxtLink to="/code" :class="active === 'code' ? ACTIVE_CLASS : IDLE_CLASS">
          贴代码
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
    </div>
  </header>
</template>
