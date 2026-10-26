/**
 * 逐文件输出里的跨文件事实块：
 *   · 从流式文本里把它剥掉，不让用户看到；
 *   · 用当前文件的原文核对 path / line / quote；
 *   · 对不上的标 unverified，不删正文，也不假装核对过。
 *
 * 这是最小可验证版：只核对“引文能不能在当前文件里找到”，
 * 不判断 claim 的业务语义，也不重写正文。
 */

import type { FactCheck, FactClaim, FactFix, VerifiedFact } from '~/types/facts'
import type { HardFact } from '~/types/structure'

export const FACTS_START = '<!--facts'
export const FACTS_END = '-->'

export interface FactsBlockResult {
  /** 去掉事实块之后、可以显示给用户的正文 */
  text: string
  /** 事实块完整闭合且 JSON 合法时才有值 */
  claims: FactClaim[] | null
  /** 事实块还没闭合，后面可能还有内容 */
  pending: boolean
  error?: string
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function parseClaims(raw: string): { claims: FactClaim[] | null; error?: string } {
  const cleaned = raw
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim()

  if (!cleaned) return { claims: [] }

  const parseArray = (text: string): FactClaim[] | null => {
    try {
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) return null
      return parsed.filter((item): item is FactClaim => Boolean(item) && typeof item === 'object')
    } catch {
      return null
    }
  }

  const first = parseArray(cleaned)
  if (first) return { claims: first }

  // 模型偶尔把多条事实写成多个数组，一行一个；拼成一个数组再试
  const body = cleaned.replace(/^\s*\[/, '').replace(/\]\s*$/, '')
  if (body.includes(']') && body.includes('[')) {
    const joined = `[${body.replace(/\]\s*\[/g, ',')}]`
    const second = parseArray(joined)
    if (second) return { claims: second }
  }

  return { claims: null, error: '事实块不是合法 JSON' }
}

/** 从流式文本里剥掉事实块；未闭合时把这一段先扣住，等下一块 */
export function stripFactsBlock(text: string): FactsBlockResult {
  const start = text.indexOf(FACTS_START)

  if (start === -1) {
    // 末尾可能是标记的前半截（例如 <!--fac），先扣住，避免闪一下
    let hold = 0
    const max = Math.min(text.length, FACTS_START.length - 1)
    for (let size = max; size >= 1; size--) {
      if (text.endsWith(FACTS_START.slice(0, size))) {
        hold = size
        break
      }
    }
    return {
      text: hold > 0 ? text.slice(0, text.length - hold) : text,
      claims: null,
      pending: hold > 0,
    }
  }

  const before = text.slice(0, start)
  const after = text.slice(start + FACTS_START.length)
  const end = after.indexOf(FACTS_END)

  if (end === -1) {
    return { text: before.trimEnd(), claims: null, pending: true }
  }

  const raw = after.slice(0, end)
  const rest = after.slice(end + FACTS_END.length)
  const parsed = parseClaims(raw)

  return {
    text: `${before}${rest}`.trimEnd(),
    claims: parsed.claims,
    pending: false,
    error: parsed.error,
  }
}

function simpleNameOf(value: string): string {
  const clean = value.replace(/<.*>/g, '').trim()
  const index = clean.lastIndexOf('.')
  return index === -1 ? clean : clean.slice(index + 1)
}

function quoteMatches(left: string, right: string): boolean {
  const a = normalizeWhitespace(left)
  const b = normalizeWhitespace(right)
  if (a.length < 3 || b.length < 3) return false
  return a.includes(b) || b.includes(a)
}

/**
 * 先在模型报的行找，找不到再全文件找最近的同名行。
 * 模型数错一两行很常见；引文对得上就回填真实行号，不假装未核实。
 */
function findQuoteLine(
  lines: string[],
  quote: string,
  claimedLine: number,
): { line: number; exact: boolean } | null {
  if (Number.isInteger(claimedLine) && claimedLine >= 1 && claimedLine <= lines.length) {
    if (quoteMatches(lines[claimedLine - 1] ?? '', quote)) return { line: claimedLine, exact: true }
  }

  let best: { line: number; distance: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    if (!quoteMatches(lines[i] ?? '', quote)) continue
    const line = i + 1
    const distance = Number.isInteger(claimedLine) ? Math.abs(line - claimedLine) : line
    if (!best || distance < best.distance) best = { line, distance }
  }
  return best ? { line: best.line, exact: false } : null
}

