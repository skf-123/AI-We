/**
 * SQL 的结构事实适配器。
 *
 * 只认 CREATE TABLE、列定义和 REFERENCES；不做 SQL 方言解析，
 * 也不判断查询是否正确。
 */
import type {
  HardFact,
  HardFactGraph,
  ProjectStructureAdapter,
  StructureSymbol,
} from '~/types/structure'
import { buildLineCounts, normalizeStructurePath, selectGraphFacts } from './common.ts'

const SQL_EXT = /\.sql$/i
const CREATE_TABLE_RE =
  /^\s*create\s+(?:or\s+replace\s+)?table\s+(?:if\s+not\s+exists\s+)?[`"[]?([\w.]+)[`"\]]?/i
const REFERENCES_RE = /\breferences\s+[`"[]?([\w.]+)[`"\]]?/i
const COLUMN_RE = /^\s*[`"[]?([A-Za-z_]\w*)[`"\]]?\s+[A-Za-z]/

export const sqlAdapter: ProjectStructureAdapter = {
  id: 'sql',
  detect(files) {
    return files.some((file) => SQL_EXT.test(file.path))
  },
  analyze(files): HardFactGraph {
    const sqlFiles = files.filter((file) => SQL_EXT.test(file.path))
    const facts: HardFact[] = []
    const symbols: Record<string, StructureSymbol> = {}
    const lineCounts = buildLineCounts(sqlFiles)

    for (const file of sqlFiles) {
      const path = normalizeStructurePath(file.path)
      const lines = file.text.split(/\r?\n/)
      let currentTable: string | null = null

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const lineNo = i + 1
        const create = line.match(CREATE_TABLE_RE)
        if (create) {
          currentTable = create[1]!
          symbols[currentTable] = { path, line: lineNo, kind: 'table' }
          facts.push({
            id: `sql-table:${path}:${lineNo}:${currentTable}`,
            kind: 'table',
            path,
            line: lineNo,
            quote: line.trim(),
            text: `${path}:${lineNo} table ${currentTable}`,
            subject: currentTable,
            predicate: 'table',
            object: currentTable,
            relatedPaths: [path],
          })
          continue
        }

        if (currentTable && /^\s*\);?\s*$/.test(line)) {
          currentTable = null
          continue
        }
        if (!currentTable) continue

        const column = line.match(COLUMN_RE)
        if (column) {
          const name = column[1]!
          if (!/^(primary|foreign|unique|constraint|key|index|check)$/i.test(name)) {
            facts.push({
              id: `sql-column:${path}:${lineNo}:${currentTable}.${name}`,
              kind: 'column',
              path,
              line: lineNo,
              quote: line.trim(),
              text: `${path}:${lineNo} ${currentTable}.${name}`,
              subject: currentTable,
              predicate: 'column',
              object: name,
              relatedPaths: [path],
            })
          }
        }

        const ref = line.match(REFERENCES_RE)
        if (ref) {
          facts.push({
            id: `sql-fk:${path}:${lineNo}:${ref[1]}`,
            kind: 'foreign-key',
            path,
            line: lineNo,
            quote: line.trim(),
            text: `${path}:${lineNo} ${currentTable} references ${ref[1]}`,
            subject: currentTable,
            predicate: 'foreign-key',
            object: ref[1]!,
            relatedPaths: [path],
          })
        }
      }
    }

    return {
      profile: 'sql',
      files: sqlFiles.map((file) => normalizeStructurePath(file.path)),
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
