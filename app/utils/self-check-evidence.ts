/**
 * 给“还没有决定的边”补一份程序证据包。
 *
 * 前几轮 187 的教训：模型在边批次里只肯调用 2 次工具，没读端点文件时
 * 大多数 unsupported 边只能 unknown。这一层在剩下的边上再跑一次：
 * 程序按固定规则把两端文件里的高信号行抓出来（import、路由、请求、
 * 状态管理、鉴权 / 拦截器配置），带真实行号交给模型；模型不再申请工具，
 * 只根据这些行给决定；决定里引用的行号由程序回查，定位不到就按 unknown。
 *
 * 纯函数；不读网络、不碰 DOM。
 */
import type { ProjectGraphData } from '~/types/project'
import type { SelfCheckDecision, SelfCheckItem } from '~/types/self-check'

/** 一个端点最多从几个文件里找证据；分组节点可能有很多文件 */
const MAX_FILES_PER_SIDE = 3
/** 每个文件最多保留多少行 */
const MAX_LINES_PER_FILE = 12
const MAX_LINE_CHARS = 180
/** 一个证据包最多多少字符，超了截断 */
const MAX_PACK_CHARS = 5_000
/** 一次模型调用最多带几个证据包 */
export const EVIDENCE_PACK_ITEMS_PER_CALL = 5
/** 一次模型调用的证据包总字符上限 */
export const EVIDENCE_PACK_CHARS_PER_CALL = 24_000

export interface EvidencePack {
  id: string
  kind: string
  from: string
  to: string
  label?: string
  /** 证据里出现过的文件，用来回查模型引用的 path:line */
  files: string[]
  text: string
}

interface Signal {
  reason: string
  re: RegExp
  score: number
}

/**
 * 高信号行。规则刻意写得宽：宁可多给几行，也不要漏掉
 * 路由、请求、dispatch、拦截器这类跨文件关系的落点。
 */
