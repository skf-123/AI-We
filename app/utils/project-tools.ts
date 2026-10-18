/**
 * 项目 Agent 的只读工具执行器。
 *
 * 工具在浏览器里跑：文件本来就在本地，模型只请求它要看的那一小段。
 * 这里不碰 Vue、不碰组件，只接收「文件清单 + 可读白名单 + 取文件的方法」，
 * 返回给模型看的字符串。所有工具都有行数 / 字符 / 结果数上限。
 */

import type { ProjectFileEntry } from '~/types/project'
import { formatSize, isBinaryFile, normalizePath } from './project-files'

export interface ProjectToolExecutorOptions {
  entries: ProjectFileEntry[]
  /** 允许读取的路径（用户勾选的非二进制文件） */
  readablePaths: string[]
  getFile: (path: string) => File | undefined
}

const MAX_SLICE_LINES = 200
const MAX_SLICE_CHARS = 12_000
const MAX_CONFIG_CHARS = 20_000
const MAX_GREP_MATCHES = 20
const MAX_LIST_ENTRIES = 200

export function createProjectToolExecutor(options: ProjectToolExecutorOptions) {
  const entryMap = new Map(options.entries.map((entry) => [entry.path, entry]))
  const readable = new Set(options.readablePaths.map(normalizePath))
  const textCache = new Map<string, string>()

  async function readText(path: string): Promise<string> {
    const key = normalizePath(path)

    const cached = textCache.get(key)
    if (cached !== undefined) return cached

    const entry = entryMap.get(key)
    if (!entry) throw new Error(`文件不存在：${path}`)
    if (isBinaryFile(key)) throw new Error(`这是二进制文件，不能按文本读取：${path}`)
    if (!readable.has(key)) throw new Error(`这个文件没有勾选，不能读取：${path}`)

    const file = options.getFile(key)
    if (!file) throw new Error(`读不到文件内容：${path}`)

    const text = await file.text()
    textCache.set(key, text)
    return text
  }

  async function listDir(rawPath: unknown): Promise<string> {
    const dir = normalizePath(String(rawPath ?? ''))
    const prefix = dir ? `${dir}/` : ''

    if (dir && !options.entries.some((entry) => entry.path.startsWith(prefix))) {
      return `目录里没有文件：${dir || '/'}`
    }

    const folders = new Map<string, { total: number; readable: number }>()
    const files: ProjectFileEntry[] = []

    for (const entry of options.entries) {
      if (!entry.path.startsWith(prefix)) continue
      const rest = entry.path.slice(prefix.length)
      if (!rest) continue

      const slash = rest.indexOf('/')
      if (slash === -1) {
        files.push(entry)
      } else {
        const name = rest.slice(0, slash)
        const row = folders.get(name) ?? { total: 0, readable: 0 }
        row.total++
        if (readable.has(entry.path)) row.readable++
        folders.set(name, row)
      }
    }

    const lines: string[] = [`目录：${dir || '项目根'}`]

    for (const [name, row] of [...folders.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`- ${name}/ (${row.total} 个文件，其中 ${row.readable} 个可读)`)
    }

    for (const entry of files.sort((a, b) => a.path.localeCompare(b.path))) {
      const tag = readable.has(entry.path) ? '可读' : '未勾选'
      lines.push(`- ${entry.name} [${tag}] ${formatSize(entry.size)}`)
    }

    if (lines.length === 1) lines.push('（空目录）')
    if (lines.length > MAX_LIST_ENTRIES + 1) {
      lines.length = MAX_LIST_ENTRIES + 1
      lines.push('……条目太多，只列出前 200 个')
    }

    return lines.join('\n')
  }

  async function readFileSlice(
    rawPath: unknown,
    rawStart: unknown,
    rawEnd: unknown,
  ): Promise<string> {
    const path = String(rawPath ?? '')
    const text = await readText(path)

    const start = Math.max(1, Math.floor(Number(rawStart) || 1))
    let end = Math.max(start, Math.floor(Number(rawEnd) || start + 40))
    end = Math.min(end, start + MAX_SLICE_LINES - 1)

    const lines = text.split('\n')
    const slice = lines.slice(start - 1, end)
    if (slice.length === 0) return `文件只有 ${lines.length} 行，读不到第 ${start} 行`

    const numbered = slice.map((line, i) => `${start + i}: ${line.slice(0, 400)}`).join('\n')
    return numbered.length > MAX_SLICE_CHARS
      ? numbered.slice(0, MAX_SLICE_CHARS) + '\n……内容太长，已截断'
      : numbered
  }

  async function readConfig(rawPath: unknown): Promise<string> {
    const path = String(rawPath ?? '')
    const text = await readText(path)
    return text.length > MAX_CONFIG_CHARS
      ? text.slice(0, MAX_CONFIG_CHARS) + '\n……内容太长，已截断'
      : text
  }

  async function grep(rawQuery: unknown, rawPrefix: unknown): Promise<string> {
    const query = String(rawQuery ?? '').trim()
    if (!query) return '错误：query 不能为空'

    const prefix = normalizePath(String(rawPrefix ?? ''))
    const prefixWithSlash = prefix ? `${prefix}/` : ''
    const candidates = options.entries.filter(
      (entry) => readable.has(entry.path) && entry.path.startsWith(prefixWithSlash),
    )

    if (candidates.length === 0) return '这个范围里没有可读取的文件'

    const needle = query.toLowerCase()
    const matches: string[] = []

    for (const entry of candidates.slice(0, 400)) {
      let text: string
      try {
        text = await readText(entry.path)
      } catch {
        continue
      }

      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        if (line.toLowerCase().includes(needle)) {
          matches.push(`${entry.path}:${i + 1}: ${line.trim().slice(0, 200)}`)
          if (matches.length >= MAX_GREP_MATCHES) break
        }
      }
      if (matches.length >= MAX_GREP_MATCHES) break
    }

    if (matches.length === 0) return `没有找到包含「${query}」的行`
    return matches.join('\n').slice(0, MAX_SLICE_CHARS)
  }

  async function searchKnowledge(rawQuery: unknown): Promise<string> {
    const query = String(rawQuery ?? '').trim()
    if (!query) return '错误：query 不能为空'

    const res = await fetch('/api/project/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) return `知识库检索失败（HTTP ${res.status}）`

    const data = (await res.json()) as {
      results?: { title: string; content: string; label: string; url: string }[]
    }
    const results = data.results ?? []
    if (results.length === 0) return '没有检索到相关资料'

    return results
      .map((row, i) => `[${i + 1}] ${row.title}（${row.label}）\n${row.content}\n出处：${row.url}`)
      .join('\n\n')
      .slice(0, MAX_SLICE_CHARS)
  }

  async function execute(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (name) {
        case 'list_dir':
          return await listDir(args.path)
        case 'read_file_slice':
          return await readFileSlice(args.path, args.start_line, args.end_line)
        case 'read_config':
          return await readConfig(args.path)
        case 'grep':
          return await grep(args.query, args.path_prefix)
        case 'search_knowledge':
          return await searchKnowledge(args.query)
        default:
          return `错误：没有这个工具 ${name}`
      }
    } catch (err) {
      return `错误：${err instanceof Error ? err.message : String(err)}`
    }
  }

  return { execute }
}
