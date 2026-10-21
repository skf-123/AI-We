/**
 * 项目入口的纯函数：分类、建树、统计、拼项目结构结论。
 *
 * 这里刻意**不碰 File / DOM / 网络** —— 上传和读文件在页面与 composable 里，
 * 这里只接收「路径 + 大小」这样的数据。好处是建树和分类可以直接拿 demoB1
 * 的路径清单跑，不需要真开浏览器。
 */

import type { CrossFileEvidence, ProjectFileEntry, ProjectTreeNode } from '~/types/project'

/**
 * 输入侧上限（快照第十一节第 30 条第 5 小节）。
 *
 * ⚠️ 用户相关文件（用户代码 + 配置）**不按单文件大小跳过** ——
 *    一个 2 MB 的源文件只要选中总量没超，就应当正常带上。
 *    真正的闸门是「选中的用户相关文件总量 ≤ 1.9 MB」。
 */
export const PROJECT_LIMITS = {
  /** 整个文件夹（拖入时）的原始大小上限，防止把浏览器拖死 */
  maxTotal: 1024 * 1024 * 1024,
  /** 文件数上限 */
  maxFiles: 50_000,
  /** 用户相关文件选中总量的上限；依赖 / 产物不计入 */
  maxUserBytes: Math.round(1.9 * 1024 * 1024),
} as const

/** 依赖目录：第三方包本体 */
const DEPENDENCY_DIRS = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  '__pycache__',
  'venv',
  '.venv',
  'Pods',
  'DerivedData',
])

/** 构建输出目录：由源码生成，不该逐行解释 */
const BUILD_DIRS = new Set([
  'dist',
  'build',
  'out',
  'output',
  'target',
  'bin',
  'obj',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.parcel-cache',
  '.sass-cache',
  '.turbo',
])

/** IDE / 版本控制目录 */
const TOOLING_DIRS = new Set(['.git', '.svn', '.hg', '.idea', '.vscode', '.gradle', '.mvn'])

/**
 * 目录规则表：命中即整棵子树跳过，不经过 LLM。
 * 拆成三组是为了让原因文案更具体，而不是笼统写「依赖 / 产物」。
 */
const DIR_RULES = [
  { dirs: DEPENDENCY_DIRS, subtype: 'dependency', label: '依赖目录' },
  { dirs: BUILD_DIRS, subtype: 'build', label: '构建输出目录' },
  { dirs: TOOLING_DIRS, subtype: 'tooling', label: 'IDE / 工具目录' },
] as const

/** 兼容旧引用：三组合起来的全集 */
export const SYSTEM_DIRS = new Set([...DEPENDENCY_DIRS, ...BUILD_DIRS, ...TOOLING_DIRS])

/** 锁文件：不是用户代码，也不该送给模型 */
const LOCK_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'npm-shrinkwrap.json',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'go.sum',
])

/** IDE / 系统生成的文件 */
const IDE_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitignore', '.gitattributes'])

/** 二进制与静态产物：只登记位置 */
const BINARY_EXTS = new Set([
  'class',
  'jar',
  'war',
  'ear',
  'pyc',
  'pyo',
  'o',
  'obj',
  'so',
  'dylib',
  'dll',
  'exe',
  'zip',
  'tar',
  'gz',
  'tgz',
  '7z',
  'rar',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'heic',
  'heif',
  'apng',
  'jfif',
  'tif',
  'tiff',
  'psd',
  'raw',
  'cr2',
  'nef',
  'arw',
  'bmp',
  'ico',
  'svg',
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'wmv',
  'flv',
  '3gp',
  'mpeg',
  'mpg',
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'flac',
  'opus',
  'wma',
  'aiff',
  'aif',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'ttc',
  'eot',
  'fnt',
  'wasm',
  'bin',
  'iso',
  'dmg',
  'pkg',
  'msi',
  'apk',
  'ipa',
  'deb',
  'rpm',
  'bz2',
  'xz',
  'zst',
  'lz4',
  'cab',
  'pdf',
  'xls',
  'xlsx',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'db',
  'sqlite',
  'sqlite3',
  'lock',
])

/** 浏览器 MIME 能直接判定为二进制的类型；只收确定不是文本的 */
const BINARY_MIME_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/java-archive',
  'application/vnd.android.package-archive',
  'application/wasm',
])

/** 文档：能看，但不是代码，默认跳过 */
const DOC_EXTS = new Set(['md', 'mdx', 'txt', 'rst', 'adoc'])

/** 配置文件（默认仅作上下文） */
const CONFIG_EXTS = new Set([
  'xml',
  'properties',
  'yml',
  'yaml',
  'toml',
  'ini',
  'conf',
  'config',
  'json',
  'gradle',
  'env',
])

