/**
 * Python 的结构事实适配器。
 *
 * 逐行提取 import、class、def；相对 import 按当前位置解析，
 * 解析不到就保留原 module 名，不假装有关系。
 */
import type {
  HardFact,
  HardFactGraph,
  ProjectStructureAdapter,
  StructureSymbol,
} from '~/types/structure'
import { buildLineCounts, normalizeStructurePath, selectGraphFacts } from './common.ts'

const PY_EXT = /\.py$/i
const IMPORT_RE = /^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/
const FROM_RE = /^\s*from\s+([.\w]+)\s+import\s+(.+)/
const CLASS_RE = /^\s*class\s+([A-Za-z_]\w*)/
const DEF_RE = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/

function moduleCandidates(module: string): string[] {
  const base = module.replace(/\./g, '/')
  return [`${base}.py`, `${base}/__init__.py`]
}

function resolveAbsolute(module: string, pathSet: Set<string>): string | null {
  const candidates = moduleCandidates(module)
  const matches = [...pathSet].filter((path) =>
    candidates.some((candidate) => path.endsWith(`/${candidate}`) || path === candidate),
  )
  return matches.length === 1 ? matches[0]! : null
}

function resolveRelative(fromPath: string, module: string, pathSet: Set<string>): string | null {
  const level = module.match(/^\.+/)?.[0].length ?? 0
  const tail = module.slice(level).replace(/\./g, '/')
  const parts = fromPath.split('/').slice(0, -1)
  for (let i = 1; i < level; i++) parts.pop()
  const base = [...parts, ...(tail ? [tail] : [])].join('/')
  for (const candidate of moduleCandidates(base)) {
    if (pathSet.has(candidate)) return candidate
  }
  return null
}

export const pythonAdapter: ProjectStructureAdapter = {
  id: 'python',
  detect(files) {
    return files.some((file) => PY_EXT.test(file.path))
  },
  analyze(files): HardFactGraph {
    const pyFiles = files.filter((file) => PY_EXT.test(file.path))
    const pathSet = new Set(files.map((file) => normalizeStructurePath(file.path)))
    const facts: HardFact[] = []
    const symbols: Record<string, StructureSymbol> = {}
    const lineCounts = buildLineCounts(pyFiles)

    for (const file of pyFiles) {
      const path = normalizeStructurePath(file.path)
      const lines = file.text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const lineNo = i + 1
        const absolute = line.match(IMPORT_RE)
        const relative = line.match(FROM_RE)
        const module = absolute?.[1] ?? relative?.[1]
        if (module) {
          const target = module.startsWith('.')
            ? resolveRelative(path, module, pathSet)
            : resolveAbsolute(module, pathSet)
          const names = relative?.[2]
            ?.split(',')
            .map((part) => part.trim().split(/\s+as\s+/).pop()?.trim())
            .filter(Boolean)
          facts.push({
            id: `py-import:${path}:${lineNo}:${module}`,
            kind: 'import',
            path,
            line: lineNo,
            quote: line.trim(),
            text: `${path}:${lineNo} import ${module}${target ? ` → ${target}` : ''}`,
            subject: path,
            predicate: 'import',
            object: names?.[0] ?? module,
            relatedPaths: target ? [path, target] : [path],
          })
        }

        const classMatch = line.match(CLASS_RE)
        const defMatch = line.match(DEF_RE)
        const name = classMatch?.[1] ?? defMatch?.[1]
        if (name) {
          const kind = classMatch ? 'class' : 'function'
          if (!symbols[name]) symbols[name] = { path, line: lineNo, kind }
          facts.push({
            id: `py-symbol:${path}:${lineNo}:${name}`,
            kind: 'symbol',
            path,
            line: lineNo,
            quote: line.trim(),
            text: `${path}:${lineNo} ${kind} ${name}`,
            subject: name,
            predicate: 'symbol',
            object: name,
            relatedPaths: [path],
          })
        }
      }
    }

    return {
      profile: 'python',
      files: pyFiles.map((file) => normalizeStructurePath(file.path)),
      facts,
      conflicts: [],
      symbols,
      packages: {},
      lineCounts,
    }
  },
  selectFacts(graph, path) {
    return selectGraphFacts(graph, path)
  },
}
