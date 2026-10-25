import type { FileProgress } from '~/types/project'
import { normalizePath } from '~/utils/project-files'
import { useAnalysis } from './useAnalysis'

/**
 * 逐文件解析的并发池。
 *
 * 池子放在前端（快照第十一节第 30 条第 4 小节）：
 *   · 服务端保持无状态，现有 /api/analyze 一行不动
 *   · 每个文件一个请求、一路流对应一个文件，不需要发明分隔协议
 *
 * 语义（与快照第 29 / 30 条一致）：
 *   queue 待解析；running 在飞（≤ limit）；完成一个补一个，不是等一批全完。
 *   stop() 一次 abort 所有在飞 + 清空队列；失败继续；点排队中的文件可插队。
 *
 * 并发档位由协议决定，不交给模型：h2/h3 → 32，http/1.1 → 5。
 */

export interface ProjectSourceFile {
  path: string
  file: File
}

/** 一行确定性判定（快照第十一节第 29 条实测定的档位） */
export function detectConcurrencyLimit(): number {
  if (typeof performance === 'undefined') return 5

  const nav = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined
  const proto = nav?.nextHopProtocol

  return proto === 'h2' || proto === 'h3' ? 32 : 5
}

export function useProjectAnalysis() {
  /** path → 界面要的状态。流式过程中由 watch 持续同步 */
  const progress = reactive<Record<string, FileProgress>>({})

  const total = ref(0)
  const finished = ref(0)
  const runningCount = ref(0)
  const allSettled = ref(false)
  const limit = ref(detectConcurrencyLimit())
  const stopped = ref(false)

  const instances: Record<string, ReturnType<typeof useAnalysis>> = {}
  const watcherStops: (() => void)[] = []
  /**
   * 已读到的文件原文：汇总调用抽第三段 / import / 项目模式追问时用，不再读一遍盘。
   *
   * 用 shallowReactive 而不是普通 Map：追问的代码上下文是 computed(textOf(...))，
   * 普通 Map 的 set 不会触发重新计算，解析完成后上层仍拿到空字符串。
   * 值是字符串，不需要深层代理。
   */
  const texts = shallowReactive(new Map<string, string>())
  const handles = new Map<string, File>()

  let queue: string[] = []
  const running = new Set<string>()
  /** 每个文件开始解析的时间；用来算缓冲百分比 */
  const startedAt = new Map<string, number>()
  let ticker: ReturnType<typeof setInterval> | null = null
  /** 项目结构结论 —— 每次请求原样带上，作为前缀缓存的公共前缀 */
  let context = ''
  /** 等「增量解析全部落定」的调用方；allSettled 时统一 resolve */
  const settleWaiters: (() => void)[] = []

  function resolveSettledWaiters() {
    const waiters = settleWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  function waitUntilSettled(): Promise<void> {
    if (allSettled.value) return Promise.resolve()
    return new Promise((resolve) => settleWaiters.push(resolve))
  }

  function ensure(path: string) {
    const existing = instances[path]
    if (existing) return existing

    const inst = useAnalysis({
      endpoint: '/api/project/analyze',
      buildBody: (code) => ({ code, path, projectContext: context }),
    })
    instances[path] = inst
    progress[path] = {
      status: 'pending',
      output: '',
      sources: [],
      error: '',
      truncated: false,
      outputTruncated: false,
      percent: 0,
    }

    // useAnalysis 是每个文件一个实例、状态互相独立；这里把它的 ref
    // 镜像到 progress，目录树和右侧面板都只读 progress，不认识 composable。
    const stop = watch(
      [inst.output, inst.sources, inst.errorMsg, inst.truncated, inst.outputTruncated],
      () => {
        const p = progress[path]
        if (!p) return
        p.output = inst.output.value
        p.sources = [...inst.sources.value]
        p.error = inst.errorMsg.value
        p.truncated = inst.truncated.value
        p.outputTruncated = inst.outputTruncated.value
      },
      { immediate: true },
    )
    watcherStops.push(stop)

    return inst
  }

  /**
   * 按时间走的缓冲百分比：20 秒左右到 95%，完成时再跳到 100%。
   * 这不是真实进度，只用来让用户看到「还在动」，不要拿它判断何时结束。
   */
  function tickProgress() {
    const now = Date.now()
    let active = false

    for (const path of running) {
      const p = progress[path]
      if (!p || p.status !== 'running') continue

      const start = startedAt.get(path) ?? now
      p.percent = Math.min(95, Math.round(((now - start) / 20_000) * 95))
      active = true
    }

    if (!active) stopTicker()
  }

  function ensureTicker() {
    if (ticker) return
    ticker = setInterval(tickProgress, 200)
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker)
    ticker = null
  }

  async function pump() {
    if (stopped.value) return

    while (queue.length > 0 && running.size < limit.value) {
      const path = queue.shift()!
      ensure(path)
      if (progress[path]!.status === 'done') continue

      running.add(path)
      runningCount.value = running.size
      progress[path]!.status = 'running'
      void processOne(path)
    }

    if (!stopped.value && running.size === 0 && queue.length === 0 && total.value > 0) {
      allSettled.value = true
      resolveSettledWaiters()
    }
  }

  /** 已完成数按状态重算，不靠累加 —— 停止后再继续时不会把同一批文件数两遍 */
  function recountFinished() {
    finished.value = Object.values(progress).filter(
      (p) => p.status === 'done' || (p.status === 'error' && p.error !== '已停止'),
    ).length
  }

  async function processOne(path: string) {
    const inst = ensure(path)

    try {
      const file = handles.get(path)
      if (!file) throw new Error('文件内容已丢失，请重新上传')

      const text = await file.text()
      texts.set(path, text)

      const p = progress[path]!
      p.percent = 0
      startedAt.set(path, Date.now())
      ensureTicker()

      await inst.run(text)

      // run() 内部已经写完，watch 还没 flush —— 这里同步读一遍，避免状态晚一拍
      p.output = inst.output.value
      p.sources = [...inst.sources.value]
      p.truncated = inst.truncated.value
      p.outputTruncated = inst.outputTruncated.value
      p.error = inst.errorMsg.value

      if (stopped.value) {
        p.status = 'error'
        p.error = '已停止'
      } else {
        p.status = p.error ? 'error' : 'done'
      }
      p.percent = p.status === 'done' ? 100 : 0
      startedAt.delete(path)
    } catch (err) {
      const p = progress[path]!
      p.status = 'error'
      p.error = err instanceof Error ? err.message : String(err)
      p.percent = 0
      startedAt.delete(path)
    } finally {
      startedAt.delete(path)
      running.delete(path)
      runningCount.value = running.size
      recountFinished()

      if (stopped.value) {
        if (running.size === 0) allSettled.value = false
      } else {
        void pump()
      }
    }
  }

  /**
   * 开始解析。会先清掉上一轮的全部状态。
   * context 由页面在项目地图完成后生成，已经保证是稳定字符串。
   */
  async function start(files: ProjectSourceFile[], projectContext: string) {
    reset()
    context = projectContext

    for (const item of files) {
      const path = normalizePath(item.path)
      handles.set(path, item.file)
      queue.push(path)
    }

    total.value = queue.length
    stopped.value = false
    await pump()
  }

  /**
   * 只解析新增的文件，保留已有结果。
   *
   * 第一次解析之后，用户可能又勾了几个没解析过的文件；这里只把这几条加进队列，
   * 不清空 done、不重跑旧文件。返回的 Promise 在这批新增文件全部落定后 resolve。
   */
  async function startAdditional(files: ProjectSourceFile[], projectContext: string) {
    if (projectContext) context = projectContext

    let added = 0

    for (const item of files) {
      const path = normalizePath(item.path)
      handles.set(path, item.file)

      const p = progress[path]
      if (p?.status === 'done') continue
      if (!p) {
        ensure(path)
      } else if (p.status === 'error') {
        resetProgressForRetry(path)
      }

      // 已经在跑的等它跑完；已经在队列里的不重复入队
      if (progress[path]?.status === 'running') continue
      if (queue.includes(path)) continue

      queue.push(path)
      added++
    }

    if (added === 0 && running.size === 0 && queue.length === 0) {
      allSettled.value = total.value > 0
      if (allSettled.value) resolveSettledWaiters()
      return
    }

    total.value = handles.size
    stopped.value = false
    allSettled.value = false
    void pump()
    return waitUntilSettled()
  }

  /** 停止：一次掐掉所有在飞 + 清空队列，且不触发汇总 */
  function stop() {
    stopped.value = true
    queue = []
    stopTicker()
    startedAt.clear()

    for (const inst of Object.values(instances)) inst.stop()

    for (const path of running) {
      const p = progress[path]
      if (p && p.status === 'running') {
        p.status = 'error'
        p.error = '已停止'
        p.percent = 0
      }
    }

    running.clear()
    runningCount.value = 0
    allSettled.value = false
    resolveSettledWaiters()
    recountFinished()
  }

  /** 停止之后继续：把所有没完成的文件重新排进队列 */
  function resume() {
    stopped.value = false
    allSettled.value = false
    queue = [...handles.keys()].filter((path) => progress[path]?.status !== 'done')
    void pump()
  }

  /** 停止之后只继续指定的这一批（增量解析用），不把旧文件一起拉起来 */
  function resumePaths(paths: string[]) {
    stopped.value = false
    allSettled.value = false
    const target = new Set(paths.map(normalizePath))
    queue = [...target].filter(
      (path) => progress[path]?.status !== 'done' && !running.has(path),
    )
    void pump()
  }

  /** 把一条失败/停止的记录改回 pending；增量解析和单文件重试共用 */
  function resetProgressForRetry(key: string) {
    const p = progress[key]
    if (!p) return

    p.status = 'pending'
    p.error = ''
    p.output = ''
    p.sources = []
    p.truncated = false
    p.outputTruncated = false
    p.percent = 0
  }

  /** 单文件重试：把失败项重新放回队首 */
  function retry(path: string) {
    const key = normalizePath(path)
    const p = progress[key]
    if (!p || p.status !== 'error') return

    resetProgressForRetry(key)

    const i = queue.indexOf(key)
    if (i !== -1) queue.splice(i, 1)
    queue.unshift(key)

    stopped.value = false
    allSettled.value = false
    void pump()
  }

  /** 点开一个还在排队的文件 → 移到队首（不改并发上限） */
  function prioritize(path: string) {
    const key = normalizePath(path)
    const i = queue.indexOf(key)
    if (i > 0) {
      queue.splice(i, 1)
      queue.unshift(key)
    }
  }

  function reset() {
    stopTicker()
    startedAt.clear()

    for (const inst of Object.values(instances)) inst.stop()
    for (const stopWatcher of watcherStops) stopWatcher()
    watcherStops.length = 0

    for (const key of Object.keys(instances)) Reflect.deleteProperty(instances, key)
    for (const key of Object.keys(progress)) Reflect.deleteProperty(progress, key)

    texts.clear()
    handles.clear()
    queue = []
    running.clear()

    context = ''
    total.value = 0
    finished.value = 0
    runningCount.value = 0
    allSettled.value = false
    stopped.value = false
    resolveSettledWaiters()
  }

  function textOf(path: string): string {
    return texts.get(normalizePath(path)) ?? ''
  }

  return {
    progress,
    total,
    finished,
    runningCount,
    allSettled,
    limit,
    stopped,
    start,
    startAdditional,
    stop,
    resume,
    resumePaths,
    retry,
    prioritize,
    reset,
    textOf,
  }
}
