/**
 * 把模型输出的流式文本切分成四段，并从中抠出知识框架图的 JSON。
 *
 * 这两个函数原先写在 app/pages/index.vue 的 computed 里。抽出来是因为
 * 「解析结果」面板要用切分、「知识框架图」面板要用图 JSON，两边都需要
 * 同一份标题约定 —— 让它们各自去 import 一个纯函数，比让其中一个去
 * 依赖另一个要干净。
 *
 * ⚠️ 标题文案必须与 server/utils/prompt.ts 里给模型的约定一字不差，
 *    改一边就要同步改另一边，否则切分直接失效（正文会整段渲染不出来）。
 */
import type { GraphData } from '~/types/analysis'

/** 四个文字小标题，必须与 server/utils/prompt.ts 里的约定一致 */
export const SECTION_TITLES = [
  '一、逐词逐句',
  '二、局部关系与作用',
  '三、整段整体作用',
  '四、技术溯源',
] as const

/** 第五部分是给图用的 JSON，不当作正文渲染 */
export const GRAPH_TITLE = '五、知识框架图'

export interface AnalysisSection {
  title: string
  body: string
}

/** 按四个小标题把流式文本切成块，边流边渲染 */
export function parseSections(text: string): AnalysisSection[] {
  const found: AnalysisSection[] = []
  // 切分边界 = 四个文字标题 + 图标题，避免图的 JSON 混进第四段正文
  const boundaries = [...SECTION_TITLES, GRAPH_TITLE]

  for (let i = 0; i < SECTION_TITLES.length; i++) {
    const title = SECTION_TITLES[i]!
    const start = text.indexOf(`## ${title}`)
    if (start === -1) continue

    const bodyStart = start + `## ${title}`.length
    const nextTitle = boundaries[i + 1]
    const end = nextTitle ? text.indexOf(`## ${nextTitle}`) : -1

    found.push({
      title,
      body: text.slice(bodyStart, end === -1 ? undefined : end).trim(),
    })
  }

  return found
}

/**
 * 从流式文本里把图 JSON 抠出来。
 *
 * 两种写法都兼容：
 *   1. 正常情况 —— 三个反引号包起来的 json 代码块
 *   2. 兜底 —— 模型忘了加代码围栏，就直接把标题后面的整段当 JSON 试
 *
 * 流式过程中 JSON 是不完整的，解析失败就返回 null，
 * 等它流完自然会解析成功，图到时候自己出现。
 */
export function parseGraphData(text: string): GraphData | null {
  const start = text.indexOf(`## ${GRAPH_TITLE}`)
  if (start === -1) return null

  const rest = text.slice(start + `## ${GRAPH_TITLE}`.length)
  const fenced = rest.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced ? fenced[1] : rest).trim()

  // 没闭合围栏时，candidate 会带着后面的内容，先退一步只取到最后一个 }
  const trimmed = fenced ? candidate : candidate.slice(0, candidate.lastIndexOf('}') + 1)

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed?.nodes) || !Array.isArray(parsed?.edges)) return null
    if (parsed.nodes.length === 0) return null
    return parsed as GraphData
  } catch {
    return null
  }
}
