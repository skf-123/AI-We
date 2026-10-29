/**
 * CSS / SCSS / LESS 的结构事实适配器。
 *
 * 只认 @import 和选择器；这是弱事实，用来给逐文件解释补一点上下文，
 * 不判断样式是否生效。
 */
import type {
  HardFact,
  HardFactGraph,
  ProjectStructureAdapter,
} from '~/types/structure'
import { buildLineCounts, normalizeStructurePath, selectGraphFacts } from './common.ts'

const CSS_EXT = /\.(?:css|scss|less)$/i
const IMPORT_RE = /^\s*@import\s+(?:url\()?['"]([^'"]+)['"]/

export const cssAdapter: ProjectStructureAdapter = {
  id: 'css',
  detect(files) {
    return files.some((file) => CSS_EXT.test(file.path))
  },
  analyze(files): HardFactGraph {
    const cssFiles = files.filter((file) => CSS_EXT.test(file.path))
    const facts: HardFact[] = []
    const lineCounts = buildLineCounts(cssFiles)

    for (const file of cssFiles) {
      const path = normalizeStructurePath(file.path)
      const lines = file.text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const lineNo = i + 1
        const imported = line.match(IMPORT_RE)
        if (imported) {
          const specifier = imported[1]!
          facts.push({
            id: `css-import:${path}:${lineNo}:${specifier}`,
            kind: 'css-import',
            path,
            line: lineNo,
            quote: line.trim(),
            text: `${path}:${lineNo} @import ${specifier}`,
            subject: path,
            predicate: 'css-import',
            object: specifier,
            relatedPaths: [path],
          })
          continue
        }

        const selector = line.match(/^\s*([^@{}][^{}]*)\{\s*$/)
        if (!selector) continue
        const value = selector[1]!.trim()
        if (!value || value.startsWith('//') || value.startsWith('/*')) continue
        facts.push({
          id: `css-selector:${path}:${lineNo}:${value}`,
          kind: 'css-selector',
          path,
          line: lineNo,
          quote: line.trim(),
          text: `${path}:${lineNo} selector ${value}`,
          subject: path,
          predicate: 'selector',
          object: value,
          relatedPaths: [path],
        })
      }
    }

    return {
      profile: 'css',
      files: cssFiles.map((file) => normalizeStructurePath(file.path)),
      facts,
      conflicts: [],
      symbols: {},
      packages: {},
      lineCounts,
    }
  },
  selectFacts(graph, path) {
    return selectGraphFacts(graph, path)
  },
}
