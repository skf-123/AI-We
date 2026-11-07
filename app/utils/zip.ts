/**
 * 在浏览器里读 zip：把压缩包拆成「路径 + File」，交给和文件夹上传同一条流水线。
 *
 * 为什么不引第三方解压库：
 *   - 浏览器自带 DecompressionStream('deflate-raw')，zip 里 99% 的条目就是这一种压缩；
 *   - 我们只需要读，不需要写，也不需要加密、分卷、ZIP64 这些边角；
 *   - 少一个运行时依赖，评委问「这个包干什么用的」时不用解释一堆。
 *
 * 支持：store（不压缩）和 deflate 两种方法；UTF-8 与 GBK 文件名。
 * 不支持：加密、分卷、ZIP64（超过 4 GB 或超过 65535 个条目）。遇到就明确报错，
 * 不猜、不半途返回一个缺文件的列表。
 *
 * 整个 zip 会先读进内存再逐条解压，所以这里的上限比「拖文件夹」的 1 GB 严：
 * 压缩包 200 MB、解压后 300 MB。超过就提示先去掉 node_modules / target 再压缩。
 */

export const ZIP_LIMITS = {
  /** 压缩包本体的字节上限 */
  maxCompressed: 200 * 1024 * 1024,
  /** 所有条目解压后的字节上限，防 zip 炸弹，也防把浏览器内存吃满 */
  maxUncompressed: 300 * 1024 * 1024,
  /** 条目数上限，和项目模式的 50,000 文件上限对齐 */
  maxEntries: 50_000,
} as const

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

/** 解压失败时抛这个，message 直接能展示给用户 */
export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

export function isZipFile(name: string, mime = ''): boolean {
  return /\.zip$/i.test(name) || /application\/(x-)?zip/i.test(mime)
}

/** 统一成 / 分隔、去掉开头的 ./，并拒绝跳出压缩包的路径 */
function safePath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
  if (!normalized || normalized.endsWith('/')) return null
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return null
  return normalized
}

/**
 * 解文件名。zip 规范里第 11 位标记「这个名字是 UTF-8」；
 * 没标记的老压缩包（Windows 中文环境常见）多半是 GBK，先按 UTF-8 严格解，
 * 解不开再退到 gbk。浏览器没有 gbk 解码器时最后退到 windows-1252，至少不报错。
 */
function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes)

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 不是合法 UTF-8，继续往下试
  }

  try {
    return new TextDecoder('gbk').decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

interface ZipEntryMeta {
  path: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

export interface UnzipOptions {
  /** 每解出一个文件回调一次，用来显示「已解压 3 / 120」 */
  onProgress?: (done: number, total: number) => void
}

/**
 * 读一个 zip 文件，返回扁平的文件列表。
 *
 * 目录条目、__MACOSX 这类系统垃圾直接跳过；重名路径只留第一条。
 */
export async function unzipFile(
  file: File,
  options: UnzipOptions = {},
): Promise<{ path: string; file: File }[]> {
  if (file.size > ZIP_LIMITS.maxCompressed) {
    throw new ZipError(
      `这个压缩包 ${formatMb(file.size)}，超过 ${formatMb(ZIP_LIMITS.maxCompressed)} 的上限。请先去掉 node_modules、target 这类目录再压缩。`,
    )
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError(
      '当前浏览器不支持在本地解压 zip。请换 Chrome 或 Edge，或者把文件夹解压后直接拖进来。',
    )
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const eocd = findEocd(view)
  // 偏移 0 是合法值（空包），不能用真值判断
  if (eocd === null) throw new ZipError('这个文件不像 zip 压缩包，没找到中央目录。')

  const totalEntries = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)

  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ZipError(
      '这是 ZIP64 格式（条目超过 65535 个或包超过 4 GB）。请换一个普通 zip，或解压后拖文件夹。',
    )
  }

  const entries = readCentralDirectory(view, centralOffset, totalEntries)
  if (entries.length === 0) throw new ZipError('压缩包是空的，里面没有文件。')

  if (entries.length > ZIP_LIMITS.maxEntries) {
    throw new ZipError(
      `压缩包里有 ${entries.length.toLocaleString()} 个文件，超过 ${ZIP_LIMITS.maxEntries.toLocaleString()} 的上限。`,
    )
  }

  const totalUncompressed = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
  if (totalUncompressed > ZIP_LIMITS.maxUncompressed) {
    throw new ZipError(
      `解压后约 ${formatMb(totalUncompressed)}，超过 ${formatMb(ZIP_LIMITS.maxUncompressed)} 的上限。请先去掉 node_modules、target 这类目录再压缩。`,
    )
  }

  const output: { path: string; file: File }[] = []
  const seen = new Set<string>()

  let actualTotal = 0

  for (const entry of entries) {
    if (seen.has(entry.path)) continue
    seen.add(entry.path)

    const data = await readEntryData(view, entry)

    // 中央目录里写的大小可能是假的（zip 炸弹常见做法），按真实解出来的字节再卡一次
    actualTotal += data.length
    if (actualTotal > ZIP_LIMITS.maxUncompressed) {
      throw new ZipError(
        `解压后超过 ${formatMb(ZIP_LIMITS.maxUncompressed)} 的上限，已经停下。请先去掉 node_modules、target 这类目录再压缩。`,
      )
    }

    const name = entry.path.split('/').pop() ?? entry.path
    output.push({ path: entry.path, file: new File([data], name) })

    options.onProgress?.(output.length, entries.length)
  }

  return output
}

/** 从尾部往前找中央目录结束标记；注释最长 65535 字节，所以只扫最后这么多 */
function findEocd(view: DataView): number | null {
  const min = Math.max(0, view.byteLength - 22 - 65535)

  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i
  }

  return null
}

