<script setup lang="ts">
import MarkdownIt from 'markdown-it'

/**
 * 把模型输出的 Markdown 渲染成 HTML。
 *
 * 为什么需要它：提示词要求模型输出 `## 小标题`、`- 列表`、```代码块```、`**强调**`，
 * 而渲染前这些标记是**原样显示**给用户的 —— 一个讲代码的产品，
 * 第一眼看到的却是一堆源码符号。
 *
 * ⚠️ 安全：`html: false` 是关键 —— 模型输出里若混进 `<script>` 之类，
 *    会被当成普通文本转义掉，不会执行。链接另有 markdown-it 内置的
 *    `javascript:` 协议拦截。所以这里的 v-html 是可控的。
 *
 * 实现放在 computed 里：流式过程中每来一块内容重算一次。
 * 正文只有几 KB，markdown-it 是毫秒级，不必额外节流。
 */
const props = defineProps<{ text: string }>()

const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
})

const html = computed(() => md.render(props.text ?? ''))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- 见上方注释：html:false 已关闭原始 HTML 透传 -->
  <div class="md-body break-words" v-html="html" />
</template>
