/**
 * Agent 轨迹的展示转换（纯函数）。
 *
 * 数据只有一份：AgentStep[]。开发者版原样显示；阅读版把同一批工具调用
 * 翻译成人话。这里不调模型、不补理由，模型没说的就不写。
 */

import type { AgentStep } from '~/types/project'

export interface TraceRound {
  round: number
  steps: AgentStep[]
  note?: string
}

export interface ToolLabel {
  raw: string
  zh: string
}

const TOOL_LABELS: Record<string, string> = {
  list_dir: '查看目录',
  read_config: '读取全文',
  read_file_slice: '读取片段',
  grep: '搜索',
  search_knowledge: '查知识库',
}

export function describeTool(name: string): ToolLabel {
  return { raw: name, zh: TOOL_LABELS[name] ?? name }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 把工具参数翻译成一句人话；原文仍由开发者版和「原始参数」保留 */
export function formatStepArgs(step: AgentStep): string {
  const args = parseArgs(step.args)

  switch (step.name) {
    case 'list_dir': {
      const path = String(args.path ?? '').trim()
      return path || '项目根目录'
    }
    case 'read_config':
      return String(args.path ?? '')
    case 'read_file_slice': {
      const path = String(args.path ?? '')
      const start = Number(args.start_line ?? 0)
      const end = Number(args.end_line ?? 0)
      return start && end ? `${path} 第 ${start}–${end} 行` : path
    }
    case 'grep': {
      const query = String(args.query ?? '')
      const prefix = String(args.path_prefix ?? '').trim()
      return prefix ? `「${query}」在 ${prefix}` : `「${query}」`
    }
    case 'search_knowledge':
      return `「${String(args.query ?? '')}」`
    default:
      return step.args
  }
}

/** 从工具返回文本里算一个结果预览，不额外调模型 */
export function formatStepResult(step: AgentStep): string {
  const result = step.result.trim()
  if (!result) return '没有返回内容'
  if (result.startsWith('错误：')) return result.slice(0, 80)

  switch (step.name) {
    case 'list_dir': {
      const count = result.split('\n').filter((line) => line.startsWith('- ')).length
      return `列出 ${count} 个条目`
    }
    case 'read_file_slice': {
      const count = result.split('\n').length
      return `读取 ${count} 行`
    }
    case 'read_config': {
      return `读取 ${result.split('\n').length} 行 / ${result.length} 字符`
    }
    case 'grep': {
      const hits = result.split('\n').filter((line) => /^[^:\n]+:\d+:/.test(line)).length
      return hits > 0 ? `命中 ${hits} 处` : '没有命中'
    }
    case 'search_knowledge': {
      const hits = (result.match(/^\[\d+\]/gm) ?? []).length
      return hits > 0 ? `检索到 ${hits} 条资料` : '没有检索到资料'
    }
    default:
      return `${result.length} 字符`
  }
}

/** 一轮里调了哪些工具、各几次：list_dir ×1 · read_config ×3 */
export function summarizeToolCalls(steps: AgentStep[]): string {
  const counts = new Map<string, number>()

  for (const step of steps) {
    counts.set(step.name, (counts.get(step.name) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(' · ')
}

/** 按轮分组；同一轮的文字说明只取第一条 */
export function groupTraceSteps(steps: AgentStep[]): TraceRound[] {
  const groups = new Map<number, TraceRound>()

  for (const step of steps) {
    const group = groups.get(step.round) ?? { round: step.round, steps: [] }
    group.steps.push(step)
    if (!group.note && step.note) group.note = step.note
    groups.set(step.round, group)
  }

  return [...groups.values()].sort((a, b) => a.round - b.round)
}
