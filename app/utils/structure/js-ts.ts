/**
 * JavaScript / TypeScript / React 的结构事实适配器。
 *
 * 逐行提取能确定的 import/export 和符号，不做完整 AST。
 * React 只多认一个东西：组件定义和 JSX 里的组件使用。
 */
import type {
  HardFact,
  HardFactGraph,
  ProjectStructureAdapter,
  StructureProfile,
  StructureSourceFile,
  StructureSymbol,
} from '~/types/structure'
import { buildLineCounts, normalizeStructurePath, selectGraphFacts } from './common.ts'
import { frontendModulePathSet, resolveFrontendModule } from './module-paths.ts'

const JS_EXT = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i
const REACT_EXT = /\.(?:jsx|tsx)$/i

const IMPORT_FROM_RE = /^\s*(?:import|export)\s+(.+?)\s+from\s+['"]([^'"]+)['"]/
const IMPORT_SIDE_EFFECT_RE = /^\s*import\s+['"]([^'"]+)['"]/
const REQUIRE_RE = /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const SYMBOL_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/
const COMPONENT_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(class|function|const)\s+([A-Z][\w$]*)/

export function importNames(clause: string): string[] {
  const names: string[] = []
  const cleaned = clause.trim().replace(/^type\s+/, '')
  const defaultMatch = cleaned.match(/^([A-Za-z_$][\w$]*)/)
  if (defaultMatch) names.push(defaultMatch[1]!)
  const named = cleaned.match(/\{([^}]*)\}/)
  if (named) {
    for (const part of named[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.push(name)
    }
  }
  const namespace = cleaned.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
  if (namespace) names.push(namespace[1]!)
  return names
}

function symbolKind(kind: string): StructureSymbol['kind'] {
  if (kind === 'class') return 'class'
  if (kind === 'interface') return 'interface'
  if (kind === 'enum') return 'enum'
  if (kind === 'function') return 'function'
  return 'variable'
}

export function analyzeJsLikeFiles(
  files: StructureSourceFile[],
  profile: StructureProfile,
  react = false,
): HardFactGraph {
  const sourceFiles = files.filter((file) => (react ? REACT_EXT.test(file.path) : JS_EXT.test(file.path) && !REACT_EXT.test(file.path)))
  const pathSet = frontendModulePathSet(files)
  const facts: HardFact[] = []
  const symbols: Record<string, StructureSymbol> = {}
  const lineCounts = buildLineCounts(sourceFiles)

  for (const file of sourceFiles) {
    const path = normalizeStructurePath(file.path)
    const lines = file.text.split(/\r?\n/)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const lineNo = i + 1
      const from = line.match(IMPORT_FROM_RE)
      const sideEffect = line.match(IMPORT_SIDE_EFFECT_RE)
      const specifier = from?.[2] ?? sideEffect?.[1]
      if (specifier) {
        const target = resolveFrontendModule(path, specifier, pathSet)
        const names = from ? importNames(from[1]!) : []
        const object = names[0] ?? specifier
        facts.push({
          id: `import:${path}:${lineNo}:${specifier}`,
          kind: 'import',
          path,
          line: lineNo,
          quote: line.trim(),
          text: `${path}:${lineNo} import ${names.length ? names.join(', ') : specifier}${target ? ` → ${target}` : ''}`,
          subject: path,
          predicate: 'import',
          object,
          relatedPaths: target ? [path, target] : [path],
        })
      }

      for (const match of line.matchAll(REQUIRE_RE)) {
        const spec = match[1]!
        const target = resolveFrontendModule(path, spec, pathSet)
        facts.push({
          id: `require:${path}:${lineNo}:${spec}`,
          kind: 'import',
          path,
          line: lineNo,
          quote: line.trim(),
          text: `${path}:${lineNo} require ${spec}${target ? ` → ${target}` : ''}`,
          subject: path,
          predicate: 'import',
          object: spec,
          relatedPaths: target ? [path, target] : [path],
        })
      }

      const symbol = line.match(SYMBOL_RE)
      if (symbol) {
        const name = symbol[2]!
        const kind = symbolKind(symbol[1]!)
        if (!symbols[name]) symbols[name] = { path, line: lineNo, kind }
        facts.push({
          id: `symbol:${path}:${lineNo}:${name}`,
          kind: 'symbol',
          path,
          line: lineNo,
          quote: line.trim(),
          text: `${path}:${lineNo} ${symbol[1]} ${name}`,
          subject: name,
          predicate: 'symbol',
          object: name,
          relatedPaths: [path],
        })
      }

      if (react) {
        const component = line.match(COMPONENT_RE)
        if (component) {
          const name = component[2]!
          if (!symbols[name]) symbols[name] = { path, line: lineNo, kind: 'component' }
          facts.push({
            id: `component:${path}:${lineNo}:${name}`,
            kind: 'component',
            path,
            line: lineNo,
            quote: line.trim(),
            text: `${path}:${lineNo} component ${name}`,
            subject: name,
            predicate: 'component',
            object: name,
            relatedPaths: [path],
          })
        }
      }
    }
  }

  if (react) {
    for (const file of sourceFiles) {
      const path = normalizeStructurePath(file.path)
      const lines = file.text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        for (const match of lines[i]!.matchAll(/<([A-Z][\w$]*)/g)) {
          const name = match[1]!
          const target = symbols[name]?.path
          facts.push({
            id: `component-use:${path}:${i + 1}:${name}`,
            kind: 'component-use',
            path,
            line: i + 1,
            quote: lines[i]!.trim(),
            text: `${path}:${i + 1} 使用组件 ${name}`,
            subject: path,
            predicate: 'component-use',
            object: name,
            relatedPaths: target ? [path, target] : [path],
          })
        }
      }
    }
  }

  return {
    profile,
    files: sourceFiles.map((file) => normalizeStructurePath(file.path)),
    facts,
    conflicts: [],
    symbols,
    packages: {},
    lineCounts,
  }
}

export const jsTsAdapter: ProjectStructureAdapter = {
  id: 'js-ts',
  detect(files) {
    return files.some((file) => JS_EXT.test(file.path) && !REACT_EXT.test(file.path))
  },
  analyze(files) {
    return analyzeJsLikeFiles(files, 'js-ts')
  },
  selectFacts(graph, path) {
    return selectGraphFacts(graph, path)
  },
}

export const reactAdapter: ProjectStructureAdapter = {
  id: 'react',
  detect(files) {
    return files.some((file) => REACT_EXT.test(file.path))
  },
  analyze(files) {
    return analyzeJsLikeFiles(files, 'react', true)
  },
  selectFacts(graph, path) {
    return selectGraphFacts(graph, path)
  },
}
