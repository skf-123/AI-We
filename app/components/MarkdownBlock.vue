<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import type { GlossaryTerm } from '~/types/analysis'
import { termPlugin } from '~/utils/markdown-terms'

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
 *    （termPlugin 会额外注入自己的元素，但内容经过转义、标签也是固定的，
 *     不改变上面这条前提 —— 详见 app/utils/markdown-terms.ts 的说明。）
 *
 * 实现放在 computed 里：流式过程中每来一块内容重算一次。
 * 正文只有几 KB，markdown-it 是毫秒级，不必额外节流。
 */
const props = defineProps<{
  text: string
  /**
   * 术语词表。**正文的每一段都会传**（判据见 AnalysisPanel 里 terms 的注释）。
   * 不传或传空 ⇒ 这一段不做术语标记，但引用编号仍然可点。
   */
  terms?: GlossaryTerm[]
}>()

const emit = defineEmits<{
  /** 术语被点了。顺带把它的位置带出去，上层用它在旁边浮出解释卡 */
  (e: 'term', payload: { key: string; rect: DOMRect }): void
  (e: 'cite', index: number): void
}>()

const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
})
md.use(termPlugin)

const html = computed(() => md.render(props.text ?? '', { terms: props.terms }))

/**
 * v-html 造出来的节点绑不了 Vue 的事件，所以在容器上做一次**事件委托**：
 * 从被点到的元素往上找最近的那个带 data-term / data-cite 的祖先。
 */
function onClick(e: MouseEvent) {
  const hit = (e.target as HTMLElement | null)?.closest?.('[data-term], [data-cite]')
  if (!hit) return

  const term = hit.getAttribute('data-term')
  if (term) {
    emit('term', { key: term, rect: hit.getBoundingClientRect() })
    return
  }

  const cite = hit.getAttribute('data-cite')
  if (cite !== null) emit('cite', Number(cite))
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- 见上方注释：html:false 已关闭原始 HTML 透传 -->
  <div class="md-body break-words" @click="onClick" v-html="html" />
</template>
