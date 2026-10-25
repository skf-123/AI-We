/**
 * 从源文件的 import / include 里提取文件级候选边。
 *
 * 这一层刻意不依赖模型的任何输出，也不认识项目图：
 *   · Java：用 package + 类名建索引，再把 import 落到文件；
 *   · JS / TS / Vue：解析相对路径和 `@/` / `~/` 别名，补全扩展名和 /index；
 *   · 解析不到的记 unresolved，不假装有关系。
 *
 * 图里的边和候选边是两份独立证据：候选边来自源码，图来自汇总模型。
 * 对不上只代表“需要核对”，不代表一定错。
 */

export interface CandidateSourceFile {
  path: string
  text: string
}

export interface CandidateEdge {
  from: string
  to: string
  /** 触发这条边的原始 import 行，供核对 */
  evidence: string
  line: number
}

export interface UnresolvedImport {
  from: string
  specifier: string
  line: number
}

export interface CandidateScan {
  edges: CandidateEdge[]
  unresolved: UnresolvedImport[]
  filesParsed: number
  filesWithImports: number
  /** 实际参与扫描的路径；图里的文件不在这里，就说明没解析过，不能据此判错 */
  paths: string[]
}

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs']
const MAX_LINES = 200

export function normalizeCandidatePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

function resolveJsPath(raw: string, pathSet: Set<string>): string | null {
  const candidates = [raw, ...JS_EXTENSIONS.map((ext) => raw + ext)]
  for (const ext of JS_EXTENSIONS) {
    candidates.push(`${raw}/index${ext}`)
  }

  for (const candidate of candidates) {
    if (pathSet.has(candidate)) return candidate
  }
  return null
}

function resolveRelative(fromPath: string, specifier: string, pathSet: Set<string>): string | null {
  const base = dirname(fromPath)
  const parts = `${base}/${specifier}`.split('/')
  const stack: string[] = []

  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }

  return resolveJsPath(stack.join('/'), pathSet)
}

function resolveAlias(fromPath: string, specifier: string, pathSet: Set<string>): string | null {
  const tail = specifier.replace(/^[@~]\//, '')
  const marker = '/src/'
  const markerIndex = fromPath.indexOf(marker)

  // 同一个仓库里可能有多套前端（blog / admin），优先落在当前文件所属的 src 下
  if (markerIndex >= 0) {
    const base = fromPath.slice(0, markerIndex + marker.length)
    const hit = resolveJsPath(`${base}${tail}`, pathSet)
    if (hit) return hit
  }

  // 没有 src 目录时，退回到“路径后缀唯一命中”
  const suffix = `/src/${tail}`
  const matches: string[] = []
  for (const path of pathSet) {
    if (path.endsWith(suffix)) matches.push(path)
  }
  return matches.length === 1 ? matches[0] : null
}

function isJava(path: string): boolean {
  return path.endsWith('.java')
}

function isJsLike(path: string): boolean {
  return /\.(js|jsx|ts|tsx|vue|mjs|cjs)$/i.test(path)
}

function scanJava(files: CandidateSourceFile[]): CandidateScan {
  const classIndex = new Map<string, string>()

  for (const file of files) {
    const lines = file.text.split(/\r?\n/).slice(0, MAX_LINES)
    const packageLine = lines.find((line) => /^\s*package\s+[\w.]+\s*;/.test(line))
    const packageMatch = packageLine?.match(/^\s*package\s+([\w.]+)\s*;/)
    if (!packageMatch) continue
    const className = basename(file.path).replace(/\.java$/i, '')
    classIndex.set(`${packageMatch[1]}.${className}`, file.path)
  }

  const edges: CandidateEdge[] = []
  const unresolved: UnresolvedImport[] = []
  const seen = new Set<string>()

  for (const file of files) {
    const lines = file.text.split(/\r?\n/).slice(0, MAX_LINES)
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\s*import\s+(static\s+)?([\w.]+)(\.\*)?\s*;/)
      if (!match) continue

      const specifier = match[2]
      if (match[3]) {
        unresolved.push({ from: file.path, specifier: `${specifier}.*`, line: i + 1 })
        continue
      }

      let target = classIndex.get(specifier)
      if (!target && match[1]) {
        // static import 可能指向类里的字段/方法，去掉最后一段再试
        const owner = specifier.split('.').slice(0, -1).join('.')
        target = classIndex.get(owner)
      }
      if (!target) {
        unresolved.push({ from: file.path, specifier, line: i + 1 })
        continue
      }
      if (target === file.path) continue

      const key = `${file.path}->${target}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: file.path, to: target, evidence: lines[i].trim(), line: i + 1 })
    }
  }

  return {
    edges,
    unresolved,
    filesParsed: files.length,
    filesWithImports: new Set(edges.map((edge) => edge.from)).size,
    paths: files.map((file) => file.path),
  }
}

function scanJs(files: CandidateSourceFile[], pathSet: Set<string>): CandidateScan {
  const edges: CandidateEdge[] = []
  const unresolved: UnresolvedImport[] = []
  const seen = new Set<string>()

  for (const file of files) {
    const lines = file.text.split(/\r?\n/).slice(0, MAX_LINES)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const specifiers: string[] = []

      for (const match of line.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specifiers.push(match[1])
      for (const match of line.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) specifiers.push(match[1])
      for (const match of line.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        specifiers.push(match[1])
      }
      for (const match of line.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        specifiers.push(match[1])
      }

      for (const specifier of specifiers) {
        let target: string | null
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          target = resolveRelative(file.path, specifier, pathSet)
        } else if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
          target = resolveAlias(file.path, specifier, pathSet)
        } else {
          // 第三方包或框架别名，不参与文件级候选边
          continue
        }

        if (!target) {
          unresolved.push({ from: file.path, specifier, line: i + 1 })
          continue
        }
        if (target === file.path) continue

        const key = `${file.path}->${target}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ from: file.path, to: target, evidence: line.trim(), line: i + 1 })
      }
    }
  }

  return {
    edges,
    unresolved,
    filesParsed: files.length,
    filesWithImports: new Set(edges.map((edge) => edge.from)).size,
    paths: files.map((file) => file.path),
  }
}

/** 从一批源文件里扫出文件级候选边；输入路径应当是完整相对路径 */
export function scanCandidateEdges(files: CandidateSourceFile[]): CandidateScan {
  const normalized = files
    .map((file) => ({ path: normalizeCandidatePath(file.path), text: file.text }))
    .filter((file) => file.path && file.text)

  const pathSet = new Set(normalized.map((file) => file.path))
  const javaFiles = normalized.filter((file) => isJava(file.path))
  const jsFiles = normalized.filter((file) => isJsLike(file.path))

  const java = javaFiles.length ? scanJava(javaFiles) : null
  const js = jsFiles.length ? scanJs(jsFiles, pathSet) : null

  const byKey = new Map<string, CandidateEdge>()
  const unresolved: UnresolvedImport[] = []
  for (const scan of [java, js]) {
    if (!scan) continue
    for (const edge of scan.edges) {
      const key = `${edge.from}->${edge.to}`
      if (!byKey.has(key)) byKey.set(key, edge)
    }
    unresolved.push(...scan.unresolved)
  }

  return {
    edges: [...byKey.values()],
    unresolved,
    filesParsed: normalized.length,
    filesWithImports: new Set([...byKey.values()].map((edge) => edge.from)).size,
    paths: normalized.map((file) => file.path),
  }
}
