/**
 * 正文事实绑定：先判断一句话在说哪个文件、哪个符号、哪种上下文，
 * 再决定能不能用程序事实改它。
 *
 * 这一层只做纯判断，不碰页面也不发请求。它要挡住三类误改：
 *   1. 合法的 XML namespace 被当成接口全限定名；
 *   2. 句子已经在说正确的全限定名，却把旁边的 alias 也换掉；
 *   3. 同一个简单名有多个候选时，随便挑一个。
 */

import type { HardFact } from '~/types/structure'

export interface FactAliasPair {
  alias: string
  correct: HardFact
}

export interface AmbiguousAlias {
  alias: string
  candidates: HardFact[]
}

export interface FactBindings {
  aliasPairs: FactAliasPair[]
  ambiguousAliases: AmbiguousAlias[]
  fields: HardFact[]
  servlets: HardFact[]
}

const LINE_FILE_EXT = 'java|xml|jsp|js|ts|vue'

/** 只在这几种上下文里替换名字；不改「调用」这种没有类型含义的说法 */
export const FACT_NAME_CONTEXT_RE = /(接口|类型|注入|import|实现)/i

export function hasFactNameContext(text: string): boolean {
  return FACT_NAME_CONTEXT_RE.test(text)
}

export function normalizeFactPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function simpleNameOf(value: string): string {
  const clean = value.replace(/<.*>/g, '').trim()
  const index = clean.lastIndexOf('.')
  return index === -1 ? clean : clean.slice(index + 1)
}

