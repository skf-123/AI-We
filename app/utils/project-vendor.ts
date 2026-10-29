/**
 * 第三方库识别（纯函数）。
 *
 * 分工：
 *   · 程序读文件头、按「文件名 + 许可证头」给高 / 中置信度；
 *   · 规则拿不准的进入候选池，交给 Agent 评审（只出建议，不改勾选）；
 *   · 所有判断都在浏览器里完成，文件头不会为了分类单独发请求。
 */

import type { ProjectFileEntry, VendorHint } from '~/types/project'

/** 已知库的文件名规则：只匹配 basename，避免把路径里的词误当成库名 */
const KNOWN_VENDORS: { name: string; test: RegExp }[] = [
  { name: 'Bootstrap', test: /^bootstrap(?:\.bundle)?(?:\.min)?\.(?:js|css)$/i },
  { name: 'jQuery', test: /^jquery(?:[-.][\w.-]+)?\.js$/i },
  { name: 'Lodash', test: /^lodash(?:\.min)?\.js$/i },
  { name: 'Underscore', test: /^underscore(?:\.min)?\.js$/i },
  { name: 'Axios', test: /^axios(?:\.min)?\.js$/i },
  { name: 'Vue', test: /^vue(?:\.global|\.runtime)?(?:\.prod)?(?:\.min)?\.js$/i },
  { name: 'Vue Router', test: /^vue-router(?:\.min)?\.js$/i },
  { name: 'Vuex', test: /^vuex(?:\.min)?\.js$/i },
  { name: 'Pinia', test: /^pinia(?:\.min)?\.js$/i },
  { name: 'React', test: /^react(?:-dom)?(?:\.production|\.development)?(?:\.min)?\.js$/i },
  { name: 'AngularJS', test: /^angular(?:[-.][\w.-]+)?\.js$/i },
  { name: 'Element UI', test: /^element-ui(?:\.min)?\.js$/i },
  { name: 'Element Plus', test: /^element-plus(?:\.min)?\.js$/i },
  { name: 'Layui', test: /^layui(?:\.all)?(?:\.min)?\.(?:js|css)$/i },
  { name: 'Moment', test: /^moment(?:\.min)?\.js$/i },
  { name: 'Day.js', test: /^dayjs(?:\.min)?\.js$/i },
  { name: 'D3', test: /^d3(?:\.v\d+)?(?:\.min)?\.js$/i },
  { name: 'Popper', test: /^popper(?:\.min)?\.js$/i },
  { name: 'Chart.js', test: /^chart(?:\.min)?\.js$/i },
  { name: 'ECharts', test: /^echarts(?:\.min)?\.js$/i },
  { name: 'Swiper', test: /^swiper(?:[-.]bundle)?(?:\.min)?\.js$/i },
  { name: 'Zepto', test: /^zepto(?:\.min)?\.js$/i },
  { name: 'Backbone', test: /^backbone(?:\.min)?\.js$/i },
  { name: 'Knockout', test: /^knockout(?:[-.][\w.-]+)?\.js$/i },
  { name: 'Handlebars', test: /^handlebars(?:\.min)?\.js$/i },
  { name: 'Socket.IO', test: /^socket\.io(?:\.min)?\.js$/i },
  { name: 'Highlight.js', test: /^highlight(?:\.min)?\.js$/i },
  { name: 'Prism', test: /^prism(?:\.min)?\.js$/i },
  {
    name: 'SyntaxHighlighter',
    test: /^sh(?:Core|Brush|Theme|Legacy|Autoloader)[\w.-]*\.(?:js|css)$/i,
  },
  { name: 'Normalize.css', test: /^normalize(?:\.min)?\.css$/i },
  { name: 'Animate.css', test: /^animate(?:\.min)?\.css$/i },
  { name: 'React Router', test: /^react-router(?:-dom)?(?:\.min)?\.js$/i },
  { name: 'Redux', test: /^redux(?:\.min)?\.js$/i },
  { name: 'React Redux', test: /^react-redux(?:\.min)?\.js$/i },
  { name: 'RxJS', test: /^rxjs(?:\.umd)?(?:\.min)?\.js$/i },
  { name: 'Svelte', test: /^svelte(?:\.min)?\.js$/i },
  { name: 'Alpine.js', test: /^alpinejs(?:\.min)?\.js$/i },
  { name: 'htmx', test: /^htmx(?:\.min)?\.js$/i },
  { name: 'Three.js', test: /^three(?:\.min)?\.js$/i },
  { name: 'jQuery UI', test: /^jquery-ui(?:\.min)?\.js$/i },
  { name: 'jQuery Validation', test: /^jquery\.validate(?:\.min)?\.js$/i },
  { name: 'Select2', test: /^select2(?:\.min)?\.(?:js|css)$/i },
  { name: 'DataTables', test: /^(?:jquery\.)?dataTables(?:\.min)?\.js$/i },
  { name: 'TinyMCE', test: /^tinymce(?:\.min)?\.js$/i },
  { name: 'CKEditor', test: /^ckeditor(?:\.min)?\.js$/i },
  { name: 'Quill', test: /^quill(?:\.min)?\.(?:js|css)$/i },
  { name: 'CodeMirror', test: /^codemirror(?:\.min)?\.(?:js|css)$/i },
  { name: 'Bulma', test: /^bulma(?:\.min)?\.css$/i },
  { name: 'Foundation', test: /^foundation(?:\.min)?\.css$/i },
  { name: 'Materialize', test: /^materialize(?:\.min)?\.(?:js|css)$/i },
  { name: 'UIkit', test: /^uikit(?:\.min)?\.(?:js|css)$/i },
  { name: 'Bootstrap Icons', test: /^bootstrap-icons(?:\.min)?\.css$/i },
  { name: 'Core-js', test: /^core-js(?:\.min)?\.js$/i },
  { name: 'Regenerator Runtime', test: /^regenerator-runtime(?:\.min)?\.js$/i },
  { name: 'Zone.js', test: /^zone(?:\.min)?\.js$/i },
  { name: 'Luxon', test: /^luxon(?:\.min)?\.js$/i },
]

