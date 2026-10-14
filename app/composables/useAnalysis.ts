import type { RagSource } from '~/types/analysis'

/**
 * 「贴代码 → 流式出解析结果」这条链路的全部状态与请求逻辑。
 *
 * 抽出来是为了让**页面只做排版**：页面拿到 output / sources / loading 这些
 * 值往下传，至于这些值是怎么来的（fetch 哪个接口、怎么拆流、引用来源藏在
 * 哪个响应头里），页面不需要知道。
 *
 * 这样将来「项目树」那个新页面如果也要展示解析结果，直接再调一次
 * useAnalysis() 就行 —— 不用把这段请求逻辑复制第二份。
 *
 * ⚠️ 这里**不碰 DOM、不碰滚动**。
 *    「流式时面板自动跟到底部」是 AnalysisPanel 自己的事（它 watch output）。
 *    让这个 composable 去操作某个面板的 scrollTop，等于把请求逻辑和某一处
 *    视图绑死，那就白抽了。
 */
export function useAnalysis() {
  /** 流式原始文本（未切分） */
  const output = ref('')
  /** 知识库检索到的引用来源，走 X-Rag-Sources 响应头传来 */
  const sources = ref<RagSource[]>([])
  const errorMsg = ref('')
  const loading = ref(false)
  const done = ref(false)

  let controller: AbortController | null = null

  /**
   * 开始解析。Promise 在流结束时 resolve（出错或中止也算结束）。
   * 外层只需要 await 它；期间的状态变化都在这里维护。
   */
  async function run(code: string): Promise<void> {
    if (loading.value) return

    output.value = ''
    errorMsg.value = ''
    sources.value = []
    loading.value = true
    done.value = false

    controller = new AbortController()

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        // 服务端用 createError 返回的是 JSON，这里尽力把它读成人话
        let msg = `请求失败（HTTP ${res.status}）`
        try {
          const data = await res.json()
          msg = data?.statusMessage || data?.message || msg
        } catch {
          /* 保持默认提示 */
        }
        errorMsg.value = msg
        return
      }

      // 引用来源走响应头，读 body 之前先取出来 ——
      // 这样卡片在打字机刚开始输出时就能显示，不用等全文流完
      const rawSources = res.headers.get('X-Rag-Sources')
      if (rawSources) {
        try {
          sources.value = JSON.parse(decodeURIComponent(rawSources))
        } catch {
          sources.value = []
        }
      }

      // 逐块读取，读一块、显示一块 —— 这就是打字机效果的来源
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done: finished, value } = await reader.read()
        if (finished) break
        output.value += decoder.decode(value, { stream: true })
      }

      done.value = true
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // 用户主动停止：当作正常结束，不算错误
        done.value = true
      } else {
        errorMsg.value = `出错了：${err instanceof Error ? err.message : String(err)}`
      }
    } finally {
      loading.value = false
      controller = null
    }
  }

  /** 中止当前请求 */
  function stop() {
    controller?.abort()
    loading.value = false
  }

  /** 清空结果（不动输入框 —— 那是页面的事） */
  function reset() {
    output.value = ''
    errorMsg.value = ''
    done.value = false
    sources.value = []
  }

  return { output, sources, errorMsg, loading, done, run, stop, reset }
}
