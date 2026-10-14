/**
 * 一个 markdown-it 插件，给正文里的三样东西打上可点的标记：
 *
 *   1. **术语**   —— 命中词表的词（只在传了词表的段落生效，即「四、技术溯源」）
 *   2. **引用编号** —— `[1]` `[2]`，点了联动到下面的引用卡片
 *   3. **行号锚点** —— 把 `**第 7 行**` 这种段落打上 data-line-start，
 *                      供「选中正文 → 左栏对应行高亮」使用
 *
 * ── 为什么只改写 text token ──
 * 术语和引用都只在 `text` 类型的 token 上做替换，因此**天然跳过**
 * `code_inline` 和 `fence` —— 代码里的 `PEP8`、`arr[1]` 不会被误标。
 *
 * ── 与 html:false 的关系（重要）──
 * MarkdownBlock 用 `html: false` 渲染，意思是**模型输出的原始 HTML 不会被当 HTML 解析**
 * （防注入）。这里注入的元素是我们自己拼的：词表内容经过 escapeHtml，
 * 只有固定的标签和属性名，不改变那条安全前提。
 */
import type MarkdownIt from 'markdown-it'
import type { GlossaryTerm } from '~/types/analysis'

/** markdown-it 的 Token 类型（避免从深层路径 import 类型，那样容易随版本失效） */
type Token = ReturnType<MarkdownIt['parse']>[number]

/**
 * 行号锚点的文法：`第 7 行` / `第 15-16 行` / `第 3~5 行`。
 *
 * ⚠️ **这个常量必须与选区定位那一侧共用同一套文法**（app/utils/locate-lines.ts）。
 *    两边各写一份正则，迟早会改一边漏一边，然后"选中有时候能定位、有时候不能"。
 *
 * 开头的 `\*{0,2}` 是为了同时在两种文本上工作：
 *   · markdown 源里是 `**第 7 行**`
 *   · 渲染出来的纯文本里是 `第 7 行`
 */
export const LINE_ANCHOR_RE = /\*{0,2}第\s*(\d+)\s*(?:[-~–—至]\s*(\d+)\s*)?行/

/** 段落以行号锚点开头时才打属性（锚点在句中不算） */
const LINE_ANCHOR_AT_START_RE = /^\s*\*{0,2}第\s*(\d+)\s*(?:[-~–—至]\s*(\d+)\s*)?行/

/** 引用编号 */
const CITE_RE = /\[\d{1,2}\]/y

/** 渲染时通过 env 传进来的东西（一个插件实例服务所有段落，由调用方决定这一段的配置） */
export interface TermPluginEnv {
  /** 词表。不传或为空 ⇒ 这一段不做术语标记（引用编号仍然会标） */
  terms?: GlossaryTerm[]
  /** 是否给段落打行号锚点，默认开 */
  anchors?: boolean
}

