/**
 * 流式输出里夹带的元信息，客户端和服务端共用。
 *
 * 为什么用标记、不用响应头：响应头必须在开始流式输出之前发出去，
 * 而 finish_reason（上游告诉我们为什么停下来）在最后一块数据里才知道。
 * 所以只能在流末尾追加一个标记，前端读到后把它去掉，并设置「输出已截断」。
 *
 * 标记只用不可见字符，避免在正文末尾闪一下。
 */
export const OUTPUT_TRUNCATED_MARKER = String.fromCharCode(0, 0x2063, 0, 0x2063, 0)

/** 从流式文本里去掉截断标记；返回去掉后的文本和是否撞过上限 */
export function stripOutputTruncation(text: string): { text: string; truncated: boolean } {
  if (!text.includes(OUTPUT_TRUNCATED_MARKER)) {
    return { text, truncated: false }
  }

  return {
    text: text.split(OUTPUT_TRUNCATED_MARKER).join(''),
    truncated: true,
  }
}
