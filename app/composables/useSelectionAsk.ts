/**
 * 追问的页面级状态：选中了什么、气泡开没开。
 *
 * 只搬「页面这一侧」的东西：
 *   · 对话、请求、流式、历史仍由 SelectionAsk 自己持有，这里不碰；
 *   · 左栏行号高亮留在页面（项目模式没有代码栏）；
 *   · 气泡位置、滚动、焦点留在组件。
 *
 * 这么切的原因：两个页面共用的是“选区怎么存、什么时候清、什么时候开”，
 * 而这几条恰好是之前踩过坑的地方（空选区、面板开着时来了新选区）。
 * 让它们只有一个实现，页面各写各的高亮与上下文。
 *
 * ⚠️ 每次调用返回独立的一组 ref，不做全局单例：
 *    否则两个页面的选区会串在一起。
 */

export interface SelectionPayload {
  text: string
  anchorLines: number[] | null
  range: Range | null
}

export function useSelectionAsk() {
  const open = ref(false)
  const selection = ref('')
  const range = ref<Range | null>(null)

  /**
   * 接收结果面板抛上来的选区。
   *
   * - 空选区（点了空白处）→ 关掉并清空；
   * - 气泡开着的时候不跟着新选区跑 —— 用户正在问，顺手又划了一段，
   *   不该把面板从他拖到的位置拽走（与原来 code.vue 里的行为一致）。
   */
  function setSelection(payload: SelectionPayload) {
    if (!payload.text) {
      close()
      return
    }
    if (open.value) return
    selection.value = payload.text
    range.value = payload.range
  }

  function openAsk() {
    if (!selection.value) return
    open.value = true
  }

  /**
   * 关掉气泡并清空选区。
   *
   * 切文件 / 开始新一轮解析时也要调它：Range 是指向正文 DOM 的，
   * 正文一换，旧的 Range 就悬空了 —— 轻则定位失效，重则让旧 DOM 迟迟不能回收。
   */
  function close() {
    open.value = false
    selection.value = ''
    range.value = null
  }

  return { open, selection, range, setSelection, openAsk, close }
}
