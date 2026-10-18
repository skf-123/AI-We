/**
 * 第三方库识别（纯函数）。
 *
 * 分工：
 *   · 程序读文件头、按「文件名 + 许可证头」给高 / 中置信度；
 *   · 规则拿不准的进入候选池，交给 Agent 评审（只出建议，不改勾选）；
 *   · 所有判断都在浏览器里完成，文件头不会为了分类单独发请求。
 */

import type { ProjectFileEntry, VendorHint } from '~/types/project'
import { isMinifiedOrMap } from './project-files'

/** 已知库的文件名规则：只匹配 basename，避免把路径里的词误当成库名 */
const KNOWN_VENDORS: { name: string; test: RegExp }[] = [
  { name: 'Bootstrap', test: /^bootstrap(?:\.bundle)?(?:\.min)?\.(?:js|css)$/i },
  { name: 'jQuery', test: /^jquery(?:[-.][\w.-]+)?\.js$/i },
  { name: 'Lodash', test: /^lodash(?:\.min)?\.js$/i },
  { name: 'Underscore', test: /^underscore(?:\.min)?\.js$/i },
  { name: 'Axios', test: /^axios(?:\.min)?\.js$/i },
  { name: 'Vue', test: /^vue(?:\.global|\.runtime)?(?:\.prod)?(?:\.min)?\.js$/i },
  { name: 'React', test: /^react(?:-dom)?(?:\.production|\.development)?(?:\.min)?\.js$/i },
  { name: 'Moment', test: /^moment(?:\.min)?\.js$/i },
  { name: 'Day.js', test: /^dayjs(?:\.min)?\.js$/i },
  { name: 'D3', test: /^d3(?:\.v\d+)?(?:\.min)?\.js$/i },
  { name: 'Popper', test: /^popper(?:\.min)?\.js$/i },
  { name: 'Chart.js', test: /^chart(?:\.min)?\.js$/i },
  { name: 'ECharts', test: /^echarts(?:\.min)?\.js$/i },
  { name: 'Swiper', test: /^swiper(?:\.bundle)?(?:\.min)?\.js$/i },
]

/** 文件头里出现「库名 + 版本」时，说明这段代码自己报了家门 */
const HEADER_VENDORS: { name: string; test: RegExp }[] = [
  { name: 'Bootstrap', test: /bootstrap\s+v?\d+(?:\.\d+)*/i },
  { name: 'jQuery', test: /jquery\s+v?\d+(?:\.\d+)*/i },
  { name: 'Lodash', test: /lodash(?:\.js)?\s+v?\d+/i },
  { name: 'Axios', test: /axios\s+v?\d+/i },
  { name: 'Vue', test: /vue(?:\.js)?\s+v?\d+/i },
  { name: 'React', test: /react(?:\.js)?\s+v?\d+/i },
  { name: 'Moment', test: /moment(?:\.js)?\s+v?\d+/i },
  { name: 'D3', test: /d3(?:\.js)?\s+v?\d+/i },
  { name: 'Popper', test: /popper(?:\.js)?\s+v?\d+/i },
  { name: 'Chart.js', test: /chart(?:\.js)?\s+v?\d+/i },
  { name: 'ECharts', test: /echarts\s+v?\d+/i },
]

const LICENSE_MARKERS = [
  /\/\*!/,
  /@license/i,
  /SPDX-License-Identifier:/i,
  /(?:MIT|Apache|BSD|GPL|LGPL)\s+License/i,
  /Licensed under the/i,
  /Copyright\s*(?:\(c\))?\s*\d{4}/i,
]

/** 可能放第三方库的目录名 */
const STATIC_DIRS = new Set(['static', 'public', 'assets', 'js', 'css', 'lib', 'libs', 'plugins'])

const PROBE_EXTS = /\.(?:js|mjs|cjs|css)$/i

export interface VendorCandidate {
  path: string
  header: string
  size: number
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function pathParts(path: string): string[] {
  return path.toLowerCase().split('/').slice(0, -1)
}

/** 是否值得读文件头：代码文件且不在依赖 / 产物里，而且有理由怀疑 */
export function shouldProbeVendor(entry: ProjectFileEntry): boolean {
  if (entry.category !== 'user') return false
  if (isMinifiedOrMap(entry.path)) return false

  const name = baseName(entry.path)
  if (!PROBE_EXTS.test(name)) return false
  if (KNOWN_VENDORS.some((row) => row.test.test(name))) return true

  const lower = entry.path.toLowerCase()
  if (lower.includes('/static/') || lower.includes('/public/') || lower.includes('/assets/')) {
    return true
  }
  if (pathParts(entry.path).some((part) => STATIC_DIRS.has(part))) return true
  return entry.size >= 8 * 1024
}

function hasLicenseMarker(header: string): boolean {
  return LICENSE_MARKERS.some((pattern) => pattern.test(header))
}

function isStaticPath(path: string): boolean {
  return pathParts(path).some((part) => STATIC_DIRS.has(part))
}

/**
 * 根据文件名和文件头判断是不是第三方库。
 *   · 高：文件名和文件头都指向同一个库（或文件名 + 许可证头）
 *   · 中：只有其中一个
 *   · 低：没有结论，由调用方决定要不要放进 Agent 候选池
 */
export function detectVendor(path: string, header: string): VendorHint | null {
  const name = baseName(path)
  const nameVendor = KNOWN_VENDORS.find((row) => row.test.test(name))
  const headerVendor = HEADER_VENDORS.find((row) => row.test.test(header))
  const licensed = hasLicenseMarker(header)

  if (nameVendor && headerVendor) {
    if (nameVendor.name === headerVendor.name) {
      return {
        name: nameVendor.name,
        confidence: 'high',
        evidence: `文件名与文件头都指向 ${nameVendor.name}`,
      }
    }
    return {
      name: headerVendor.name,
      confidence: 'medium',
      evidence: `文件名像 ${nameVendor.name}，文件头像 ${headerVendor.name}`,
    }
  }

  if (nameVendor && licensed) {
    return {
      name: nameVendor.name,
      confidence: 'high',
      evidence: `文件名是 ${nameVendor.name}，文件头带许可证`,
    }
  }

  if (nameVendor) {
    return {
      name: nameVendor.name,
      confidence: 'medium',
      evidence: `文件名像 ${nameVendor.name}`,
    }
  }

  if (headerVendor) {
    return {
      name: headerVendor.name,
      confidence: 'medium',
      evidence: `文件头像 ${headerVendor.name}`,
    }
  }

  return null
}

/**
 * 规则没有结论、但值得让 Agent 看一眼的文件。
 * 只收「有许可证头」或「静态目录里的大文件」，避免把普通业务代码全送过去。
 */
export function isVendorReviewCandidate(entry: ProjectFileEntry, header: string): boolean {
  if (!shouldProbeVendor(entry)) return false
  if (hasLicenseMarker(header)) return true
  return isStaticPath(entry.path) && entry.size >= 8 * 1024
}

/**
 * Agent 评审上限：候选池的 10%，下限 3、上限 20。
 * 候选本身不足 3 个时全审。所有计算都在程序里，模型只拿到名单。
 */
export function vendorReviewCap(candidateCount: number): number {
  if (candidateCount <= 0) return 0
  if (candidateCount <= 3) return candidateCount
  return Math.min(20, Math.max(3, Math.ceil(candidateCount * 0.1)))
}

/** 候选多时按文件大小优先：整包库通常比业务文件大 */
export function pickVendorCandidates(
  candidates: VendorCandidate[],
  cap: number,
): VendorCandidate[] {
  return [...candidates]
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))
    .slice(0, cap)
}