function hardFactForClaim(
  claimPath: string,
  quote: string,
  hardFacts: HardFact[],
): HardFact | null {
  const normalized = normalizePath(claimPath)
  for (const fact of hardFacts) {
    if (fact.kind === 'conflict') continue
    if (normalizePath(fact.path) !== normalized) continue
    if (quote && quoteMatches(fact.quote, quote)) return fact
  }
  return null
}

const FQN_RE = /\b[a-z][\w]*(?:\.[a-z][\w]*)+\b/gi

/**
 * 一条 claim 里出现了项目符号的另一个全限定名，就可能是把 XML namespace 当成接口。
 *
 * 只在句子没提 XML / namespace / 配置时判；提到这些词时，那个名字可能本来就是在说配置。
 */
function findContradiction(
  claimText: string,
  quote: string,
  hardFacts: HardFact[],
): HardFact | null {
  const text = `${claimText}\n${quote}`
  if (/(没有|无|未).{0,16}@WebServlet|@WebServlet.{0,16}(没有|无|未)/.test(text)) {
    const servlet = hardFacts.find((fact) => fact.kind === 'web-servlet')
    if (servlet) return servlet
  }
  if (/namespace|xml|配置/i.test(text)) return null

  const symbols = hardFacts.filter((fact) => fact.kind === 'fqn' && fact.object)
  const aliases = hardFacts.filter(
    (fact) =>
      (fact.kind === 'xml-namespace' || fact.kind === 'import' || fact.kind === 'field-type') &&
      fact.object,
  )

  for (const token of text.match(FQN_RE) ?? []) {
    const simple = simpleNameOf(token)
    const correct = symbols.find((fact) => simpleNameOf(fact.object ?? '') === simple)
    if (!correct || token === correct.object) continue
    if (aliases.some((fact) => fact.object === token)) return correct
  }
  return null
}

/** 用当前文件的原文和程序事实核对每条 claim；最多 20 条，避免异常输出拖慢页面 */
export function verifyFacts(
  claims: FactClaim[],
  currentPath: string,
  fileText: string,
  hardFacts: HardFact[] = [],
): FactCheck {
  const path = normalizePath(currentPath)
  const lines = fileText.split(/\r?\n/)
  const items: VerifiedFact[] = []

  for (const claim of claims.slice(0, 20)) {
    const claimPath = typeof claim.path === 'string' ? normalizePath(claim.path.trim()) : path
    const line = Number(claim.line)
    const quote = typeof claim.quote === 'string' ? claim.quote.trim() : ''
    const claimText = typeof claim.claim === 'string' ? claim.claim.trim() : ''

    const contradiction = findContradiction(claimText, quote, hardFacts)
    if (contradiction) {
      items.push({
        path: claimPath || path,
        line: Number.isInteger(line) ? line : 0,
        quote,
        claim: claimText,
        status: 'contradiction',
        reason: '与程序事实矛盾',
        factId: contradiction.id,
        correct: contradiction.text,
      })
      continue
    }

    const hardFact = hardFactForClaim(claimPath || path, quote, hardFacts)
    if (hardFact) {
      items.push({
        path: claimPath || path,
        line: hardFact.line > 0 ? hardFact.line : Number.isInteger(line) ? line : 0,
        quote,
        claim: claimText,
        status: 'verified',
        factId: hardFact.id,
      })
      continue
    }

    if (claimPath && claimPath !== path) {
      items.push({
        path: claimPath,
        line: Number.isInteger(line) ? line : 0,
        quote,
        claim: claimText,
        status: 'unverified',
        reason: '引用的是另一个文件，程序没有它的原文',
      })
      continue
    }

    if (!quote) {
      items.push({
        path,
        line: Number.isInteger(line) ? line : 0,
        quote,
        claim: claimText,
        status: 'unverified',
        reason: '没有给引文',
      })
      continue
    }

    const found = findQuoteLine(lines, quote, line)
    if (found) {
      items.push({
        path,
        line: found.line,
        quote,
        claim: claimText,
        status: 'verified',
        reason: found.exact ? undefined : `行号已修正：引文在第 ${found.line} 行`,
      })
    } else {
      items.push({
        path,
        line: Number.isInteger(line) ? line : 0,
        quote,
        claim: claimText,
        status: 'unverified',
        reason: '引文不在这个文件里',
      })
    }
  }

  const verified = items.filter((item) => item.status === 'verified').length
  const contradictions = items.filter((item) => item.status === 'contradiction').length

  return {
    verified,
    unverified: items.length - verified - contradictions,
    contradictions,
    items,
  }
}

