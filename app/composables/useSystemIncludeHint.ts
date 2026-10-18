/**
 * 勾选系统文件前的 AI 提示。
 *
 * 系统文件默认不勾；用户想勾时，先问一次模型「为什么不建议勾、勾了会怎样」，
 * 用一个短弹窗说明。这里只负责请求与状态，不碰 DOM、不碰页面上的勾选逻辑。
 *
 * 结果按「文件 / 目录 + 原因」缓存，同一个文件反复勾选不会反复调模型。
 */

export interface IncludeHintInput {
  kind: 'file' | 'folder'
  path: string
  label: string
  reason: string
  size?: number
  count?: number
}

const FALLBACK =
  '这是系统文件，勾选后会占用 1.9MB 的选中预算，通常不建议；如果你确实需要它参与理解，可以仍然勾选。'

export function useSystemIncludeHint() {
  const open = ref(false)
  const loading = ref(false)
  const text = ref('')
  const target = ref<IncludeHintInput | null>(null)

  const cache = new Map<string, string>()

  async function ask(input: IncludeHintInput) {
    target.value = input
    open.value = true
    text.value = ''

    const key = [input.kind, input.path, input.reason, input.count ?? ''].join('|')
    const hit = cache.get(key)
    if (hit) {
      text.value = hit
      loading.value = false
      return
    }

    loading.value = true
    try {
      const res = await fetch('/api/project/include-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { text?: string }
      const result = data.text?.trim() || FALLBACK
      text.value = result
      cache.set(key, result)
    } catch {
      text.value = FALLBACK
    } finally {
      loading.value = false
    }
  }

  function close() {
    open.value = false
    loading.value = false
    text.value = ''
    target.value = null
  }

  return { open, loading, text, target, ask, close }
}
