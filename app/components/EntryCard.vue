<script setup lang="ts">
/**
 * 首页的两个入口卡片。
 *
 * 纯展示：标题、适合谁、能得到什么全部从 props 进。
 * 它不认识路由 —— 链接由首页包在外面，卡片本身不 import 任何页面。
 */
defineProps<{
  eyebrow: string
  title: string
  fit: string
  points: string[]
  tone?: 'emerald' | 'indigo'
}>()
</script>

<template>
  <div
    class="group flex h-full flex-col rounded-2xl border bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg sm:p-7"
    :class="
      tone === 'indigo'
        ? 'border-indigo-100 hover:border-indigo-200'
        : 'border-emerald-100 hover:border-emerald-200'
    "
  >
    <span
      class="w-fit rounded-full px-2.5 py-1 text-[11px] font-medium"
      :class="tone === 'indigo' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-700'"
    >
      {{ eyebrow }}
    </span>

    <h3 class="mt-4 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
      {{ title }}
    </h3>
    <p class="mt-2 text-sm leading-relaxed text-slate-500">{{ fit }}</p>

    <ul class="mt-5 space-y-2.5">
      <li
        v-for="point in points"
        :key="point"
        class="flex gap-2 text-sm leading-relaxed text-slate-600"
      >
        <span
          class="mt-0.5 shrink-0 font-semibold"
          :class="tone === 'indigo' ? 'text-indigo-500' : 'text-emerald-500'"
        >
          ✓
        </span>
        <span>{{ point }}</span>
      </li>
    </ul>

    <div
      class="mt-auto flex items-center pt-7 text-sm font-medium"
      :class="tone === 'indigo' ? 'text-indigo-600' : 'text-emerald-700'"
    >
      进入
      <span class="ml-1 transition-transform duration-200 group-hover:translate-x-1">→</span>
    </div>
  </div>
</template>