/** 文件头里出现「库名 + 版本」时，说明这段代码自己报了家门 */
const HEADER_VENDORS: { name: string; test: RegExp }[] = [
  { name: 'Bootstrap', test: /bootstrap\s+v?\d+(?:\.\d+)*/i },
  { name: 'jQuery', test: /jquery\s+v?\d+(?:\.\d+)*/i },
  { name: 'Lodash', test: /lodash(?:\.js)?\s+v?\d+/i },
  { name: 'Underscore', test: /underscore(?:\.js)?\s+v?\d+/i },
  { name: 'Axios', test: /axios\s+v?\d+/i },
  { name: 'Vue', test: /vue(?:\.js)?\s+v?\d+/i },
  { name: 'Vue Router', test: /vue-router\s+v?\d+/i },
  { name: 'Vuex', test: /vuex\s+v?\d+/i },
  { name: 'Pinia', test: /pinia\s+v?\d+/i },
  { name: 'React', test: /react(?:\.js)?\s+v?\d+/i },
  { name: 'AngularJS', test: /angular(?:js)?\s+v?\d+/i },
  { name: 'Element UI', test: /element-ui\s+v?\d+/i },
  { name: 'Element Plus', test: /element-plus\s+v?\d+/i },
  { name: 'Layui', test: /layui\s+v?\d+/i },
  { name: 'Moment', test: /moment(?:\.js)?\s+v?\d+/i },
  { name: 'Day.js', test: /dayjs\s+v?\d+/i },
  { name: 'D3', test: /d3(?:\.js)?\s+v?\d+/i },
  { name: 'Popper', test: /popper(?:\.js)?\s+v?\d+/i },
  { name: 'Chart.js', test: /chart(?:\.js)?\s+v?\d+/i },
  { name: 'ECharts', test: /echarts\s+v?\d+/i },
  { name: 'Swiper', test: /swiper\s+v?\d+/i },
  { name: 'Zepto', test: /zepto\s+v?\d+/i },
  { name: 'Backbone', test: /backbone(?:\.js)?\s+v?\d+/i },
  { name: 'Knockout', test: /knockout(?:\.js)?\s+v?\d+/i },
  { name: 'Handlebars', test: /handlebars\s+v?\d+/i },
  { name: 'Socket.IO', test: /socket\.io\s+v?\d+/i },
  { name: 'Highlight.js', test: /highlight(?:\.js)?\s+v?\d+/i },
  { name: 'Prism', test: /prism(?:\.js)?\s+v?\d+/i },
  { name: 'React Router', test: /react-router(?:-dom)?\s+v?\d+/i },
  { name: 'Redux', test: /redux\s+v?\d+/i },
  { name: 'RxJS', test: /rxjs\s+v?\d+/i },
  { name: 'Svelte', test: /svelte\s+v?\d+/i },
  { name: 'Alpine.js', test: /alpine(?:\.js)?\s+v?\d+/i },
  { name: 'htmx', test: /htmx\s+v?\d+/i },
  { name: 'Three.js', test: /three(?:\.js)?\s+v?\d+/i },
  { name: 'Select2', test: /select2\s+v?\d+/i },
  { name: 'DataTables', test: /datatables\s+v?\d+/i },
  { name: 'TinyMCE', test: /tinymce\s+v?\d+/i },
  { name: 'CKEditor', test: /ckeditor\s+v?\d+/i },
  { name: 'Quill', test: /quill\s+v?\d+/i },
  { name: 'CodeMirror', test: /codemirror\s+v?\d+/i },
  { name: 'Bulma', test: /bulma\s+v?\d+/i },
  { name: 'Foundation', test: /foundation\s+v?\d+/i },
  { name: 'Materialize', test: /materialize\s+v?\d+/i },
  { name: 'UIkit', test: /uikit\s+v?\d+/i },
  { name: 'Font Awesome', test: /font\s*awesome\s+v?\d+/i },
  { name: 'Core-js', test: /core-js\s+v?\d+/i },
  { name: 'Zone.js', test: /zone(?:\.js)?\s+v?\d+/i },
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

/**
 * 是否值得读文件头。
 *
 * 只看「文件形态」，不看它现在是不是用户文件：
 * 压缩产物和用户源码一样可能带许可证头，不能因为已经被判成
 * 压缩产物就跳过第三方库识别。
 */
export function shouldProbeVendor(entry: ProjectFileEntry): boolean {
  if (
    entry.subtype === 'dependency' ||
    entry.subtype === 'build' ||
    entry.subtype === 'tooling' ||
    entry.subtype === 'binary' ||
    entry.subtype === 'docs' ||
    entry.subtype === 'lockfile' ||
    entry.subtype === 'ide' ||
    entry.subtype === 'config' ||
    entry.subtype === 'source-map'
  ) {
    return false
  }

  const name = baseName(entry.path)
  if (!PROBE_EXTS.test(name)) return false

  if (KNOWN_VENDORS.some((row) => row.test.test(name))) return true
  if (entry.subtype === 'minified') return true

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
 * 把库名和原有原因拼成一句话。
 * 压缩产物、映射文件这些形态信息不能被库名盖掉，两者要同时出现。
 */
export function composeVendorReason(
  baseReason: string | undefined,
  vendorName: string,
  suspected = false,
): string {
  const prefix = suspected ? `疑似第三方库：${vendorName}` : `第三方库：${vendorName}`
  return baseReason ? `${prefix} · ${baseReason}` : prefix
}

/**
 * 规则没有结论、但值得让 Agent 看一眼的文件。
 * 只收仍然勾着的用户文件：已经默认不勾的系统文件再给建议没有意义。
 */
export function isVendorReviewCandidate(entry: ProjectFileEntry, header: string): boolean {
  if (entry.category !== 'user') return false
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
