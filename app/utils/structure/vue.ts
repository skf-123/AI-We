/**
 * Vue 单文件组件的结构事实适配器。
 *
 * 认 script 里的 import、组件名、模板里的 PascalCase 组件标签，
 * 不做完整 SFC 编译，也不判断运行时。
 */
import type {
  HardFact,
  HardFactGraph,
  ProjectStructureAdapter,
  StructureSymbol,
} from '~/types/structure'
import { buildLineCounts, normalizeStructurePath, selectGraphFacts } from './common.ts'
import { frontendModulePathSet, resolveFrontendModule } from './module-paths.ts'
import { importNames } from './js-ts.ts'

const VUE_EXT = /\.vue$/i
const IMPORT_FROM_RE = /^\s*(?:import|export)\s+(.+?)\s+from\s+['"]([^'"]+)['"]/
const NAME_RE = /\bname\s*:\s*['"]([A-Za-z_$][\w$]*)['"]/

export const vueAdapter: ProjectStructureAdapter = {
  id: 'vue',
  detect(files) {
    return files.some((file) => VUE_EXT.test(file.path))
  },
  analyze(files): HardFactGraph {
    const vueFiles = files.filter((file) => VUE_EXT.test(file.path))
    const pathSet = frontendModulePathSet(files)
    const facts: HardFact[] = []
    const symbols: Record<string, StructureSymbol> = {}
    const lineCounts = buildLineCounts(vueFiles)

    for (const file of vueFiles) {
      const path = normalizeStructurePath(file.path)
      const lines = file.text.split(/\r?\n/)
      const fallbackName = path.split('/').pop()?.replace(/\.vue$/i, '') ?? 'Component'
      const nameMatch = lines.map((line) => line.match(NAME_RE)).find(Boolean)
      const componentName = nameMatch?.[1] ?? fallbackName

      symbols[componentName] = {
        path,
        line: nameMatch ? lines.findIndex((line) => NAME_RE.test(line)) + 1 : 1,
        kind: 'component',
      }
      facts.push({
        id: `vue-component:${path}`,
        kind: 'component',
        path,
        line: symbols[componentName]!.line,
        quote: nameMatch ? lines[symbols[componentName]!.line - 1]!.trim() : path,
        text: `${path}:${symbols[componentName]!.line} 组件 ${componentName}`,
        subject: componentName,
        predicate: 'component',
        object: componentName,
        relatedPaths: [path],
      })

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const lineNo = i + 1
        const from = line.match(IMPORT_FROM_RE)
        if (from) {
          const specifier = from[2]!
          const target = resolveFrontendModule(path, specifier, pathSet)
          const names = importNames(from[1]!)
          facts.push({
            id: `vue-import:${path}:${lineNo}:${specifier}`,
            kind: 'import',
            path,
            line: lineNo,
            quote: line.trim(),
            text: `${path}:${lineNo} import ${names.length ? names.join(', ') : specifier}${target ? ` → ${target}` : ''}`,
            subject: path,
            predicate: 'import',
            object: names[0] ?? specifier,
            relatedPaths: target ? [path, target] : [path],
          })
        }

        for (const match of line.matchAll(/<([A-Z][\w$]*)/g)) {
          const tag = match[1]!
          const target = symbols[tag]?.path
          facts.push({
            id: `vue-component-use:${path}:${lineNo}:${tag}`,
            kind: 'component-use',
            path,
            line: lineNo,
            quote: line.trim(),
            text: `${path}:${lineNo} 使用组件 ${tag}`,
            subject: path,
            predicate: 'component-use',
            object: tag,
            relatedPaths: target ? [path, target] : [path],
          })
        }
      }
    }

    return {
      profile: 'vue',
      files: vueFiles.map((file) => normalizeStructurePath(file.path)),
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
