<script setup lang="ts">
/**
 * 首页的两个入口卡片。
 *
 * 纯展示：图标、标题、一句话说明、标签和按钮文案全部从 props 进。
 * 它不认识路由 —— 链接由首页包在外面，卡片本身不 import 任何页面。
 *
 * 注意：整张卡是 NuxtLink，里面的按钮只能用 span 做样式，
 * 不能嵌真正的 button，否则 HTML 不合法，点击也会和链接打架。
 */
defineProps<{
  title: string
  description: string
  tag: string
  cta: string
  icon: 'code' | 'project'
}>()
</script>

<template>
  <div
    class="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg sm:p-7"
  >
    <span
      class="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"
      aria-hidden="true"
    >
      <AppIcon :name="icon" class="h-5 w-5" />
    </span>

    <h3 class="mt-5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
      {{ title }}
    </h3>
    <p class="mt-2 text-sm leading-relaxed text-slate-500">{{ description }}</p>

    <span
      class="mt-3 w-fit rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
    >
      {{ tag }}
    </span>

    <div class="mt-auto pt-7">
      <span
        class="flex w-full items-center justify-center gap-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition group-hover:bg-emerald-500"
      >
        {{ cta }}
        <span class="transition-transform duration-200 group-hover:translate-x-1">→</span>
      </span>
    </div>
  </div>
</template>
