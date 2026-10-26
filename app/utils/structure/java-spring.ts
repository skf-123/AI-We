/**
 * Java / Spring / MyBatis 的结构事实适配器。
 *
 * 只做逐行能确定的硬事实：package、import、类/接口、字段类型、注解、
 * XML namespace、扫描包、@WebServlet。不做完整 AST，也不判断业务语义。
 *
 * 这是 Stage 1 的唯一适配器；核心只认 ProjectStructureAdapter 和 HardFactGraph，
 * 以后加 JS/TS / Python 时新增同级文件即可，不需要改这里以外的核心。
 */
import type {
  HardFact,
  ProjectStructureAdapter,
  StructureConflict,
  StructureSourceFile,
  StructureSymbol,
} from '~/types/structure'

const PACKAGE_RE = /^\s*package\s+([\w.]+)\s*;/
const IMPORT_RE = /^\s*import\s+(static\s+)?([\w.*]+)\s*;/
const TYPE_RE = /^\s*(?:public\s+)?(?:abstract\s+|final\s+)?(class|interface|enum)\s+(\w+)/
const IMPLEMENTS_RE = /\bimplements\s+([\w.,\s<>]+)/

/** 字段：只认「访问修饰符 + 类型 + 名字 + 分号」，避免把方法当字段 */
const FIELD_RE =
  /^\s*(?:private|protected|public)\s+(?:static\s+)?(?:final\s+)?([\w.$]+(?:<[^;{}]*>)?)\s+(\w+)\s*(?:=[^;]*)?;/

const TYPE_ANNOTATIONS = [
  'Service',
  'Controller',
  'RestController',
  'Component',
  'Repository',
  'Configuration',
  'Mapper',
  'SpringBootApplication',
]

const MAPPER_SCANNER_RE = /setBasePackage\s*\(\s*"([^"]+)"\s*\)/
const WEB_SERVLET_RE = /@WebServlet\s*\(([^)]*)\)/
const IMPORT_ANNOTATION_RE = /@Import\s*\(([^)]*)\)/
const COMPONENT_SCAN_RE = /@ComponentScan\s*\(([^)]*)\)/

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '')
}

function lineOf(lines: string[], index: number): number {
  return index + 1
}

function stripGenerics(type: string): string {
  return type.replace(/<.*>/g, '').replace(/\[\]/g, '').trim()
}

function simpleName(fqn: string): string {
  const clean = stripGenerics(fqn)
  const index = clean.lastIndexOf('.')
  return index === -1 ? clean : clean.slice(index + 1)
}

function isProjectJava(path: string): boolean {
  return /\.java$/i.test(path)
}

function isXml(path: string): boolean {
  return /\.xml$/i.test(path)
}

interface JavaFileInfo {
  path: string
  lines: string[]
  packageLine: number
  packageName: string
  imports: { fqn: string; line: number; text: string }[]
  types: { name: string; kind: 'class' | 'interface' | 'enum'; line: number; text: string; implements: string }[]
  fields: { type: string; name: string; line: number; text: string; autowired: boolean }[]
  annotations: { name: string; args: string; line: number; text: string; target: string }[]
}

function parseJavaFile(file: StructureSourceFile): JavaFileInfo {
  const lines = file.text.replace(/\r\n/g, '\n').split('\n')
  let packageLine = 0
  let packageName = ''
  const imports: JavaFileInfo['imports'] = []
  const types: JavaFileInfo['types'] = []
  const fields: JavaFileInfo['fields'] = []
  const annotations: JavaFileInfo['annotations'] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNumber = lineOf(lines, i)

    if (!packageName) {
      const pkg = line.match(PACKAGE_RE)
      if (pkg) {
        packageName = pkg[1]!
        packageLine = lineNumber
        continue
      }
    }

    const imp = line.match(IMPORT_RE)
    if (imp) {
      if (!imp[1]) imports.push({ fqn: imp[2]!, line: lineNumber, text: line.trim() })
      continue
    }

    const type = line.match(TYPE_RE)
    if (type) {
      const impl = line.match(IMPLEMENTS_RE)
      types.push({
        name: type[2]!,
        kind: type[1] as 'class' | 'interface' | 'enum',
        line: lineNumber,
        text: line.trim(),
        implements: impl?.[1]?.trim() ?? '',
      })
    }

    const field = line.match(FIELD_RE)
    if (field) {
      const previous = i > 0 ? lines[i - 1]! : ''
      fields.push({
        type: field[1]!,
        name: field[2]!,
        line: lineNumber,
        text: line.trim(),
        autowired: /@Autowired\b/.test(line) || /@Autowired\b/.test(previous),
      })
    }

    for (const name of TYPE_ANNOTATIONS) {
      const match = line.match(new RegExp(`@${name}\\b`))
      if (match) {
        annotations.push({ name, args: '', line: lineNumber, text: line.trim(), target: '' })
        break
      }
    }

    const servlet = line.match(WEB_SERVLET_RE)
    if (servlet) {
      annotations.push({ name: 'WebServlet', args: servlet[1]!, line: lineNumber, text: line.trim(), target: '' })
    }

    const importAnn = line.match(IMPORT_ANNOTATION_RE)
    if (importAnn) {
      annotations.push({ name: 'Import', args: importAnn[1]!, line: lineNumber, text: line.trim(), target: '' })
    }

    const componentScan = line.match(COMPONENT_SCAN_RE)
    if (componentScan) {
      annotations.push({
        name: 'ComponentScan',
        args: componentScan[1]!,
        line: lineNumber,
        text: line.trim(),
        target: '',
      })
    }
  }

  return { path: normalizePath(file.path), lines, packageLine, packageName, imports, types, fields, annotations }
}

