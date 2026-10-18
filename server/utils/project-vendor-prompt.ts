/**
 * 第三方库候选评审的提示词。
 *
 * 程序已经筛过一轮，这里只让模型看「规则拿不准」的文件头，
 * 输出建议而不是分类结果。文件头由浏览器读取，服务端不落盘。
 */

export const PROJECT_VENDOR_REVIEW_SYSTEM_PROMPT = `你是「麦穗 · 代码理解助手」的项目文件分类助手。程序已经筛出一些规则拿不准的源码文件：它们可能是第三方库，也可能是用户自己写的。请只根据给出的文件头判断。

# 判断依据

- 文件头里的许可证注释、库名、版本号、作者、版权声明
- 典型库的代码结构（UMD / AMD 包装、jQuery 的 jQuery.fn、Bootstrap 的插件注册等）
- 只有明确证据才判断是第三方库；拿不准就不要输出

# 输出

只输出一个 JSON 对象，不要 Markdown 代码围栏、不要解释文字：

{"suggestions":[{"path":"原样复制的路径","isVendor":true,"evidence":"不超过 40 字的依据"}]}

规则：
- path 必须原样复制输入里的路径
- 只输出 isVendor 为 true 的条目；不确定的就不要输出
- evidence 写看到了什么，例如「文件头是 jQuery v3.7.1」
- 不要编造文件头里没有的内容`

/** 把候选路径和文件头拼成一次用户消息 */
export function buildVendorReviewPrompt(candidates: { path: string; header: string }[]): string {
  const blocks = candidates.map((item, index) => {
    const header = item.header.trim() || '（空文件头）'
    return `## ${index + 1}. ${item.path}\n\n${header.slice(0, 1500)}`
  })

  return `下面 ${candidates.length} 个文件是候选。逐个判断它们是否像第三方库，并按系统提示的 JSON 结构输出。

${blocks.join('\n\n')}`
}
