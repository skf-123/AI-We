/**
 * 项目入口的纯函数：分类、建树、统计、拼项目结构结论。
 *
 * 这里刻意**不碰 File / DOM / 网络** —— 上传和读文件在页面与 composable 里，
 * 这里只接收「路径 + 大小」这样的数据。好处是建树和分类可以直接拿 demoB1
 * 的路径清单跑，不需要真开浏览器。
 */

import type { ProjectFileEntry, ProjectTreeNode } from '~/types/project'

/** 依赖 / 编译产物 / IDE 目录：命中即整棵子树跳过，不经过 LLM */
export const SYSTEM_DIRS = new Set([
  'node_modules',
  'bower_components',
  'dist',
  'build',
  'out',
  'output',
  'target',
  'bin',
  'obj',
  'vendor',
  'coverage',
  '.git',
  '.svn',
  '.hg',
  '.idea',
  '.vscode',
  '.gradle',
  '.mvn',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.parcel-cache',
  '.sass-cache',
  '.turbo',
  '__pycache__',
  'venv',
  '.venv',
  'Pods',
  'DerivedData',
])

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
  'bmp',
  'ico',
  'svg',
  'mp4',
  'mov',
  'mp3',
  'wav',
  'woff',
  'woff2',
  'ttf',
  'eot',
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
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

/** 路径里是否踩中了系统目录 */
function systemDirOf(path: string): string | null {
  const parts = path.split('/').slice(0, -1)
  for (const part of parts) {
    if (SYSTEM_DIRS.has(part)) return part
  }
  return null
}

export function classifyFile(path: string): Pick<
  ProjectFileEntry,
  'category' | 'skipReason' | 'unrecorded'
> {
  const name = baseName(path)
  const ext = extOf(name)
  const lower = name.toLowerCase()

  const sysDir = systemDirOf(path)
  if (sysDir) {
    return { category: 'system', skipReason: `依赖 / 产物目录：${sysDir}`, unrecorded: false }
  }

  if (LOCK_FILES.has(name)) {
    return { category: 'system', skipReason: '锁文件', unrecorded: false }
  }
  if (IDE_FILES.has(name) || lower.endsWith('.iml') || lower.endsWith('.suo')) {
    return { category: 'system', skipReason: 'IDE / 系统生成的文件', unrecorded: false }
  }
  if (lower.endsWith('.min.js') || lower.endsWith('.min.css') || lower.endsWith('.map')) {
    return { category: 'system', skipReason: '压缩 / 映射产物', unrecorded: false }
  }
  if (BINARY_EXTS.has(ext)) {
    return { category: 'system', skipReason: '二进制或静态资源', unrecorded: false }
  }
  if (DOC_EXTS.has(ext)) {
    return { category: 'system', skipReason: '文档，不参与代码解析', unrecorded: false }
  }

  if (CONFIG_EXTS.has(ext)) {
    return { category: 'config', unrecorded: false }
  }
  if (SOURCE_EXTS.has(ext)) {
    return { category: 'user', unrecorded: UNRECORDED_EXTS.has(ext) }
  }

  // 认不出来的文本，宁可当用户代码带上（判错代价不对称：静默丢用户代码更糟）
  return { category: 'user', unrecorded: false }
}

/** 按路径与大小造一条登记项（内容不在这里） */
export function makeFileEntry(path: string, size: number): ProjectFileEntry {
  const normalized = normalizePath(path)
  const name = baseName(normalized)
  const meta = classifyFile(normalized)

  return {
    path: normalized,
    name,
    size,
    category: meta.category,
    skipReason: meta.skipReason,
    unrecorded: meta.unrecorded,
    include: meta.category !== 'system',
    configMode: 'context',
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
    Boolean(root) &&
    normalized.every((p) => p.includes('/') && (p.split('/')[0] ?? '') === root)

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
      node.selectableCount = file.category === 'system' ? 0 : 1
      node.selectedCount = file.category !== 'system' && file.include ? 1 : 0
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

/** 勾选 / 取消一个文件夹下的所有可勾选文件（就地修改） */
export function setFolderIncluded(node: ProjectTreeNode, include: boolean): void {
  if (node.type === 'file') {
    if (node.file && node.file.category !== 'system') node.file.include = include
    return
  }
  for (const child of node.children ?? []) setFolderIncluded(child, include)
}

/** 选中 / 可选的统计（底部那两行数字） */
export interface ProjectStats {
  /** 会进逐文件解析的源文件数（用户代码 + 切到「仍需解释」的配置） */
  parseCount: number
  /** 仅作上下文的配置文件数 */
  contextCount: number
  /** 这些文件的总字节数 */
  parseBytes: number
  /** 系统文件（跳过）的数量与字节数 */
  skippedCount: number
  skippedBytes: number
}

export function computeStats(files: ProjectFileEntry[]): ProjectStats {
  const stats: ProjectStats = {
    parseCount: 0,
    contextCount: 0,
    parseBytes: 0,
    skippedCount: 0,
    skippedBytes: 0,
  }

  for (const file of files) {
    if (file.category === 'system') {
      stats.skippedCount++
      stats.skippedBytes += file.size
      continue
    }
    if (!file.include) {
      stats.skippedCount++
      stats.skippedBytes += file.size
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
    .filter(
      (f) =>
        f.include &&
        f.category !== 'system' &&
        !(f.category === 'config' && f.configMode === 'context'),
    )
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** 送进项目地图调用的文件（用户代码 + 配置，包括仅作上下文的） */
export function filesForMap(files: ProjectFileEntry[]): ProjectFileEntry[] {
  return files
    .filter((f) => f.include && f.category !== 'system')
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** 人类可读的大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 整棵子树是不是全是系统文件（target/、.idea/ 这类） */
function allSystem(node: ProjectTreeNode): boolean {
  if (node.type === 'file') return node.file?.category === 'system'
  const children = node.children ?? []
  return children.length > 0 && children.every(allSystem)
}

/**
 * 目录树的文本版，给项目地图调用。
 * 整棵都是系统文件的分支只登记一行、不展开 —— 它们的任务不是被理解，
 * 只是让模型知道「这里有东西、已经跳过了」。
 */
export function treeToText(nodes: ProjectTreeNode[], depth = 0): string {
  const pad = '  '.repeat(depth)
  const lines: string[] = []

  for (const node of nodes) {
    if (node.type === 'file') {
      const tag =
        node.file?.category === 'config'
          ? '配置'
          : node.file?.category === 'system'
            ? '系统'
            : '源码'
      lines.push(`${pad}- ${node.name} [${tag}] ${formatSize(node.size)}`)
      continue
    }

    if (allSystem(node)) {
      const first = node.children?.[0]?.file
      lines.push(
        `${pad}- ${node.name}/ [系统：${first?.skipReason ?? '依赖 / 产物'}，已跳过]`,
      )
      continue
    }

    lines.push(`${pad}- ${node.name}/ (${node.fileCount} 个文件)`)
    lines.push(...treeToText(node.children ?? [], depth + 1))
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
): string {
  const folders = Object.keys(folderNotes)
    .sort()
    .map((p) => `- ${p}：${folderNotes[p]}`)
  const files = Object.keys(fileNotes)
    .sort()
    .map((p) => `- ${p}：${fileNotes[p]}`)

  return [
    `项目：${projectName || '（未命名）'}`,
    `概述：${summary || '（未生成）'}`,
    '',
    '目录说明：',
    ...(folders.length ? folders : ['- （无）']),
    '',
    '文件说明：',
    ...(files.length ? files : ['- （无）']),
  ].join('\n')
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
