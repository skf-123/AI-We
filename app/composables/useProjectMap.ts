import { buildProjectContext } from '~/utils/project-files'

/**
 * 项目地图调用。
 *
 * 输入只发「目录树 + 每个文件头部几行」，不读全文（快照第十一节第 30 条第 1 小节）。
 * 产出两样东西：
 *   1. 目录树上的大白话说明（文件夹与文件的 note）
 *   2. 一段「项目结构结论」—— 它同时是逐文件调用的公共前缀，
 *      每次原样发送，前缀缓存才可能命中
 *
 * 失败不阻塞后续解析：说明为空、树照样能看，逐文件照常开始。
 */

export interface ProjectMapFileHead {
  path: string
  head: string
  size: number
}

export function useProjectMap() {
  const summary = ref('')
  const folderNotes = reactive<Record<string, string>>({})
  const fileNotes = reactive<Record<string, string>>({})
  const loading = ref(false)
  const degraded = ref(false)
  const error = ref('')
  const ran = ref(false)

  async function run(projectName: string, treeText: string, fileHeads: ProjectMapFileHead[]) {
    loading.value = true
    error.value = ''
    degraded.value = false

    try {
      const res = await fetch('/api/project/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName,
          treeText,
          fileHeads: fileHeads.map((f) => ({ path: f.path, head: f.head })),
        }),
      })

      if (!res.ok) {
        let msg = `生成目录说明失败（HTTP ${res.status}）`
        try {
          const data = await res.json()
          msg = data?.statusMessage || data?.message || msg
        } catch {
          /* 保持默认提示 */
        }
        error.value = msg
        degraded.value = true
        return
      }

      const data = (await res.json()) as {
        summary?: string
        folders?: { path: string; note: string }[]
        files?: { path: string; note: string }[]
        degraded?: boolean
      }

      summary.value = data.summary ?? ''
      degraded.value = Boolean(data.degraded)

      for (const key of Object.keys(folderNotes)) Reflect.deleteProperty(folderNotes, key)
      for (const key of Object.keys(fileNotes)) Reflect.deleteProperty(fileNotes, key)

      for (const row of data.folders ?? []) folderNotes[row.path] = row.note
      for (const row of data.files ?? []) fileNotes[row.path] = row.note
    } catch (err) {
      error.value = `生成目录说明出错了：${err instanceof Error ? err.message : String(err)}`
      degraded.value = true
    } finally {
      ran.value = true
      loading.value = false
    }
  }

  /** 逐文件请求要原样带上的项目结构结论 */
  function context(projectName: string): string {
    return buildProjectContext(projectName, summary.value, { ...folderNotes }, { ...fileNotes })
  }

  function reset() {
    summary.value = ''
    for (const key of Object.keys(folderNotes)) Reflect.deleteProperty(folderNotes, key)
    for (const key of Object.keys(fileNotes)) Reflect.deleteProperty(fileNotes, key)
    loading.value = false
    degraded.value = false
    error.value = ''
    ran.value = false
  }

  return {
    summary,
    folderNotes,
    fileNotes,
    loading,
    degraded,
    error,
    ran,
    run,
    context,
    reset,
  }
}