/** 用户源码 */
const SOURCE_EXTS = new Set([
  'js',
  'mjs',
  'cjs',
  'ts',
  'mts',
  'cts',
  'jsx',
  'tsx',
  'vue',
  'svelte',
  'py',
  'java',
  'kt',
  'kts',
  'scala',
  'go',
  'rs',
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'cs',
  'php',
  'rb',
  'swift',
  'dart',
  'sh',
  'bash',
  'lua',
  'r',
  'sql',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'sass',
  'jsp',
  'jspx',
  'asp',
  'aspx',
  'ejs',
  'hbs',
  'pug',
])

/**
 * 认得出来是代码、但知识库没收录的语言。
 * 这些文件**不跳过**（四段里只有第四段用得到语料），只在树上给一句提示。
 */
const UNRECORDED_EXTS = new Set([
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'kt',
  'kts',
  'swift',
  'scala',
  'sh',
  'bash',
  'lua',
  'dart',
  'r',
])

/** 统一成 / 分隔、去掉开头的 ./ */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

interface SystemDirMatch {
  dir: string
  subtype: 'dependency' | 'build' | 'tooling'
  label: string
}

/** 路径里是否踩中了系统目录；返回命中的目录与它属于哪一组 */
function systemDirOf(path: string): SystemDirMatch | null {
  const parts = path.split('/').slice(0, -1)
  for (const part of parts) {
    for (const rule of DIR_RULES) {
      if (rule.dirs.has(part)) return { dir: part, subtype: rule.subtype, label: rule.label }
    }
  }
  return null
}

/** 压缩 / 映射产物：默认不勾，但仍然是文本，可以勾选后逐行解释 */
export function isMinifiedOrMap(path: string): boolean {
  const lower = (path.split('/').pop() ?? path).toLowerCase()
  return lower.endsWith('.min.js') || lower.endsWith('.min.css') || lower.endsWith('.map')
}

/**
 * 是否是无法按文本读取的文件（二进制、图片、压缩包）。
 *
 * ⚠️ 压缩 / 映射产物（.min.js / .min.css / .map）**不在这里**：
 *    它们默认不勾，但仍然是文本，用户可以勾选并切「仍需解释」。
 *    「默认不勾」是分类规则给的（classifyFile），不是「读不了」。
 */
export function isBinaryFile(path: string): boolean {
  const name = baseName(normalizePath(path))
  return BINARY_EXTS.has(extOf(name))
}

/**
 * 扩展名不认识时，用浏览器给的 MIME 兜底。
 * 只看确定是媒体的类型；application/octet-stream 不当作二进制，
 * 因为有些系统会给未知的文本文件也标成它。
 */
function isBinaryMime(mime: string): boolean {
  const value = mime.trim().toLowerCase()
  if (!value) return false
  if (
    value.startsWith('image/') ||
    value.startsWith('video/') ||
    value.startsWith('audio/') ||
    value.startsWith('font/')
  ) {
    return true
  }
  return BINARY_MIME_TYPES.has(value)
}

export function classifyFile(
  path: string,
  mime = '',
): Pick<ProjectFileEntry, 'category' | 'subtype' | 'skipReason' | 'unrecorded'> {
  const name = baseName(path)
  const ext = extOf(name)
  const lower = name.toLowerCase()

  const sysDir = systemDirOf(path)
  if (sysDir) {
    return {
      category: 'system',
      subtype: sysDir.subtype,
      skipReason: `${sysDir.label}：${sysDir.dir}`,
      unrecorded: false,
    }
  }

  if (LOCK_FILES.has(name)) {
    return { category: 'system', subtype: 'lockfile', skipReason: '锁文件', unrecorded: false }
  }
  if (IDE_FILES.has(name) || lower.endsWith('.iml') || lower.endsWith('.suo')) {
    return {
      category: 'system',
      subtype: 'ide',
      skipReason: 'IDE / 系统生成的文件',
      unrecorded: false,
    }
  }
  if (isMinifiedOrMap(lower)) {
    const isMap = lower.endsWith('.map')
    return {
      category: 'system',
      subtype: isMap ? 'source-map' : 'minified',
      skipReason: isMap ? 'source map 映射文件' : '压缩产物',
      unrecorded: false,
    }
  }
  if (BINARY_EXTS.has(ext)) {
    return {
      category: 'system',
      subtype: 'binary',
      skipReason: '二进制或静态资源',
      unrecorded: false,
    }
  }
  if (DOC_EXTS.has(ext)) {
    return {
      category: 'system',
      subtype: 'docs',
      skipReason: '文档，不参与代码解析',
      unrecorded: false,
    }
  }

  if (CONFIG_EXTS.has(ext)) {
    return { category: 'config', subtype: 'config', unrecorded: false }
  }
  if (SOURCE_EXTS.has(ext)) {
    return { category: 'user', subtype: 'source', unrecorded: UNRECORDED_EXTS.has(ext) }
  }

  // 扩展名不认识时，浏览器可能还知道它是什么（avif、heic 这类新格式）
  if (isBinaryMime(mime)) {
    return {
      category: 'system',
      subtype: 'binary',
      skipReason: '二进制或静态资源',
      unrecorded: false,
    }
  }

  // 认不出来的文本，宁可当用户代码带上（判错代价不对称：静默丢用户代码更糟）
  return { category: 'user', subtype: 'unknown', unrecorded: false }
}

