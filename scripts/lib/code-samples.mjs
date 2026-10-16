/**
 * 演示用的示例代码 —— **单一来源**。
 *
 * 这些示例不在这里定义，而是从 `app/components/CodePane.vue` 里的 `SAMPLES` 读出来。
 * 为什么要绕这一下：**页面上那个"点一下填进去"的代码，和探针实际跑的那段，必须是同一份。**
 * 各写一份的话，哪天改了页面上的示例，探针就悄悄地在测旧代码 —— 而这种漂移**不会报错**，
 * 只会在某次"探针说没问题"里悄悄误导人。
 *
 * 被三个探针共用（它们都要拿一个示例去跑真实流程）：
 *   scripts/cdp-verify.mjs            红线校验
 *   scripts/cdp-concurrency.mjs       并发实测
 *   scripts/parallel-cache-probe.mjs  缓存命中实测
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 仓库根目录：本文件在 scripts/lib/ 下，往上两级就是根 */
export const REPO_ROOT = join(HERE, '..', '..')

/**
 * 读出 `CodePane.vue` 里的示例列表。
 * @returns {{ label: string, code: string }[]}
 */
export function loadSamples() {
  const file = join(REPO_ROOT, 'app/components/CodePane.vue')
  const src = fs.readFileSync(file, 'utf8')

  const start = src.indexOf('const SAMPLES')
  if (start === -1) throw new Error('在 CodePane.vue 里找不到 `const SAMPLES` —— 组件结构变了？')

  // ⚠️ 必须从「= 」之后的第一个 `[` 开始找。
  //    类型注解 `{ label: string; code: string }[]` 里**本身就有一对中括号**，
  //    从 start 往后找会在那里就配平，得到一个空数组（这个坑踩过：脚本不报错、就是什么都不输出）。
  const eq = src.indexOf('=', start)
  const head = src.indexOf('[', eq)

  let depth = 0
  let end = -1
  for (let i = head; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new Error('没能把 SAMPLES 的数组配平')

  // 只读本地源码里的一段字面量，不执行任何外部输入
  return eval(`(${src.slice(head, end + 1)})`)
}