/**
 * 在正文里找和程序事实直接矛盾的说法。
 *
 * 只报两种能对上的：
 *   1. 把已知的另一个全限定名（例如 XML namespace）当成接口类型；
 *   2. 句子里把注入类型说成另一个包。
 *
 * 按句切，不按行切 —— 中文长段落一行里经常同时出现对的和错的名字。
 * 每个名字只看前后 40 字，避免整句只要出现 namespace 就全部放过。
 */
function boundedPositions(text: string, token: string): number[] {
  const positions: number[] = []
  if (!token) return positions
  let index = text.indexOf(token)
  while (index !== -1) {
    const before = index > 0 ? text[index - 1] : ''
    const after = index + token.length < text.length ? text[index + token.length] : ''
    if (!/[A-Za-z0-9_.$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) positions.push(index)
    index = text.indexOf(token, index + token.length)
  }
  return positions
}

/** 已知的「另一个全限定名」：XML namespace、import、字段类型，映射到真正的符号 */
function buildAliasPairs(hardFacts: HardFact[]): { alias: string; correct: HardFact }[] {
  const symbols = hardFacts.filter((fact) => fact.kind === 'fqn' && fact.object)
  const aliases = hardFacts.filter(
    (fact) =>
      (fact.kind === 'xml-namespace' || fact.kind === 'import' || fact.kind === 'field-type') &&
      fact.object,
  )
  const pairs: { alias: string; correct: HardFact }[] = []
  for (const alias of aliases) {
    const simple = simpleNameOf(alias.object ?? '')
    const correct = symbols.find((fact) => simpleNameOf(fact.object ?? '') === simple)
    if (!correct || correct.object === alias.object) continue
    pairs.push({ alias: alias.object!, correct })
  }
  return pairs
}

const IGNORED_INJECTION_TOKENS = new Set([
  'null',
  'undefined',
  '空',
  '未知',
  'int',
  'long',
  'short',
  'byte',
  'float',
  'double',
  'boolean',
  'char',
  'String',
  'Integer',
  'Object',
])

export function findBodyFactConflicts(body: string, hardFacts: HardFact[]): string[] {
  if (hardFacts.length === 0) return []

  const aliasPairs = buildAliasPairs(hardFacts)
  const fields = hardFacts.filter((fact) => fact.kind === 'field-type' && fact.object)
  const servletFacts = hardFacts.filter((fact) => fact.kind === 'web-servlet')
  const warnings: string[] = []

  const add = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message)
  }

  const wrongPackages = new Set<string>()
  for (const { alias } of aliasPairs) {
    const index = alias.lastIndexOf('.')
    if (index > 0) wrongPackages.add(alias.slice(0, index))
  }

  for (const raw of body.split(/[。；\n]/)) {
    const sentence = raw.trim()
    if (!sentence) continue

    if (
      servletFacts.length &&
      /(没有|无|未).{0,16}@WebServlet|@WebServlet.{0,16}(没有|无|未)/.test(sentence)
    ) {
      add(`正文说没有 @WebServlet，已核实的事实是 ${servletFacts[0].text}`)
      continue
    }

    // 1) 已知的另一个全限定名，被当成接口、类型或 import
    for (const { alias, correct } of aliasPairs) {
      for (const index of boundedPositions(sentence, alias)) {
        const before = sentence.slice(Math.max(0, index - 30), index)
        const after = sentence.slice(index + alias.length, index + alias.length + 14)
        if (/namespace\s*(是|为|=|:)\s*[`"']?$/i.test(before)) continue
        const window = `${before}${alias}${after}`
        if (!/(接口|类型|调用|调|实现|import|注入|字段)/i.test(window)) continue
        add(`正文写的是 ${alias}，已核实的事实是 ${correct.object}（${correct.path}:${correct.line}）`)
      }
    }

    // 2) 注入类型：只认「注入类型是/为/写成/用」和「注入类型上」两种明确说法
    for (const field of fields) {
      const correct = field.object ?? ''
      if (!correct) continue
      const owner = field.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
      if (owner && !sentence.includes(owner)) continue

      const direct = sentence.match(/注入(?:类型|字段)?(?:是|为|写成|用)\s*[`"']?([\w.]+)/)
      if (direct) {
        const token = direct[1]!
        const ignored = new Set(['null', 'undefined', '空', '未知', 'int', 'long', 'short', 'byte', 'float', 'double', 'boolean', 'char', 'String', 'Integer', 'Object'])
        if (
          !ignored.has(token) &&
          token !== correct &&
          !correct.startsWith(`${token}.`) &&
          boundedPositions(sentence, correct).length === 0
        ) {
          add(`正文把注入类型说成 ${token}，已核实的事实是 ${correct}（${field.path}:${field.line}）`)
          continue
        }
      }

      if (/注入类型上/.test(sentence) && boundedPositions(sentence, correct).length === 0) {
        for (const wrongPackage of wrongPackages) {
          if (boundedPositions(sentence, wrongPackage).length === 0) continue
          if (correct.startsWith(`${wrongPackage}.`)) continue
          add(`正文把注入类型说成 ${wrongPackage}，已核实的事实是 ${correct}（${field.path}:${field.line}）`)
        }
      }
    }
  }

  return warnings.slice(0, 3)
}

/** 把程序事实排成逐文件请求里的一段纯文本；没有事实返回空字符串 */
export function formatVerifiedFacts(facts: HardFact[]): string {
  if (facts.length === 0) return ''
  return facts.map((fact) => `- ${fact.text}`).join('\n')
}

/**
 * 按程序事实更正正文里的一小块名字。
 *
 * 只换 token：全限定名、包名；只在明确的接口/类型/调用/注入上下文里换，
 * 遇到「namespace 是 …」这种合法配置说明不动。流式结束后调用一次。
 */
export interface FactFixContext {
  /** 文件 → 行数；正文行号引用核对用 */
  lineCounts?: Record<string, number>
  /** 当前文件路径；正文只写「第 N 行」时用 */
  currentPath?: string
  /** 当前文件行数 */
  currentLineCount?: number
}

export function applyFactFixes(
  body: string,
  hardFacts: HardFact[],
  context: FactFixContext = {},
): { text: string; fixes: FactFix[] } {
  if (hardFacts.length === 0) return { text: body, fixes: [] }

  const aliasPairs = buildAliasPairs(hardFacts)
  const fields = hardFacts.filter((fact) => fact.kind === 'field-type' && fact.object)
  const fixes: FactFix[] = []
  let text = body

  const sentenceAround = (value: string, offset: number, length: number): string => {
    const start =
      Math.max(
        value.lastIndexOf('。', Math.max(0, offset - 1)),
        value.lastIndexOf('；', Math.max(0, offset - 1)),
        value.lastIndexOf('\n', Math.max(0, offset - 1)),
      ) + 1
    const ends = [
      value.indexOf('。', offset + length),
      value.indexOf('；', offset + length),
      value.indexOf('\n', offset + length),
    ].filter((index) => index !== -1)
    const end = ends.length > 0 ? Math.min(...ends) + 1 : value.length
    return value.slice(start, end)
  }

  const pushFix = (from: string, to: string, fact: HardFact, reason: string, offset: number) => {
    const raw = sentenceAround(text, offset, from.length)
    const before = raw.trim()
    const after = raw.split(from).join(to).trim()
    fixes.push({ from, to, path: fact.path, line: fact.line, reason, before, after })
  }

  // 1) 把已知的另一个全限定名（例如 XML namespace）当成接口/类型
  for (const { alias, correct } of aliasPairs) {
    for (const pos of boundedPositions(text, alias).reverse()) {
      const before = text.slice(Math.max(0, pos - 30), pos)
      const after = text.slice(pos + alias.length, pos + alias.length + 30)
      if (/namespace\s*(是|为|=|:)\s*[`"']?$/i.test(before)) continue
      const window = `${before}${alias}${after}`
      if (!/(接口|类型|调用|调|实现|import|注入|字段)/i.test(window)) continue
      const replacement = correct.object ?? alias
      pushFix(alias, replacement, correct, '把已知的另一个全限定名当成了接口/类型', pos)
      text = text.slice(0, pos) + replacement + text.slice(pos + alias.length)
    }
  }

  // 2) 说没有 @WebServlet，或者由「没注册」推出 404：两句都换成事实句
  const servletFacts = hardFacts.filter((fact) => fact.kind === 'web-servlet')
  if (servletFacts.length > 0) {
    const servlet = servletFacts[0]!
    const negativeRe = /([^。；\n]*(?:没有|无|未)[^。；\n]{0,20}@WebServlet[^。；\n]*|[^。；\n]*@WebServlet[^。；\n]{0,20}(?:没有|无|未)[^。；\n]*)/g
    text = text.replace(negativeRe, (sentence: string, _match: string, offset: number) => {
      if (/有\s*@WebServlet/.test(sentence)) return sentence
      const replacement = `项目里有 @WebServlet：${servlet.text}`
      pushFix(sentence.trim(), replacement, servlet, '正文说没有 @WebServlet', offset)
      return replacement
    })
    const servletSentenceRe = /([^。；\n]*(?:这个链接[^。；\n]*Servlet|Servlet[^。；\n]*没有注册|死链接)[^。；\n]*)/g
    text = text.replace(servletSentenceRe, (sentence: string, _match: string, offset: number) => {
      if (/已经用\s*@WebServlet\s*注册|有\s*@WebServlet/.test(sentence)) return sentence
      const replacement = `这个链接指向的 Servlet 已经用 @WebServlet 注册（${servlet.path}:${servlet.line}）`
      pushFix(sentence.trim(), replacement, servlet, '正文说这个 Servlet 没有注册', offset)
      return replacement
    })
    const notFoundRe = /([^。；\n]*404[^。；\n]*)/g
    text = text.replace(notFoundRe, (sentence: string, _match: string, offset: number) => {
      if (!/(链接|Servlet|servlet|hello-servlet)/.test(sentence)) return sentence
      if (/不会[^。；\n]*404/.test(sentence)) return sentence
      const replacement = '这个链接对应的 Servlet 已经用 @WebServlet 注册，因此这个链接可用'
      pushFix(sentence.trim(), replacement, servlet, '正文的 404 结论和 @WebServlet 事实矛盾', offset)
      return replacement
    })
  }

  // 3) import 的推断依据不在事实里：整句换成源码事实
  const importSentenceRe = /([^。；\n]*import[^。；\n]*)/g

  for (const field of fields) {
    const correct = field.object ?? ''
    if (!correct) continue
    text = text.replace(importSentenceRe, (sentence: string, _match: string, offset: number) => {
      if (!/(应该是|按 XML|推断)/.test(sentence)) return sentence
      if (!sentence.includes(correct)) return sentence
      const owner = field.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '这个类'
      const replacement = `${owner} 实际引用的是 ${correct}；这个结论来自源码里的声明，不是从 XML namespace 推断的`
      pushFix(sentence.trim(), replacement, field, '导入关系的推断依据不在事实里', offset)
      return replacement
    })
  }

  // 4) 直接说「注入类型是 X」：只换 X 这个名字
  const directRe = /注入(?:类型|字段)?(?:是|为|写成|用)\s*[`"']?([\w.]+)/g
  for (const field of fields) {
    const correct = field.object ?? ''
    if (!correct) continue
    const owner = field.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
    text = text.replace(directRe, (match, token: string, offset: number) => {
      const context = text.slice(Math.max(0, offset - 80), offset + match.length)
      if (owner && !context.includes(owner)) return match
      if (IGNORED_INJECTION_TOKENS.has(token) || token === correct) return match
      if (correct.startsWith(`${token}.`)) return match
      if (boundedPositions(text, correct).length > 0) return match
      const replacement = match.replace(token, correct)
      pushFix(token, correct, field, '注入类型说成了另一个名字', offset)
      return replacement
    })
  }

  // 5) 句子里说「注入类型上」：整句换成程序事实句
  const sentenceRe = /([^。；\n]*注入类型上[^。；\n]*)/g
  for (const field of fields) {
    const correct = field.object ?? ''
    if (!correct) continue
    const owner = field.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '这个类'
    text = text.replace(sentenceRe, (sentence: string, _match: string, offset: number) => {
      if (!sentence.includes(owner)) return sentence
      if (boundedPositions(sentence, correct).length > 0) return sentence
      const wrong = aliasPairs.some(({ alias }) => {
        const index = alias.lastIndexOf('.')
        const wrongPackage = index > 0 ? alias.slice(0, index) : ''
        return Boolean(wrongPackage) && boundedPositions(sentence, wrongPackage).length > 0
      })
      if (!wrong) return sentence
      const replacement = `${owner} 的注入类型是 ${correct}`
      pushFix(sentence.trim(), replacement, field, '注入类型说成了另一个包', offset)
      return replacement
    })
  }

  // 6) 正文里的行号引用：先对事实行，再查文件范围
  const lineCounts = context.lineCounts ?? {}
  const hasLineContext = Object.keys(lineCounts).length > 0 || Boolean(context.currentLineCount)
  if (hasLineContext) {
    const baseToPath = new Map<string, string>()
    for (const filePath of Object.keys(lineCounts)) {
      baseToPath.set(filePath.split('/').pop() ?? filePath, filePath)
    }
    const factsByPath = new Map<string, HardFact[]>()
    for (const fact of hardFacts) {
      const list = factsByPath.get(fact.path) ?? []
      list.push(fact)
      factsByPath.set(fact.path, list)
    }
    const resolvePath = (raw: string): string | null => {
      const clean = raw.replace(/\\/g, '/')
      if (lineCounts[clean] !== undefined) return clean
      return baseToPath.get(clean.split('/').pop() ?? clean) ?? null
    }
    const factLineFor = (
      sentence: string,
      filePath: string,
    ): { line: number; fact: HardFact } | null => {
      for (const fact of factsByPath.get(filePath) ?? []) {
        if (!fact.line || fact.line < 1) continue
        if (fact.kind === 'field-type' && !/注入|字段|属性/.test(sentence)) continue
        if (
          (fact.kind === 'annotation' || fact.kind === 'web-servlet') &&
          !/注解|@|注册/.test(sentence)
        )
          continue
        if (fact.kind === 'package' && !/package|包/.test(sentence)) continue
        if (fact.kind === 'fqn' && !/定义|声明/.test(sentence)) continue
        if (fact.kind === 'import' && !/import|引入/.test(sentence)) continue
        if (
          !['field-type', 'annotation', 'web-servlet', 'package', 'fqn', 'import'].includes(
            fact.kind,
          )
        )
          continue
        const simple = simpleNameOf(fact.object ?? fact.subject ?? '')
        if (simple.length >= 4 && sentence.includes(simple)) return { line: fact.line, fact }
      }
      return null
    }
    const replaceFileLine = (
      match: string,
      rawPath: string,
      lineText: string,
      offset: number,
      style: 'colon' | 'cn',
    ): string => {
      const filePath = resolvePath(rawPath)
      if (!filePath) return match
      const line = Number(lineText)
      const sentence = sentenceAround(text, offset, match.length)
      const factLine = factLineFor(sentence, filePath)
      if (factLine && factLine.line !== line) {
        const replacement =
          style === 'colon' ? `${rawPath}:${factLine.line}` : `${rawPath} 第 ${factLine.line} 行`
        pushFix(match, replacement, factLine.fact, '行号和程序事实不一致', offset)
        return replacement
      }
      const count = lineCounts[filePath]
      if (count && (line < 1 || line > count)) {
        const replacement = `${rawPath}（行号超出文件）`
        const raw = sentenceAround(text, offset, match.length)
        fixes.push({
          from: match,
          to: replacement,
          path: filePath,
          line,
          reason: '行号不在文件范围内',
          before: raw.trim(),
          after: raw.split(match).join(replacement).trim(),
        })
        return replacement
      }
      return match
    }
    const colonRe = /([\w./-]+\.(?:java|xml|jsp|js|ts|vue))\s*[:：]\s*(\d+)/g
    text = text.replace(colonRe, (match, rawPath: string, lineText: string, offset: number) =>
      replaceFileLine(match, rawPath, lineText, offset, 'colon'),
    )
    const cnRe = /([\w./-]+\.(?:java|xml|jsp|js|ts|vue))\s*第\s*(\d+)\s*行/g
    text = text.replace(cnRe, (match, rawPath: string, lineText: string, offset: number) =>
      replaceFileLine(match, rawPath, lineText, offset, 'cn'),
    )
    if (context.currentPath && context.currentLineCount) {
      const bareRe = /第\s*(\d+)\s*行/g
      text = text.replace(bareRe, (match, lineText: string, offset: number) => {
        const line = Number(lineText)
        const sentence = sentenceAround(text, offset, match.length)
        const factLine = factLineFor(sentence, context.currentPath!)
        if (factLine && factLine.line !== line) {
          const replacement = `第 ${factLine.line} 行`
          pushFix(match, replacement, factLine.fact, '行号和程序事实不一致', offset)
          return replacement
        }
        if (line < 1 || line > context.currentLineCount!) {
          const replacement = '（行号超出当前文件）'
          const raw = sentenceAround(text, offset, match.length)
          fixes.push({
            from: match,
            to: replacement,
            path: context.currentPath!,
            line,
            reason: '行号不在当前文件范围内',
            before: raw.trim(),
            after: raw.split(match).join(replacement).trim(),
          })
          return replacement
        }
        return match
      })
    }
  }

  return { text, fixes }
}

/**
 * 总览输入里，一个文件应该带什么 role。
 *
 * 正文还有没自动更正的跨文件矛盾时，不把第三段喂给总览；换成一句说明和已核实事实，
 * 避免总览继承错结论。没有预警时原样返回。
 */
export function summaryRoleForFile(
  role: string,
  warnings: string[],
  hardFacts: HardFact[],
): string {
  if (warnings.length === 0) return role
  const facts = hardFacts
    .filter((fact) => fact.kind === 'conflict' || fact.kind === 'fqn' || fact.kind === 'field-type')
    .slice(0, 3)
    .map((fact) => fact.text)
    .join('；')
  const note = `（正文有未自动更正的跨文件矛盾，未纳入总览${facts ? `；已核实事实：${facts}` : ''}）`
  return note.slice(0, 300)
}

/**
 * 跨文件句子有没有对应的 claim。
 *
 * 只看「A 调用/注入/依赖/实现/继承/返回/传给/传入/引入 B」这类关系句；
 * 句子里至少出现一个项目符号/文件名，且模型的事实块里没有任何一条
 * 提到这个符号，就说明这句没有结构化 claim 支撑，建议写成「可能」。
 *
 * 这不是语义核对，只是覆盖检查；宁可少报，先只报关系句。
 */
const RELATION_RE =
  /([A-Za-z_$][\w.$]*)\s*(调用|注入|依赖|实现|继承|返回|传给|传入|引入|import)\s*([A-Za-z_$][\w.$]*)/g

export function findUncoveredClaims(
  body: string,
  claims: FactClaim[],
  hardFacts: HardFact[],
): string[] {
  const known = new Set<string>()
  for (const fact of hardFacts) {
    for (const value of [fact.object, fact.subject]) {
      const simple = simpleNameOf(value ?? '')
      if (simple.length >= 4) known.add(simple)
    }
    const base = fact.path.split('/').pop()?.replace(/\.[^.]+$/, '')
    if (base && base.length >= 4) known.add(base)
  }
  if (known.size === 0) return []

  const warnings: string[] = []
  for (const raw of body.split(/[。；\n]/)) {
    const sentence = raw.trim()
    if (!sentence || sentence.length < 8) continue
    const matches = [...sentence.matchAll(RELATION_RE)]
    if (matches.length === 0) continue
    const names = matches
      .flatMap((match) => [match[1], match[3]])
      .filter((name): name is string => Boolean(name))
    if (!names.some((name) => known.has(simpleNameOf(name)))) continue
    const simpleNames = [...new Set(names.map((name) => simpleNameOf(name)))]
    const covered = claims.some((claim) => {
      const text = `${claim.claim ?? ''} ${claim.quote ?? ''}`
      return simpleNames.some((name) => name.length >= 4 && text.includes(name))
    })
    if (covered) continue
    warnings.push(`没有对应事实的跨文件句子：${sentence.slice(0, 160)}`)
    if (warnings.length >= 3) break
  }
  return warnings
}