/** 按路径、大小和浏览器给出的 MIME 造一条登记项（内容不在这里） */
export function makeFileEntry(path: string, size: number, mime = ''): ProjectFileEntry {
  const normalized = normalizePath(path)
  const name = baseName(normalized)
  const meta = classifyFile(normalized, mime)

  return {
    path: normalized,
    name,
    size,
    category: meta.category,
    subtype: meta.subtype,
    skipReason: meta.skipReason,
    unrecorded: meta.unrecorded,
    include: meta.category !== 'system',
    configMode: 'context',
    systemMode: 'context',
  }
}

/**
 * 去掉所有文件共同的根目录，返回项目名与被剥掉的路径。
 * 例：`demoB1/src/a.java` × 3 → root=demoB1，paths=src/a.java。
 */
export function stripCommonRoot(paths: string[]): { root: string; paths: string[] } {
  if (paths.length === 0) return { root: '', paths: [] }

  const normalized = paths.map(normalizePath)
  const firstSegments = normalized.map((p) => p.split('/')[0] ?? '')
  const root = firstSegments[0] ?? ''

  const shared =
    Boolean(root) && normalized.every((p) => p.includes('/') && (p.split('/')[0] ?? '') === root)

  if (!shared) return { root: '', paths: normalized }

  return {
    root,
    paths: normalized.map((p) => p.slice(root.length + 1)),
  }
}

function emptyNode(name: string, path: string, type: 'folder' | 'file'): ProjectTreeNode {
  return {
    name,
    path,
    type,
    children: type === 'folder' ? [] : undefined,
    size: 0,
    fileCount: 0,
    selectableCount: 0,
    selectedCount: 0,
  }
}

/**
 * 由扁平的登记项建目录树。
 *
 * folderNotes 来自项目地图调用（路径 → 大白话），只在最末级文件夹上有值；
 * 容器文件夹不写，避免树上出现一长串「src：源代码目录」这种废话。
 */
export function buildTree(
  files: ProjectFileEntry[],
  folderNotes: Record<string, string> = {},
): ProjectTreeNode[] {
  const root: ProjectTreeNode = emptyNode('', '', 'folder')

  for (const file of files) {
    const parts = file.path.split('/')
    let cursor = root

    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!
      const path = parts.slice(0, i + 1).join('/')
      let next = cursor.children!.find((c) => c.type === 'folder' && c.name === name)
      if (!next) {
        next = emptyNode(name, path, 'folder')
        next.note = folderNotes[path]
        cursor.children!.push(next)
      }
      cursor = next
    }

    const leaf = emptyNode(file.name, file.path, 'file')
    leaf.file = file
    leaf.note = file.note
    cursor.children!.push(leaf)
  }

  function finalize(node: ProjectTreeNode): void {
    if (node.type === 'file') {
      const file = node.file!
      node.size = file.size
      node.fileCount = 1
      node.selectableCount = 1
      node.selectedCount = file.include ? 1 : 0
      return
    }

    node.size = 0
    node.fileCount = 0
    node.selectableCount = 0
    node.selectedCount = 0

    for (const child of node.children ?? []) {
      finalize(child)
      node.size += child.size
      node.fileCount += child.fileCount
      node.selectableCount += child.selectableCount
      node.selectedCount += child.selectedCount
    }

    // 文件夹在前、文件在后；同类按名字排
    node.children!.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  finalize(root)
  return root.children ?? []
}

/** 勾选 / 取消一个文件夹下的所有文件（系统文件也可以手动勾选） */
export function setFolderIncluded(node: ProjectTreeNode, include: boolean): void {
  if (node.type === 'file') {
    if (node.file) node.file.include = include
    return
  }
  for (const child of node.children ?? []) setFolderIncluded(child, include)
}