function readCentralDirectory(view: DataView, offset: number, count: number): ZipEntryMeta[] {
  const entries: ZipEntryMeta[] = []
  let cursor = offset

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== SIG_CENTRAL) {
      throw new ZipError('压缩包的中央目录损坏，读到一半对不上。请重新压缩后再试。')
    }

    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)

    const nameStart = cursor + 46
    const rawName = new Uint8Array(view.buffer, view.byteOffset + nameStart, nameLength)
    const path = safePath(decodeName(rawName, (flags & 0x800) !== 0))

    cursor = nameStart + nameLength + extraLength + commentLength

    // 目录条目、macOS 的资源分叉、被路径清洗拒绝的条目，都不进列表
    if (!path) continue
    if (path === '__MACOSX' || path.startsWith('__MACOSX/')) continue

    if ((flags & 0x1) !== 0) {
      throw new ZipError(
        `压缩包加了密码（${path}），这里解不开。请先解压，或重新打一个不带密码的 zip。`,
      )
    }

    if (method !== 0 && method !== 8) {
      throw new ZipError(
        `压缩包用了不常见的压缩方式（method ${method}），只支持普通 zip 和 deflate。请重新压缩后再试。`,
      )
    }

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new ZipError('这是 ZIP64 格式的条目，暂不支持。请换一个普通 zip。')
    }

    entries.push({
      path,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    })
  }

  return entries
}

/** 读一条条目的内容。中央目录给了大小，本地头只用来定位数据起点 */
async function readEntryData(view: DataView, entry: ZipEntryMeta): Promise<Uint8Array> {
  const local = entry.localOffset
  if (local + 30 > view.byteLength || view.getUint32(local, true) !== SIG_LOCAL) {
    throw new ZipError(`压缩包里的 ${entry.path} 定位失败，文件可能损坏。`)
  }

  const nameLength = view.getUint16(local + 26, true)
  const extraLength = view.getUint16(local + 28, true)
  const start = local + 30 + nameLength + extraLength
  const end = start + entry.compressedSize

  if (end > view.byteLength) {
    throw new ZipError(`压缩包里的 ${entry.path} 数据越界，文件可能损坏。`)
  }

  const raw = new Uint8Array(view.buffer, view.byteOffset + start, entry.compressedSize)
  if (entry.method === 0) return raw.slice()

  try {
    return await inflateRaw(raw)
  } catch {
    throw new ZipError(`解压 ${entry.path} 失败，压缩包可能损坏。`)
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}
