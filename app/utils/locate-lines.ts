/**
 * 从「用户在解析结果里选中的文字」推出「它对应原始代码的第几行」。
 *
 * 两条路，按可靠性排序：
 *
 *   1. **锚点**：模型在「逐词逐句」里写的 `**第 7 行**` 就是**原始代码的真实行号**，
 *      markdown-terms.ts 已经把行号写进 DOM 的 data-line-start / data-line-end。
 *      从选区所在的节点往上找一个带这个属性的段落就行 —— 精确、零成本。
 *
 *   2. **文本匹配**：锚点找不到时（比如用户在「技术溯源」里选了一句），
 *      拿选中的文字去原始代码里找对得上的行。
 *
 * 都落空就返回空数组：**不高亮、不报错**，与 RAG 那条降级路径同一个态度。
 *
 * ⚠️ 锚点的文法在 app/utils/markdown-terms.ts 里（LINE_ANCHOR_RE），
 *    两边必须共用同一套 —— 各写一份迟早会改一边漏一边。
 */

export interface LineHit {
  /** 命中的原始代码行号（1 起），升序 */
  lines: number[]
  /** 命中的方式，排查时用 */
  via: 'anchor' | 'text' | 'none'
}

/** 把代码按行拆开（保留行号） */
function codeLines(codeText: string): { no: number; text: string }[] {
  return codeText.split('\n').map((text, i) => ({ no: i + 1, text: text.trim() }))
}

/**
 * 文本兜底：把选中的文字逐行去空白，到原始代码里按顺序找对得上的行。
 *
 * 用「游标只往前走」的方式匹配，而不是每行独立全表搜索 ——
 * 这样选中的是连续几行时，找出来的也一定是连续且顺序正确的几行。
 */
export function matchCodeLines(selectedText: string, codeText: string): number[] {
  const picked = selectedText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (picked.length === 0) return []

  const lines = codeLines(codeText)
  const hits: number[] = []
  let cursor = 0

  for (const want of picked) {
    let found = -1
    for (let i = cursor; i < lines.length; i++) {
      if (lines[i]!.text === want) {
        found = i
        break
      }
    }
    if (found === -1) {
      // 某一行对不上就整段放弃，避免"匹配到一半"给出错位的行号
      hits.length = 0
      break
    }
    hits.push(lines[found]!.no)
    cursor = found + 1
  }

  if (hits.length > 0) return hits

  // 逐行对不上，再试一次：选中的可能只是某一行里的一小段（比如一个标识符）
  const whole = selectedText.trim()
  if (whole.length >= 2 && !whole.includes('\n')) {
    const found = lines.filter((l) => l.text.includes(whole))
    // 命中行太多说明这个词太常见，给出来反而是噪音
    if (found.length > 0 && found.length <= 3) return found.map((l) => l.no)
  }

  return []
}

/**
 * 汇总：锚点优先，文本兜底。
 *
 * @param selectedText 用户在页面上选中的文字
 * @param anchorLines  从 DOM 锚点拿到的行号（没有就传 null）
 * @param codeText     左栏里的原始代码
 */
export function resolveLines(
  selectedText: string,
  anchorLines: number[] | null,
  codeText: string,
): LineHit {
  if (anchorLines && anchorLines.length > 0) {
    return { lines: anchorLines, via: 'anchor' }
  }

  const lines = matchCodeLines(selectedText, codeText)
  return lines.length > 0 ? { lines, via: 'text' } : { lines: [], via: 'none' }
}

/** 从 a 到 b 的行号（含两端），用于 `第 7-10 行` 这种区间锚点 */
export function rangeLines(start: number, end: number): number[] {
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
}