/** 文件夹里还没勾选的系统文件数；用于决定勾选文件夹时要不要先弹提示 */
export function countUncheckedSystem(node: ProjectTreeNode): number {
  if (node.type === 'file') {
    return node.file?.category === 'system' && !node.file.include ? 1 : 0
  }
  return (node.children ?? []).reduce((sum, child) => sum + countUncheckedSystem(child), 0)
}

/** 选中 / 可选的统计（底部那两行数字） */
export interface ProjectStats {
  /** 会进逐文件解析的文件数（用户代码 + 需解释的配置 / 系统文本） */
  parseCount: number
  /** 仅作上下文的文件数（配置 + 系统文件） */
  contextCount: number
  /** 勾选的系统文件数；用于底部说明 */
  systemCount: number
  /** 选中文件的总字节数；系统文件也计入 1.9MB 预算 */
  parseBytes: number
  /** 没勾选的文件数量与字节数 */
  skippedCount: number
  skippedBytes: number
}

export function computeStats(files: ProjectFileEntry[]): ProjectStats {
  const stats: ProjectStats = {
    parseCount: 0,
    contextCount: 0,
    systemCount: 0,
    parseBytes: 0,
    skippedCount: 0,
    skippedBytes: 0,
  }

  for (const file of files) {
    if (!file.include) {
      stats.skippedCount++
      stats.skippedBytes += file.size
      continue
    }

    if (file.category === 'system') {
      stats.systemCount++
      stats.parseBytes += file.size
      if (file.systemMode === 'explain' && !isBinaryFile(file.path)) {
        stats.parseCount++
      } else {
        stats.contextCount++
      }
      continue
    }

    if (file.category === 'config' && file.configMode === 'context') {
      stats.contextCount++
      stats.parseBytes += file.size
      continue
    }

    stats.parseCount++
    stats.parseBytes += file.size
  }

  return stats
}

