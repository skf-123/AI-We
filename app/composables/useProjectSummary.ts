/**
 * 全部文件解析完之后的一次汇总调用。
 *
 * 输入只有摘要（每文件第三段 + import 关系 + 项目地图），不重发全文。
 * 输出是流：项目文字边流边渲染；图 JSON 在流结束后才完整，解析成功就出现。
 */

export interface ProjectSummaryFile {
  path: string
  role: string
  imports: string[]
}

export interface ProjectSummaryPayload {
  projectName: string
  projectContext: string
  treeText: string
  files: ProjectSummaryFile[]
}

export function useProjectSummary() {
  const output = ref('')
  const loading = ref(false)
  const done = ref(false)
  const error = ref('')

  let controller: AbortController | null = null

  async function run(payload: ProjectSummaryPayload): Promise<void> {
    if (loading.value) return

    // 重跑时**先不清空旧结果**：新调用吐出第一块再替换。
    // 否则一次失败就会把一份已经生成好的总览冲掉。
    error.value = ''
    done.value = false
    loading.value = true

    controller = new AbortController()

    try {
      const res = await fetch('/api/project/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        let msg = `汇总失败（HTTP ${res.status}）`
        try {
          const data = await res.json()
          msg = data?.statusMessage || data?.message || msg
        } catch {
          /* 保持默认提示 */
        }
        error.value = msg
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let streamed = ''

      while (true) {
        const { done: finished, value } = await reader.read()
        if (finished) break
        streamed += decoder.decode(value, { stream: true })
        // 第一次赋值就替换掉旧结果，之后逐步增长
        output.value = streamed
      }

      done.value = true
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        done.value = true
      } else {
        error.value = `汇总出错了：${err instanceof Error ? err.message : String(err)}`
      }
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
    output.value = ''
    error.value = ''
    done.value = false
  }

  return { output, loading, done, error, run, stop, reset }
}
