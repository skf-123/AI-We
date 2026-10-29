/**
 * 前端 import 的路径解析。
 *
 * 只做相对路径和常见别名（@/、~/）到项目内文件的映射；
 * 解析不到就返回 null，不假装有关系。
 */

const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function withExtensions(raw: string, pathSet: Set<string>, extensions: string[]): string | null {
  if (pathSet.has(raw)) return raw
  for (const ext of extensions) {
    if (pathSet.has(`${raw}${ext}`)) return `${raw}${ext}`
  }
  for (const ext of extensions) {
    if (pathSet.has(`${raw}/index${ext}`)) return `${raw}/index${ext}`
  }
  return null
}

export function resolveRelativeModule(
  fromPath: string,
  specifier: string,
  pathSet: Set<string>,
): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null
  const parts = `${dirname(fromPath)}/${specifier}`.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return withExtensions(stack.join('/'), pathSet, JS_EXTENSIONS)
}

export function resolveAliasModule(
  fromPath: string,
  specifier: string,
  pathSet: Set<string>,
): string | null {
  if (!specifier.startsWith('@/') && !specifier.startsWith('~/')) return null
  const tail = specifier.slice(2)
  const marker = '/src/'
  const markerIndex = fromPath.indexOf(marker)

  if (markerIndex >= 0) {
    const base = fromPath.slice(0, markerIndex + marker.length)
    const hit = withExtensions(`${base}${tail}`, pathSet, JS_EXTENSIONS)
    if (hit) return hit
  }

  const suffix = `/src/${tail}`
  const matches = [...pathSet].filter((path) => path.endsWith(suffix))
  if (matches.length !== 1) return null
  return withExtensions(matches[0]!, pathSet, JS_EXTENSIONS) ?? matches[0]!
}

export function resolveFrontendModule(
  fromPath: string,
  specifier: string,
  pathSet: Set<string>,
): string | null {
  return resolveRelativeModule(fromPath, specifier, pathSet) ??
    resolveAliasModule(fromPath, specifier, pathSet)
}

export function frontendModulePathSet(files: { path: string }[]): Set<string> {
  return new Set(files.map((file) => file.path))
}
