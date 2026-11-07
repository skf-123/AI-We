<script setup lang="ts">
/**
 * 代码与数据说明、能力边界。
 *
 * 首页底部和项目上传页共用。纯展示，不读状态、不发请求。
 * 文案必须和实际行为一致：文件在浏览器里读，解析片段会发给模型，服务端不留存。
 */
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <article class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex items-center gap-3">
        <span
          class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600"
          aria-hidden="true"
        >
          <AppIcon name="shield" class="h-5 w-5" />
        </span>
        <h3 class="text-lg font-semibold text-slate-800">关于你的代码与数据</h3>
      </div>
      <p class="mt-3 text-sm leading-relaxed text-slate-500">
        项目文件在浏览器侧读取，不写入服务器文件存储或数据库。为完成 AI
        分析，本次选中的必要文本片段会发送给模型服务。分析结果保留在当前浏览器页面，刷新后清空。
      </p>
    </article>

    <article class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex items-center gap-3">
        <span
          class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500"
          aria-hidden="true"
        >
          <AppIcon name="info" class="h-5 w-5" />
        </span>
        <h3 class="text-lg font-semibold text-slate-800">能力说明</h3>
      </div>
      <p class="mt-3 text-sm leading-relaxed text-slate-500">
        麦穗主要提供静态代码理解与项目结构辅助阅读，不等同于代码运行、动态调试或完整安全审计。对于缺乏证据支持的关系，会保留不确定标记。
      </p>
    </article>
  </div>
</template>