/** 真正要送进逐文件解析的文件（按路径稳定排序） */
export function filesToParse(files: ProjectFileEntry[]): ProjectFileEntry[] {
  return files
    .filter((f) => {
      if (!f.include) return false
      if (f.category === 'system') return f.systemMode === 'explain' && !isBinaryFile(f.path)
      if (f.category === 'config') return f.configMode === 'explain'
      return true
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** 送进项目地图调用的文件（勾选的非二进制文件，包含系统文件） */
export function filesForMap(files: ProjectFileEntry[]): ProjectFileEntry[] {
  return files
    .filter((f) => f.include && !isBinaryFile(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** 人类可读的大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/** 整棵子树是不是全是系统文件（target/、.idea/ 这类） */
export function allSystem(node: ProjectTreeNode): boolean {
  if (node.type === 'file') return node.file?.category === 'system'
  const children = node.children ?? []
  return children.length > 0 && children.every(allSystem)
}

/**
 * 目录树的文本版，给项目地图调用。
 * 整棵都是系统文件的分支只登记一行、不展开 —— 它们的任务不是被理解，
 * 只是让模型知道「这里有东西、已经跳过了」。
 *
 * markInclude 只给汇总调用用：用户可能在解析完以后取消勾选，再重新生成
 * 总览和图；标出「未勾选」，模型才知道这些文件不属于本次汇总范围。
 * 项目地图仍然用不带标记的完整目录树。
 */
export function treeToText(nodes: ProjectTreeNode[], depth = 0, markInclude = false): string {
  const pad = '  '.repeat(depth)
  const lines: string[] = []

  for (const node of nodes) {
    if (node.type === 'file') {
      const file = node.file
      const tag =
        file?.category === 'config'
          ? '配置'
          : file?.category === 'system'
            ? file.include
              ? `系统·${file.systemMode === 'explain' ? '需解释' : '仅上下文'}`
              : '系统·默认不勾'
            : '源码'
      const unchecked = markInclude && file && !file.include ? '·未勾选' : ''
      lines.push(`${pad}- ${node.name} [${tag}${unchecked}] ${formatSize(node.size)}`)
      continue
    }

    if (allSystem(node)) {
      const first = node.children?.[0]?.file
      const status = node.selectedCount > 0 ? '已勾选' : '默认不勾'
      lines.push(`${pad}- ${node.name}/ [系统：${first?.skipReason ?? '依赖 / 产物'}，${status}]`)
      continue
    }

    lines.push(`${pad}- ${node.name}/ (${node.fileCount} 个文件)`)
    // 注意：treeToText 返回的是字符串，不能再展开（spread）—— 展开会把每个字符
    // 当成一行，目录树文本会被拆成逐字一行的乱码。整段 push 进去即可。
    lines.push(treeToText(node.children ?? [], depth + 1, markInclude))
  }

  return lines.join('\n')
}

/**
 * 项目结构结论 —— 逐文件请求的公共前缀。
 *
 * ⚠️ 这个字符串一经生成就不再变：每次逐文件请求原样带上，前半段逐字节相同，
 *    DeepSeek 的前缀缓存才可能命中。所以这里只用已经定下来的数据、并排序。
 */
export function buildProjectContext(
  projectName: string,
  summary: string,
  folderNotes: Record<string, string>,
  fileNotes: Record<string, string>,
  crossFileNotes: string[] = [],
  backend: { hasBackend: boolean; evidence: string } | null = null,
  crossFileEvidence: CrossFileEvidence[] = [],
): string {
  const folders = Object.keys(folderNotes)
    .sort()
    .map((p) => `- ${p}：${folderNotes[p]}`)
  const files = Object.keys(fileNotes)
    .sort()
    .map((p) => `- ${p}：${fileNotes[p]}`)

  const evidenceByNote = new Map<number, CrossFileEvidence[]>()
  for (const item of crossFileEvidence) {
    const list = evidenceByNote.get(item.note) ?? []
    list.push(item)
    evidenceByNote.set(item.note, list)
  }

  const noteLines = crossFileNotes.flatMap((note, index) => {
    const rows = evidenceByNote.get(index + 1) ?? []
    if (rows.length === 0) return [`- ${note}`, '  （未核实：没有找到原文证据）']
    return [
      `- ${note}`,
      ...rows.map((item) => `  证据：${item.path}:${item.line}  ${item.quote}`),
    ]
  })

  const backendLine = backend
    ? `后端判断：${backend.hasBackend ? '有后端' : '没有后端'}${
        backend.evidence ? `（依据：${backend.evidence}）` : ''
      }`
    : ''

  return [
    `项目：${projectName || '（未命名）'}`,
    `概述：${summary || '（未生成）'}`,
    ...(backendLine ? ['', backendLine] : []),
    '',
    '目录说明：',
    ...(folders.length ? folders : ['- （无）']),
    '',
    '文件说明：',
    ...(files.length ? files : ['- （无）']),
    ...(crossFileNotes.length ? ['', '跨文件线索：', ...noteLines] : []),
  ].join('\n')
}

/**
 * 用真实文件内容核对地图 Agent 带回的引文。
 *
 * 只保留行号有效、引文能对上的；返回时把 quote 换成真实那一行，
 * 避免模型复述时多一个字少一个字。读文件由调用方负责，这里保持纯函数。
 */
export function verifyEvidence(
  evidence: CrossFileEvidence[],
  texts: Map<string, string>,
): CrossFileEvidence[] {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
  const verified: CrossFileEvidence[] = []

  for (const item of evidence) {
    const text = texts.get(item.path)
    if (typeof text !== 'string') continue

    const lines = text.replace(/\r\n/g, '\n').split('\n')
    const quote = normalize(item.quote.replace(/^\d+:\s*/, ''))
    if (!quote) continue

    // 先看模型报的行，再在 ±2 行内找：模型数错一两行很常见，
    // 但只接受足够长的行，避免「}」这种短行被邻近匹配到。
    let found: { line: number; text: string } | null = null
    for (const offset of [0, -1, 1, -2, 2]) {
      const lineNumber = item.line + offset
      if (lineNumber < 1) continue

      const actual = lines[lineNumber - 1]
      if (typeof actual !== 'string') continue

      const line = actual.trim()
      const normalized = normalize(line)
      if (!normalized) continue
      if (offset !== 0 && normalized.length < 8) continue
      if (!normalized.includes(quote) && !quote.includes(normalized)) continue

      found = { line: lineNumber, text: line }
      break
    }

    if (!found) continue
    verified.push({ ...item, line: found.line, quote: found.text.slice(0, 300) })
  }

  return verified
}

/** 从流式输出里取第三段（整段整体作用），汇总调用只带这一段，不重发全文 */
export function thirdSection(output: string): string {
  const match = output.match(/##\s*三、整段整体作用\s*([\s\S]*?)(?=\n##\s|$)/)
  return match?.[1]?.trim() ?? ''
}

/** 抽前若干行里的 import / require / include，给汇总调用当跨文件关系的线索 */
export function extractImports(text: string): string[] {
  return text
    .split('\n')
    .slice(0, 120)
    .filter((line) =>
      /^\s*(import\s|from\s+\S+\s+import|#include|using\s|const\s+\w+\s*=\s*require|let\s+\w+\s*=\s*require)/.test(
        line,
      ),
    )
    .map((line) => line.trim())
    .slice(0, 8)
}