const SIGNALS: Signal[] = [
  {
    reason: 'import',
    re: /^\s*(import|from\s+['"]|.*\brequire\s*\(|#include|using\s+[\w.]+;|.*@Autowired|.*@Resource|.*@Inject|.*@Import\b)/,
    score: 3,
  },
  {
    reason: 'route',
    re: /@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|WebServlet|Path)\b/,
    score: 4,
  },
  {
    reason: 'url',
    re: /['"`]\/[\w\-./{}$:]{2,}['"`]|baseURL|url\s*:/i,
    score: 3,
  },
  {
    reason: 'request',
    re: /\b(fetch|axios|\$http|\$axios|request)\s*\(|\bopen\s*\(|\bsendRedirect\b|\bforward\s*\(|\.get\s*\(|\.post\s*\(/i,
    score: 2,
  },
  {
    reason: 'store',
    re: /\b(dispatch|commit|mutations?|actions?|state|getters)\b|\$store|useStore|defineStore|createStore|mapState|mapActions/i,
    score: 3,
  },
  {
    reason: 'security',
    re: /\b(interceptor|security|auth|token|jwt|csrf|cors|permitAll|authenticate|authorization|filter|shiro|session)\b/i,
    score: 2,
  },
  {
    reason: 'config',
    re: /\b(application\.(ya?ml|properties)|web\.xml|namespace|contextConfigLocation|component-scan)\b/i,
    score: 2,
  },
]

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

function stem(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return (dot === -1 ? name : name.slice(0, dot)).toLowerCase()
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

function filesOf(endpoint: string, graph: ProjectGraphData): string[] {
  if (endpoint.startsWith('f:')) return [endpoint.slice(2)]
  if (endpoint.startsWith('n:')) {
    const node = graph.nodes.find((row) => row.id === endpoint.slice(2))
    return (node?.files ?? []).map((file) => file.path)
  }
  return []
}

/** 分组节点文件多时，先挑提到对端名字的，再挑信号行多的 */
function pickFiles(
  paths: string[],
  otherStems: string[],
  getText: (path: string) => string | undefined,
): string[] {
  if (paths.length <= MAX_FILES_PER_SIDE) return paths
  const scored = paths.map((path) => {
    const text = getText(path) ?? ''
    const lower = text.toLowerCase()
    const mentions = otherStems.filter((name) => name && lower.includes(name)).length
    const signals = SIGNALS.reduce(
      (sum, signal) => sum + (signal.re.test(text) ? 1 : 0),
      0,
    )
    return { path, score: mentions * 5 + signals }
  })
  return scored
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES_PER_SIDE)
    .map((row) => row.path)
}

interface PickedLine {
  line: number
  text: string
  score: number
}

/** 从一份文件里挑高信号行；提到对端文件名的行优先，最后按行号还原顺序 */
function pickLines(
  text: string,
  otherStems: string[],
  otherNames: string[],
): PickedLine[] {
  const lines = splitLines(text).slice(0, 4_000)
  const picked: PickedLine[] = []
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (/^(\/\/|\*|\/\*|<!--|#\s|--\s)/.test(trimmed)) continue

    const lower = trimmed.toLowerCase()
    let score = 0
    const reasons: string[] = []
    for (const signal of SIGNALS) {
      if (signal.re.test(trimmed)) {
        score += signal.score
        reasons.push(signal.reason)
      }
    }
    for (const name of otherStems) {
      if (name.length >= 3 && lower.includes(name)) {
        score += 5
        reasons.push(`提到 ${name}`)
      }
    }
    for (const name of otherNames) {
      if (name.length >= 3 && lower.includes(name.toLowerCase())) score += 3
    }
    if (score === 0) continue
    picked.push({
      line: index + 1,
      text: trimmed.slice(0, MAX_LINE_CHARS),
      score,
    })
  }
  return picked
    .sort((a, b) => b.score - a.score || a.line - b.line)
    .slice(0, MAX_LINES_PER_FILE)
    .sort((a, b) => a.line - b.line)
}

function renderFileSection(
  path: string,
  text: string,
  otherStems: string[],
  otherNames: string[],
): string {
  const picked = pickLines(text, otherStems, otherNames)
  if (picked.length === 0) {
    return `  ${path}：没有抓到 import / 路由 / 请求 / 状态管理 / 鉴权相关行`
  }
  const rows = picked.map((row) => `    ${row.line}: ${row.text}`).join('\n')
  return `  ${path}：\n${rows}`
}

export function buildEvidencePacks(
  items: SelfCheckItem[],
  graph: ProjectGraphData,
  getText: (path: string) => string | undefined,
): EvidencePack[] {
  const packs: EvidencePack[] = []
  for (const item of items) {
    if (item.edgeIndex < 0) continue
    const fromFiles = filesOf(item.from, graph)
    const toFiles = filesOf(item.to, graph)
    if (fromFiles.length === 0 || toFiles.length === 0) continue

    const fromNames = fromFiles.map(basename)
    const toNames = toFiles.map(basename)
    const fromStems = fromFiles.map(stem)
    const toStems = toFiles.map(stem)

    const pickedFrom = pickFiles(fromFiles, toStems.concat(toNames), getText)
    const pickedTo = pickFiles(toFiles, fromStems.concat(fromNames), getText)

    const sections: string[] = []
    for (const path of pickedFrom) {
      const text = getText(path)
      if (text) sections.push(renderFileSection(path, text, toStems, toNames))
    }
    for (const path of pickedTo) {
      const text = getText(path)
      if (text) sections.push(renderFileSection(path, text, fromStems, fromNames))
    }
    if (sections.length === 0) continue

    const header = `【${item.id}】${item.from} -> ${item.to}${
      item.label ? `（当前标签：${item.label}）` : ''
    }\n  预检：${item.kind}${item.detail ? `；${item.detail}` : ''}`
    let body = `${header}\n${sections.join('\n')}`
    if (body.length > MAX_PACK_CHARS) {
      body = `${body.slice(0, MAX_PACK_CHARS)}\n  （证据包已截断，只保留前面的行）`
    }
    packs.push({
      id: item.id,
      kind: item.kind,
      from: item.from,
      to: item.to,
      label: item.label,
      files: [...new Set([...pickedFrom, ...pickedTo])],
      text: body,
    })
  }
  return packs
}

export function formatEvidencePrompt(packs: EvidencePack[]): string {
  return `【补充证据包】下面这些边在批预算里没有拿到明确决定。程序已经把两端文件里的相关行抓出来了，行号是文件里的真实行号。

不要再申请工具，只根据这些行判断。每条边只回一个决定：
- keep：证据支持这条关系；
- remove：证据说明关系不成立；
- reverse：证据说明方向反了；
- relabel：关系成立，只是标签不对；
- unknown：这些行仍然看不出依据。

规则：
- keep / remove / reverse / relabel 都要在 evidence 里写依据的 path:line，行号必须来自下面的证据包；
- 引用的行由程序回查，定位不到原文的决定按 unknown 处理；
- 不要输出本批之外的内容，不要输出完整图。

${packs.map((pack) => pack.text).join('\n\n')}

只输出一个 JSON 对象，不要 Markdown 代码围栏：
{"decisions":[{"id":"E12","action":"keep","reason":"依据","evidence":["src/a.js:12"]}]}`
}

export function chunkEvidencePacks(
  packs: EvidencePack[],
  maxItems = EVIDENCE_PACK_ITEMS_PER_CALL,
  maxChars = EVIDENCE_PACK_CHARS_PER_CALL,
): EvidencePack[][] {
  const chunks: EvidencePack[][] = []
  let current: EvidencePack[] = []
  let chars = 0
  for (const pack of packs) {
    const nextChars = chars + pack.text.length
    if (
      current.length > 0 &&
      (current.length >= maxItems || nextChars > maxChars)
    ) {
      chunks.push(current)
      current = []
      chars = 0
    }
    current.push(pack)
    chars += pack.text.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\.\//, '')
}

/**
 * 回查模型引用的 path:line。
 * 只接受“证据包里出现过的文件 + 文件里真实存在的行号”；一条都对不上就算没引用。
 */
export function checkEvidenceCitations(
  decision: SelfCheckDecision,
  packs: EvidencePack[],
  getText: (path: string) => string | undefined,
): { ok: boolean; cited: string[] } {
  const allowed = new Set(packs.flatMap((pack) => pack.files))
  const cited: string[] = []
  for (const raw of decision.evidence ?? []) {
    const match = raw.trim().match(/^(.+?):(\d+)\b/)
    if (!match) continue
    const path = normalizePath(match[1]!)
    const line = Number(match[2])
    if (!allowed.has(path) || !Number.isFinite(line) || line < 1) continue
    const text = getText(path)
    if (!text) continue
    const total = splitLines(text).length
    if (line > total) continue
    cited.push(`${path}:${line}`)
  }
  return { ok: cited.length > 0, cited }
}
