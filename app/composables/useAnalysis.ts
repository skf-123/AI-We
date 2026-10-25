import { stripOutputTruncation } from '#shared/stream-meta'
import type { RagSource } from '~/types/analysis'
import type { FactClaim } from '~/types/facts'
import { stripFactsBlock } from '~/utils/project-facts'

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
export interface UseAnalysisOptions {
  /** 默认 /api/analyze；项目入口传 /api/project/analyze */
  endpoint?: string
  /** 默认只发 { code }；项目入口要额外带上文件路径与项目结构结论 */
  buildBody?: (code: string) => Record<string, unknown>
  /** 项目入口专用：把输出末尾的跨文件事实块剥掉，交给上层核对 */
  parseFacts?: boolean
}

export function useAnalysis(options: UseAnalysisOptions = {}) {
  const endpoint = options.endpoint ?? '/api/analyze'
  const buildBody = options.buildBody ?? ((code: string) => ({ code }))

  /** 流式原始文本（未切分） */
  const output = ref('')
  /** 知识库检索到的引用来源，走 X-Rag-Sources 响应头传来 */
  const sources = ref<RagSource[]>([])
  const errorMsg = ref('')
  const loading = ref(false)
  const done = ref(false)
  /** 服务端是否因为超长截断过（X-Project-Truncated），贴代码入口恒为 false */
  const truncated = ref(false)
  /** 输出是否撞到模型上限（流末尾的标记），和输入截断是两回事 */
  const outputTruncated = ref(false)
  /** 项目入口：模型在末尾给出的跨文件事实块 */
  const facts = ref<FactClaim[]>([])
  const factsError = ref('')

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
    truncated.value = false
    outputTruncated.value = false
    facts.value = []
    factsError.value = ''
    loading.value = true
    done.value = false

    controller = new AbortController()

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(code)),
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

      // 项目模式下单文件超过 50000 字符会被服务端截断，界面上要明说
      truncated.value = Boolean(res.headers.get('X-Project-Truncated'))

      // 逐块读取，读一块、显示一块 —— 这就是打字机效果的来源
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let streamed = ''

      while (true) {
        const { done: finished, value } = await reader.read()
        if (finished) break
        streamed += decoder.decode(value, { stream: true })

        // 服务端在撞到输出上限时会在流末尾追加一个不可见标记；
        // 去掉它，只把正文显示出来，同时记下「这次输出不完整」
        const stripped = stripOutputTruncation(streamed)
        streamed = stripped.text
        if (stripped.truncated) outputTruncated.value = true

        if (options.parseFacts) {
          const next = stripFactsBlock(streamed)
          output.value = next.text
          if (next.claims) {
            facts.value = next.claims
            factsError.value = next.error ?? ''
          } else if (next.error) {
            factsError.value = next.error
          }
        } else {
          output.value = streamed
        }
      }

      if (options.parseFacts) {
        const final = stripFactsBlock(streamed)
        output.value = final.text
        if (final.claims) {
          facts.value = final.claims
          factsError.value = final.error ?? ''
        } else if (final.error) {
          factsError.value = final.error
        } else if (final.pending) {
          factsError.value = '事实块没有闭合，本次没有可核对的事实'
        }
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
    truncated.value = false
    outputTruncated.value = false
    facts.value = []
    factsError.value = ''
  }

  return {
    output,
    sources,
    errorMsg,
    loading,
    done,
    truncated,
    outputTruncated,
    facts,
    factsError,
    run,
    stop,
    reset,
  }
}