/** 找到 token 在文本里的完整出现位置，不把更长的全限定名里的后缀算进去 */
export function boundedPositions(text: string, token: string): number[] {
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

export function hasBoundedToken(text: string, token: string): boolean {
  return boundedPositions(text, token).length > 0
}

/**
 * 这个位置是不是「namespace 的值」，而不是「接口类型」。
 *
 * 「namespace 是」「namespace 写的是」「namespace="」都算；
 * 只往左看一小段，避免整句出现 namespace 就把所有名字都放过。
 */
const NAMESPACE_BEFORE_RE =
  /namespace\s*(?:是|为|写成|写的是|写的|指向|使用|用了|等于|=|:|：)?\s*[`"']?\s*$/i

export function isNamespaceMention(sentence: string, start: number, alias: string): boolean {
  const before = sentence.slice(Math.max(0, start - 48), start)
  if (NAMESPACE_BEFORE_RE.test(before)) return true
  const after = sentence.slice(start + alias.length, start + alias.length + 4)
  return /^\s*[`"']?\s*(?:的)?\s*namespace/i.test(after)
}

/**
 * namespace、XML、扫描包、配置值旁边的名字都不动。
 *
 * 这些位置上的全限定名是配置内容，不是正文在断言接口类型；
 * 替换它会把正确的配置说明改成错的。
 */
const PROTECTED_VALUE_RE = /namespace|xml|扫描包|扫描的包|component-scan|配置值|配置项|配置里|配置中/i

export function isProtectedValueMention(sentence: string, start: number, alias: string): boolean {
  const window = sentence.slice(
    Math.max(0, start - 40),
    Math.min(sentence.length, start + alias.length + 20),
  )
  return PROTECTED_VALUE_RE.test(window)
}

/**
 * 句子是不是在描述「这个名字写错了」，而不是在断言它。
 *
 * 「找不到」「写成」「对不上」「实际在」这类上下文里，模型往往已经知道正确名字；
 * 这时再替换会把解释改坏。
 */
const DIAGNOSTIC_RE = /找不到|写成|写的是|对不上|不一致|应该是|实际在|实际是|实际为|而不是|不是|错了|误写/

export function isDiagnosticMention(sentence: string, start: number, alias: string): boolean {
  const window = sentence.slice(
    Math.max(0, start - 24),
    Math.min(sentence.length, start + alias.length + 24),
  )
  return DIAGNOSTIC_RE.test(window)
}

/**
 * 为每条 alias 找唯一的正确符号。
 *
 * 同一个简单名有两个以上 fqn 时整组跳过；同一个 alias 指向两个不同正确符号时也跳过。
 */
export function buildFactBindings(hardFacts: HardFact[]): FactBindings {
  const symbolsByName = new Map<string, HardFact[]>()
  for (const fact of hardFacts) {
    if (fact.kind !== 'fqn' || !fact.object) continue
    const simple = simpleNameOf(fact.object)
    if (!simple) continue
    const list = symbolsByName.get(simple) ?? []
    list.push(fact)
    symbolsByName.set(simple, list)
  }

  const correctByAlias = new Map<string, HardFact | null>()
  const ambiguousByAlias = new Map<string, HardFact[]>()
  const markAmbiguous = (alias: string, facts: HardFact[]) => {
    const merged = ambiguousByAlias.get(alias) ?? []
    const seen = new Set(merged.map((fact) => fact.id))
    for (const fact of facts) {
      if (seen.has(fact.id)) continue
      merged.push(fact)
    }
    ambiguousByAlias.set(alias, merged)
  }

  for (const fact of hardFacts) {
    if (
      (fact.kind !== 'xml-namespace' && fact.kind !== 'import' && fact.kind !== 'field-type') ||
      !fact.object
    )
      continue
    const alias = fact.object
    const candidates = symbolsByName.get(simpleNameOf(alias)) ?? []
    if (candidates.length !== 1) {
      if (candidates.length > 1) markAmbiguous(alias, candidates)
      continue
    }
    const correct = candidates[0]!
    if (!correct.object || correct.object === alias) continue

    const existing = correctByAlias.get(alias)
    if (existing === undefined) {
      correctByAlias.set(alias, correct)
    } else if (existing && existing.object !== correct.object) {
      correctByAlias.set(alias, null)
      markAmbiguous(alias, [existing, correct])
    }
  }

  const aliasPairs: FactAliasPair[] = []
  for (const [alias, correct] of correctByAlias) {
    if (!correct) continue
    aliasPairs.push({ alias, correct })
  }

  const ambiguousAliases: AmbiguousAlias[] = []
  for (const [alias, candidates] of ambiguousByAlias) {
    ambiguousAliases.push({ alias, candidates })
  }

  return {
    aliasPairs,
    ambiguousAliases,
    fields: hardFacts.filter((fact) => fact.kind === 'field-type' && fact.object),
    servlets: hardFacts.filter((fact) => fact.kind === 'web-servlet'),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 句子里点到了哪些项目文件；文件名和去掉扩展名的类名都算 */
export function fileMentionsInSentence(sentence: string, paths: string[]): string[] {
  const found = new Set<string>()
  for (const path of paths) {
    const normalized = normalizeFactPath(path)
    const base = normalized.split('/').pop() ?? ''
    const stem = base.replace(/\.[^.]+$/, '')
    if (stem.length < 3) continue
    const re = new RegExp(
      `(^|[^A-Za-z0-9_$])${escapeRegExp(stem)}(?:\\.(?:${LINE_FILE_EXT}))?(?=$|[^A-Za-z0-9_$])`,
    )
    if (re.test(sentence)) found.add(normalized)
  }
  return [...found]
}

/**
 * 一个裸「第 N 行」是不是在当前文件里。
 *
 * 只有两种算：
 *   1. 句子明确说「本文件 / 当前文件 / 这个文件」；
 *   2. 句子只点到了一个文件名，而且就是当前文件。
 * 点到别的文件、点到多个文件、或者什么都没点，都不动。
 */
export function namesCurrentFile(
  sentence: string,
  currentPath: string,
  knownPaths: string[],
): boolean {
  const current = normalizeFactPath(currentPath)
  const mentioned = fileMentionsInSentence(sentence, knownPaths)
  const others = mentioned.filter((path) => path !== current)
  if (others.length > 0) return false
  if (/本文件|当前文件|这个文件/.test(sentence)) return true
  return mentioned.length === 1 && mentioned[0] === current
}

/** 「第 N 行」紧跟在文件名或类名后面时，交给带文件名的分支处理，别按当前文件算 */
export function hasFileReferenceBefore(text: string, offset: number): boolean {
  const before = text.slice(Math.max(0, offset - 100), offset)
  return new RegExp(`(?:[\\w./-]+\\.(?:${LINE_FILE_EXT})|[A-Za-z_$][\\w$]*)\\s*$`).test(before)
}