function parseXmlFile(file: StructureSourceFile) {
  const path = normalizePath(file.path)
  const lines = file.text.replace(/\r\n/g, '\n').split('\n')
  const namespaces: { ns: string; line: number; text: string }[] = []
  const scanPackages: { pkg: string; line: number; text: string }[] = []
  const componentScans: { pkg: string; line: number; text: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineNumber = lineOf(lines, i)

    if (/<mapper\b/.test(line)) {
      const ns = line.match(/namespace\s*=\s*"([^"]+)"/)
      if (ns) namespaces.push({ ns: ns[1]!, line: lineNumber, text: line.trim() })
    }

    if (/name\s*=\s*"basePackage"/.test(line)) {
      const value = line.match(/value\s*=\s*"([^"]+)"/)
      if (value) scanPackages.push({ pkg: value[1]!, line: lineNumber, text: line.trim() })
    }

    if (/<context:component-scan\b/.test(line)) {
      const value = line.match(/base-package\s*=\s*"([^"]+)"/)
      if (value) componentScans.push({ pkg: value[1]!, line: lineNumber, text: line.trim() })
    }
  }

  return { path, lines, namespaces, scanPackages, componentScans }
}

function splitImplements(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export const javaSpringAdapter: ProjectStructureAdapter = {
  id: 'java-spring',

  detect(files) {
    return files.some((file) => isProjectJava(file.path))
  },

  analyze(files) {
    const javaFiles = files.filter((file) => isProjectJava(file.path)).map(parseJavaFile)
    const xmlFiles = files.filter((file) => isXml(file.path)).map(parseXmlFile)

    const symbols: Record<string, StructureSymbol> = {}
    const packages: Record<string, string> = {}
    const simpleToFqn = new Map<string, string[]>()

    for (const file of javaFiles) {
      packages[file.path] = file.packageName
      for (const type of file.types) {
        const fqn = file.packageName ? `${file.packageName}.${type.name}` : type.name
        symbols[fqn] = { path: file.path, line: type.line, kind: type.kind }
        const list = simpleToFqn.get(type.name) ?? []
        list.push(fqn)
        simpleToFqn.set(type.name, list)
      }
    }

    const resolveType = (raw: string, currentFile: JavaFileInfo): string | null => {
      const clean = stripGenerics(raw).replace(/\.class$/, '')
      if (!clean) return null
      if (clean.includes('.')) return symbols[clean] ? clean : clean

      const imported = currentFile.imports.find((item) => simpleName(item.fqn) === clean)
      if (imported) return imported.fqn

      const candidates = simpleToFqn.get(clean) ?? []
      if (candidates.length === 1) return candidates[0]!

      const samePackage = currentFile.packageName ? `${currentFile.packageName}.${clean}` : clean
      if (symbols[samePackage]) return samePackage

      return null
    }

    const facts: HardFact[] = []
    const conflicts: StructureConflict[] = []
    const fieldFacts: { fact: HardFact; typeFqn: string | null; file: JavaFileInfo }[] = []
    const scanFacts: { fact: HardFact; pkg: string; path: string }[] = []
    const namespaceFacts: { fact: HardFact; ns: string; path: string }[] = []

    const addFact = (fact: HardFact) => {
      facts.push(fact)
    }

    for (const file of javaFiles) {
      if (file.packageName) {
        addFact({
          id: `pkg:${file.path}`,
          kind: 'package',
          path: file.path,
          line: file.packageLine,
          quote: file.lines[file.packageLine - 1]?.trim() ?? `package ${file.packageName};`,
          text: `${file.path}:${file.packageLine} package ${file.packageName};`,
          subject: file.path,
          predicate: 'package',
          object: file.packageName,
        })
      }

      for (const type of file.types) {
        const fqn = file.packageName ? `${file.packageName}.${type.name}` : type.name
        addFact({
          id: `fqn:${fqn}`,
          kind: 'fqn',
          path: file.path,
          line: type.line,
          quote: type.text,
          text: `${file.path}:${type.line} ${type.kind} ${fqn}`,
          subject: fqn,
          predicate: 'fqn',
          object: fqn,
        })
      }

      for (const imp of file.imports) {
        const fqn = imp.fqn
        const target = symbols[fqn]
        if (!target) continue // 外部库的 import 不进事实图，模型看代码本身
        addFact({
          id: `import:${file.path}:${imp.line}`,
          kind: 'import',
          path: file.path,
          line: imp.line,
          quote: imp.text,
          text: `${file.path}:${imp.line} import ${fqn}`,
          subject: file.path,
          predicate: 'import',
          object: fqn,
          relatedPaths: [file.path, target.path],
        })
      }

      for (const field of file.fields) {
        const typeFqn = resolveType(field.type, file)
        if (!typeFqn && !field.autowired) continue
        const fact: HardFact = {
          id: `field:${file.path}:${field.line}`,
          kind: 'field-type',
          path: file.path,
          line: field.line,
          quote: field.text,
          text: `${file.path}:${field.line} ${field.name} : ${typeFqn ?? field.type}`,
          subject: `${file.path}#${field.name}`,
          predicate: 'field-type',
          object: typeFqn ?? field.type,
          relatedPaths: typeFqn && symbols[typeFqn] ? [file.path, symbols[typeFqn]!.path] : [file.path],
        }
        addFact(fact)
        fieldFacts.push({ fact, typeFqn, file })
      }

      for (const ann of file.annotations) {
        const owner = file.types[0]?.name ?? file.path
        const ownerFqn = file.packageName ? `${file.packageName}.${owner}` : owner
        addFact({
          id: `ann:${file.path}:${ann.line}:${ann.name}`,
          kind: 'annotation',
          path: file.path,
          line: ann.line,
          quote: ann.text,
          text: `${file.path}:${ann.line} @${ann.name}${ann.args ? `(${ann.args.trim()})` : ''}`,
          subject: ownerFqn,
          predicate: 'annotation',
          object: `${ann.name}${ann.args ? `(${ann.args.trim()})` : ''}`,
        })
      }

      for (const type of file.types) {
        const impl = splitImplements(type.implements)
        if (impl.length === 0) continue
        const classFqn = file.packageName ? `${file.packageName}.${type.name}` : type.name
        for (const raw of impl) {
          const fqn = resolveType(raw, file) ?? raw
          addFact({
            id: `impl:${classFqn}:${fqn}`,
            kind: 'implements',
            path: file.path,
            line: type.line,
            quote: type.text,
            text: `${file.path}:${type.line} ${classFqn} implements ${fqn}`,
            subject: classFqn,
            predicate: 'implements',
            object: fqn,
            relatedPaths: symbols[fqn] ? [file.path, symbols[fqn]!.path] : [file.path],
          })
        }
      }

      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i]!
        const scanner = line.match(MAPPER_SCANNER_RE)
        if (scanner) {
          const fact: HardFact = {
            id: `scan:${file.path}:${i + 1}`,
            kind: 'scan-package',
            path: file.path,
            line: i + 1,
            quote: line.trim(),
            text: `${file.path}:${i + 1} setBasePackage("${scanner[1]}")`,
            subject: file.path,
            predicate: 'scan-package',
            object: scanner[1]!,
          }
          addFact(fact)
          scanFacts.push({ fact, pkg: scanner[1]!, path: file.path })
        }
      }
    }

    for (const file of xmlFiles) {
      for (const ns of file.namespaces) {
        const fact: HardFact = {
          id: `ns:${file.path}:${ns.line}`,
          kind: 'xml-namespace',
          path: file.path,
          line: ns.line,
          quote: ns.text,
          text: `${file.path}:${ns.line} namespace="${ns.ns}"`,
          subject: file.path,
          predicate: 'xml-namespace',
          object: ns.ns,
        }
        addFact(fact)
        namespaceFacts.push({ fact, ns: ns.ns, path: file.path })
      }

      for (const scan of file.scanPackages) {
        const fact: HardFact = {
          id: `scan:${file.path}:${scan.line}`,
          kind: 'scan-package',
          path: file.path,
          line: scan.line,
          quote: scan.text,
          text: `${file.path}:${scan.line} basePackage="${scan.pkg}"`,
          subject: file.path,
          predicate: 'scan-package',
          object: scan.pkg,
        }
        addFact(fact)
        scanFacts.push({ fact, pkg: scan.pkg, path: file.path })
      }

      for (const scan of file.componentScans) {
        addFact({
          id: `component-scan:${file.path}:${scan.line}`,
          kind: 'component-scan',
          path: file.path,
          line: scan.line,
          quote: scan.text,
          text: `${file.path}:${scan.line} component-scan base-package="${scan.pkg}"`,
          subject: file.path,
          predicate: 'component-scan',
          object: scan.pkg,
        })
      }
    }

    // ---- 矛盾：接口包 / 扫描包 / XML namespace / 注入类型 ----
    const interfaces = Object.entries(symbols).filter(([, symbol]) => symbol.kind === 'interface')
    const bySimple = new Map<string, { fqn: string; symbol: StructureSymbol }[]>()
    for (const [fqn, symbol] of interfaces) {
      const simple = simpleName(fqn)
      const list = bySimple.get(simple) ?? []
      list.push({ fqn, symbol })
      bySimple.set(simple, list)
    }

    const scanPackages = unique(scanFacts.map((item) => item.pkg))
    const seenConflicts = new Set<string>()

    for (const ns of namespaceFacts) {
      const exact = symbols[ns.ns]
      const candidates = exact?.kind === 'interface' ? [{ fqn: ns.ns, symbol: exact }] : bySimple.get(simpleName(ns.ns)) ?? []
      if (candidates.length !== 1) continue

      const { fqn, symbol } = candidates[0]!
      const pkg = packages[symbol.path] ?? ''
      const underScan = scanPackages.some((scan) => pkg === scan || pkg.startsWith(`${scan}.`))
      const namespaceOk = ns.ns === fqn
      const injectionFields = fieldFacts.filter(
        (item) =>
          item.fact.object === fqn ||
          (item.typeFqn && simpleName(item.typeFqn) === simpleName(fqn)),
      )
      const injectionMismatch = injectionFields.some(
        (item) => item.typeFqn && item.typeFqn !== fqn && simpleName(item.typeFqn) === simpleName(fqn),
      )

      if (namespaceOk && underScan && !injectionMismatch) continue

      const key = `${fqn}|${ns.ns}|${scanPackages.join(',')}`
      if (seenConflicts.has(key)) continue
      seenConflicts.add(key)

      const scanText = scanPackages.length ? scanPackages.join('、') : '没有找到扫描包'
      const injectionText = injectionFields.length
        ? injectionFields.map((item) => `${item.fact.text}`).join('；')
        : '没有找到注入字段'
      const detail = [
        `接口 ${fqn} 的包是 ${pkg || '（没有 package 声明）'}`,
        `扫描包是 ${scanText}`,
        `XML namespace 是 ${ns.ns}`,
        `注入字段：${injectionText}`,
        namespaceOk ? 'namespace 与接口全限定名一致' : 'namespace 与接口全限定名不一致',
        underScan ? '接口包在扫描范围内' : '接口包不在扫描范围内',
        injectionMismatch ? '注入类型与接口全限定名不一致' : '注入类型与接口全限定名一致',
      ].join('；')

      const relatedPaths = unique([
        symbol.path,
        ns.path,
        ...scanFacts.map((item) => item.path),
        ...injectionFields.map((item) => item.fact.path),
      ])
      const conflict: StructureConflict = {
        id: `conflict:${conflicts.length + 1}`,
        kind: 'package-scan-namespace',
        detail,
        factIds: [ns.fact.id, ...scanFacts.map((item) => item.fact.id), ...injectionFields.map((item) => item.fact.id)],
        paths: relatedPaths,
      }
      conflicts.push(conflict)
      addFact({
        id: `conflict-fact:${conflict.id}`,
        kind: 'conflict',
        path: symbol.path,
        line: symbol.line,
        quote: symbol.path.endsWith('.java') ? `interface ${simpleName(fqn)}` : ns.ns,
        text: detail,
        subject: fqn,
        predicate: 'conflict',
        object: ns.ns,
        relatedPaths,
      })
    }

    return {
      profile: 'java-spring',
      files: unique([...javaFiles.map((file) => file.path), ...xmlFiles.map((file) => file.path)]),
      facts,
      conflicts,
      symbols,
      packages,
    }
  },

  selectFacts(graph, path) {
    const normalized = normalizePath(path)
    const conflicts = graph.facts.filter((fact) => fact.kind === 'conflict')
    const own = graph.facts.filter(
      (fact) => fact.kind !== 'conflict' && (fact.path === normalized || fact.relatedPaths?.includes(normalized)),
    )
    return [...conflicts, ...own].slice(0, 10)
  },
}