interface Needle {
  /** 命中后回传给上层的标识（用词条的主词形） */
  key: string
  /** 粘性正则：把 lastIndex 设到某处，就能问"这里是不是命中" */
  test: RegExp
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 纯 ASCII 的词需要词边界，否则 `ES5` 会命中 `ES5x`、`API` 会命中 `APIs` */
const isAsciiWord = (s: string) => /^[A-Za-z][A-Za-z0-9]*$/.test(s)

/**
 * 把词表摊平成一串"针"。
 * 长的排在前面：文本是 `PEP 318` 时，`PEP 318` 要抢在 `PEP` 前面命中。
 */
function makeNeedles(terms: GlossaryTerm[]): Needle[] {
  const needles: Needle[] = []

  for (const entry of terms) {
    const forms = [entry.term, ...(entry.aliases ?? [])]
    for (const form of forms) {
      const ascii = isAsciiWord(form)
      // numbered：词后面允许跟一个编号，整体算一处
      const body = entry.numbered ? `${escapeRe(form)}\\s+\\d+` : escapeRe(form)
      const pattern = `${ascii ? '(?<![A-Za-z0-9_])' : ''}${body}${ascii ? '(?![A-Za-z0-9_])' : ''}`
      needles.push({ key: entry.term, test: new RegExp(pattern, 'y') })
    }
  }

  // 按"针"的模式长度倒序，长的先试
  return needles.sort((a, b) => b.test.source.length - a.test.source.length)
}

function makeText(state: { Token: new (type: string, tag: string, nesting: number) => Token }, content: string): Token {
  const token = new state.Token('text', '', 0)
  token.content = content
  return token
}

/**
 * 把一段文本按词表切碎：命中的部分变成 wb_term token，其余保持 text。
 * 顺带处理引用编号。
 */
function splitText(
  state: { Token: new (type: string, tag: string, nesting: number) => Token },
  token: Token,
  needles: Needle[],
): Token[] {
  const src = token.content
  const out: Token[] = []
  let plain = ''
  let i = 0

  const flush = () => {
    if (plain) {
      out.push(makeText(state, plain))
      plain = ''
    }
  }

  while (i < src.length) {
    let hit: { key: string; text: string } | null = null

    for (const needle of needles) {
      needle.test.lastIndex = i
      const m = needle.test.exec(src)
      if (m) {
        hit = { key: needle.key, text: m[0] }
        break
      }
    }

    if (hit) {
      flush()
      const t = new state.Token('wb_term', '', 0)
      t.content = hit.text
      t.meta = { key: hit.key }
      out.push(t)
      i += hit.text.length
      continue
    }

    CITE_RE.lastIndex = i
    const cite = CITE_RE.exec(src)
    if (cite) {
      flush()
      const t = new state.Token('wb_cite', '', 0)
      // content 保留方括号原文 —— 页面上的文字必须一字不改，
      // 样式是加在外面的，不是把原文换掉
      t.content = cite[0]
      t.meta = { index: Number(cite[0].slice(1, -1)) }
      out.push(t)
      i += cite[0].length
      continue
    }

    plain += src[i]
    i += 1
  }

  flush()
  return out
}

/** 给以行号锚点开头的段落打上 data-line-start / data-line-end */
function markLineAnchors(tokens: Token[]) {
  for (let i = 0; i < tokens.length - 1; i++) {
    const open = tokens[i]
    const inline = tokens[i + 1]
    if (open?.type !== 'paragraph_open' || inline?.type !== 'inline') continue

    const m = LINE_ANCHOR_AT_START_RE.exec(inline.content)
    if (!m) continue

    open.attrs = [
      ...(open.attrs ?? []),
      ['data-line-start', m[1]!],
      ['data-line-end', m[2] ?? m[1]!],
    ]
  }
}

export function termPlugin(md: MarkdownIt) {
  // ---- 渲染规则：术语 ----
  md.renderer.rules.wb_term = (tokens, idx) => {
    const token = tokens[idx]!
    const key = String(token.meta?.key ?? '')
    return `<span class="term" data-term="${md.utils.escapeHtml(key)}">${md.utils.escapeHtml(token.content)}</span>`
  }

  // ---- 渲染规则：引用编号 ----
  md.renderer.rules.wb_cite = (tokens, idx) => {
    const token = tokens[idx]!
    const index = String(token.meta?.index ?? '')
    return `<span class="cite" data-cite="${md.utils.escapeHtml(index)}">${md.utils.escapeHtml(token.content)}</span>`
  }

  // ---- 解析后处理 ----
  md.core.ruler.push('wb_terms', (state) => {
    const env = (state.env ?? {}) as TermPluginEnv

    // 行号锚点：与词表无关，只要开就都标（它不改变任何可见文字）
    if (env.anchors !== false) markLineAnchors(state.tokens)

    const terms = env.terms ?? []
    const needles = terms.length > 0 ? makeNeedles(terms) : []
    // 没有词表也要继续：引用编号在所有段落都要可点
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue
      const next: Token[] = []
      for (const child of token.children) {
        if (child.type !== 'text') {
          next.push(child)
          continue
        }
        next.push(...splitText(state, child, needles))
      }
      token.children = next
    }
  })
}
