import type { ProjectGraphData } from '~/types/project'
import { extractGraphJson, sanitizeProjectGraph } from '~/utils/project-graph'

/**
 * 只生成项目图的请求。
 *
 * 正常路径仍然走一次汇总；这里只在用户想「只重画图」时用。
 * 它不认识页面、不认识汇总的输出文本，只接收一份已经冻结好的输入，
 * 发请求、校验图、返回结果。这样图这条线和正文那条线可以各自改。
 */

export interface ProjectGraphInputFile {
  path: string
  role: string
  imports: string[]
}

export interface ProjectGraphPayload {
  projectName: string
  projectContext: string
  treeText: string
  files: ProjectGraphInputFile[]
  /** 上次汇总的正文；可以为空 */
  text: string
}

export function useProjectGraph() {
  const loading = ref(false)
  const done = ref(false)
  const error = ref('')
  /** 上游输出撞到上限，图内容可能不完整 */
  const truncated = ref(false)

  let controller: AbortController | null = null

  async function run(
    payload: ProjectGraphPayload,
    knownPaths: string[],
  ): Promise<ProjectGraphData | null> {
    if (loading.value) return null

    loading.value = true
    done.value = false
    error.value = ''
    truncated.value = false
    controller = new AbortController()

    try {
      const res = await fetch('/api/project/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok) {
        let msg = `图生成失败（HTTP ${res.status}）`
        try {
          const data = await res.json()
          msg = data?.statusMessage || data?.message || msg
        } catch {
          /* 保持默认提示 */
        }
        error.value = msg
        return null
      }

      const data = (await res.json()) as { content?: string; truncated?: boolean }
      truncated.value = Boolean(data.truncated)

      const graph = sanitizeProjectGraph(
        extractGraphJson(data.content ?? ''),
        knownPaths,
      )

      if (!graph) {
        error.value = truncated.value
          ? '图内容太长，被输出上限截断'
          : '图 JSON 没有解析成功'
        return null
      }

      done.value = true
      return graph
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        done.value = true
      } else {
        error.value = `图生成出错了：${err instanceof Error ? err.message : String(err)}`
      }
      return null
    } finally {
      loading.value = false
      controller = null
    }
  }

  function stop() {
    controller?.abort()
    loading.value = false
  }

  function reset() {
    stop()
    done.value = false
    error.value = ''
    truncated.value = false
  }

  return { loading, done, error, truncated, run, stop, reset }
}
