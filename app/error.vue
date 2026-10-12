<script setup lang="ts">
import type { NuxtError } from '#app'

/**
 * 全局错误页（Nuxt 约定文件，放在 app/ 下）。
 *
 * 有它之前，任何服务端错误 —— 接口挂了、页面渲染出错 —— 都会落到
 * Nuxt 自带的英文错误页（"500 Internal Server Error"），
 * 对一个面向「自学编程的人」的产品来说很劝退。
 *
 * 这里只做三件事：把状态码翻译成人话、给一个明确的下一步、保持和主页一致的视觉。
 *
 * ⚠️ 刻意不显示 error.stack —— 那是给开发者的，
 * 用户看了只会觉得"这网站坏了"。
 */
const props = defineProps<{ error: NuxtError }>()

/** 把状态码翻译成用户看得懂的一句话 */
const friendlyMessage = computed(() => {
  const status = props.error?.statusCode

  if (status === 404) return '这个地址不存在，可能是链接输错了。'
  if (status === 403) return '没有权限访问这个页面。'
  if (status >= 500) return '服务端出了点问题，稍等一会儿再试试。'

  return props.error?.message || '出了点意外情况，回首页再试一次吧。'
})

function goHome() {
  // clearError 是 Nuxt 自动导入的：清掉错误状态，再跳回首页
  clearError({ redirect: '/' })
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-[#f5f6f8] px-6 py-12">
    <div class="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p class="font-mono-code text-4xl font-semibold text-slate-300 sm:text-5xl">
        {{ error?.statusCode || '出错了' }}
      </p>

      <h1 class="mt-4 text-base font-semibold text-slate-900 sm:text-lg">页面没能打开</h1>
      <p class="mt-2 text-sm leading-6 text-slate-600">{{ friendlyMessage }}</p>

      <button
        type="button"
        class="mt-6 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-300 focus:outline-none"
        @click="goHome"
      >
        返回首页
      </button>
    </div>
  </div>
</template>
