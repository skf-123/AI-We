/**
 * 检索：把用户贴的代码变成查询，从知识库里找出最相关的几条资料。
 *
 * 语料只有几十条，所以不装向量数据库 —— 在内存里逐条算余弦相似度，
 * 几十次乘法用不了 1 毫秒。
 *
 * ⚠️ 一个实测出来的重要结论：
 *    embedding 模型会把「所有代码」放在向量空间的相近区域，
 *    相似度主要被「这是代码」驱动，而不是「这是关于 reduce 的」。
 *    实测 C++ 代码对 JS 语料也能拿到 0.57~0.59 的相似度。
 *    所以单靠相似度阈值分不开「相关」和「不相关」。
 *
 *    对策是加一层【语言过滤】：先判断代码是什么语言，只在该语言的资料里检索。
 *    碰到没收录的语言（C++、Go 等），直接不检索 —— 干净降级，不硬凑。
 */
import type { CorpusLang, EmbedConfig, RagConfig, RetrievedDoc } from './types'
import { loadCorpus } from './corpus'
import { embedQuery } from './embed'

/** 语料条目的语言 → 检索分桶。前端几门语言合并成一个桶，因为它们经常混着出现 */
const LANG_BUCKET: Record<CorpusLang, Bucket> = {
  javascript: 'frontend',
  typescript: 'frontend',
  react: 'frontend',
  vue: 'frontend',
  css: 'frontend',
  python: 'python',
  java: 'java',
  sql: 'sql',
}

type Bucket = 'frontend' | 'python' | 'java' | 'sql'

/** 代码语言的判断结果。'none' 表示「认得出来是这门语言，但我们没收录它的资料」 */
type DetectedBucket = Bucket | 'none' | 'unknown'

/**
 * 用特征串粗略判断代码语言。不追求精确，够用来分桶就行。
 * 顺序有讲究：越有辨识度的特征放越前面。
 */
export function detectBucket(code: string): DetectedBucket {
  // ---- 我们没收录的语言：识别出来是为了能干净地放弃检索，而不是硬凑 ----

  // C / C++
  if (/(^|\n)\s*#include\s*[<"]/.test(code) || /\bstd::/.test(code) || /\bprintf\s*\(/.test(code)) {
    return 'none'
  }
  if (/(^|\n)\s*using\s+namespace\s+std\b/.test(code)) {
    return 'none'
  }

  // Go：package 声明 + func 定义，这个组合足够特异
  if (/(^|\n)\s*package\s+\w+/.test(code) && /\bfunc\s+\w*\s*\(/.test(code)) {
    return 'none'
  }

  // Rust：fn 定义 + 这几个 Rust 独有的写法
  if (/\bfn\s+\w+\s*\(/.test(code) && /(\blet\s+mut\b|println!|use\s+std::|\bimpl\b)/.test(code)) {
    return 'none'
  }

  // Java
  if (
    /\bpublic\s+(class|interface|enum)\b/.test(code) ||
    /\bSystem\.(out|err)\.print/.test(code) ||
    /(^|\n)\s*import\s+java\./.test(code) ||
    /@(Override|Autowired|RestController|Service)\b/.test(code)
  ) {
    return 'java'
  }

  // Python
  //
  // ⚠️ import 这条规则必须写得紧一点。原来写的是 /(import|from)\s+\w+/，
  //    会把 JS 的默认导入 `import React from 'react'` 也判成 Python ——
  //    必须要求「import 后面直接到行尾」，或者「行首的 from x import」这两种 Python 独有形。
  if (
    /(^|\n)\s*def\s+\w+\s*\([^)]*\)\s*:/.test(code) ||
    /(^|\n)\s*import\s+\w+(\s*,\s*\w+)*\s*$/m.test(code) ||
    /(^|\n)\s*from\s+[\w.]+\s+import\b/.test(code) ||
    /\b(elif|self\.|__init__)\b/.test(code) ||
    (/(^|\n)\s*@\w+\s*$/m.test(code) && /\bdef\b/.test(code))
  ) {
    return 'python'
  }

  // SQL —— 只在看起来确实是 SQL 语句时才算，避免把普通字符串误判
  if (
    /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/i.test(code) &&
    /\b(FROM|WHERE|VALUES|SET|INTO)\b/i.test(code)
  ) {
    return 'sql'
  }

  // 前端：JS / TS / React / Vue / CSS
  if (
    /\b(import|export)\b/.test(code) ||
    /\b(const|let|var|function)\s/.test(code) ||
    /=>/.test(code) ||
    /<\/?[A-Za-z][\w-]*/.test(code) ||
    /\b(useState|useEffect|ref|reactive|computed)\s*\(/.test(code) ||
    /[.#][\w-]+\s*\{/.test(code)
  ) {
    return 'frontend'
  }

  return 'unknown'
}

/**
 * 构造检索用的查询文本。
 *
 * 用「代码前 1500 字 + 抽出来的导入行」。
 *
 * 试过并**实测否决**的另一种做法：只把标识符抽成关键词串。
 * 它看着更"干净"，但丢掉了代码里的上下文语义 ——
 * 实测闭包、解构那两组直接掉出前 4 名，所以放弃。
 *
 * 也考虑过「先让大模型总结这段代码用了什么技术，再拿总结去检索」，
 * 那要多一次 LLM 调用、多几秒延迟，对这个规模的语料不值得。
 */
export function buildQuery(code: string): string {
  const head = code.slice(0, 1500)

  const importLines = code
    .split('\n')
    .filter((line) => /^\s*(import\s|from\s|const\s+\w+\s*=\s*require|#include|using\s)/.test(line))
    .slice(0, 12)

  return [head, ...importLines].join('\n')
}

/** 余弦相似度 */
export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * 检索最相关的资料。
 *
 * 这个函数**永不抛错**：任何环节出问题都返回空数组。
 * 检索不到是正常路径，不是异常 —— 上层据此退回纯模型回答。
 */
export async function retrieveDocs(
  code: string,
  ragCfg: RagConfig,
  embedCfg: EmbedConfig,
): Promise<RetrievedDoc[]> {
  if (!ragCfg.enabled) return []

  // ---- 语言过滤：只在该语言的资料里找 ----
  const detected = detectBucket(code)

  if (detected === 'none') {
    console.log('[rag] 识别到语料未收录的语言（如 C/C++），跳过检索')
    return []
  }

  const all = loadCorpus(embedCfg.dimensions)
  if (all.length === 0) return []

  const candidates =
    detected === 'unknown' ? all : all.filter((item) => LANG_BUCKET[item.entry.lang] === detected)

  if (candidates.length === 0) {
    console.log(`[rag] 语料里没有 ${detected} 类资料，跳过检索`)
    return []
  }

  // ---- 向量检索 ----
  const queryVector = await embedQuery(buildQuery(code), embedCfg)
  if (!queryVector) return []

  const scored: RetrievedDoc[] = candidates.map(({ entry, vector }) => ({
    ...entry,
    score: cosine(queryVector, vector),
  }))

  const hits = scored
    .filter((doc) => doc.score >= ragCfg.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, ragCfg.topK)

  if (hits.length === 0) {
    console.log(`[rag] ${detected} 类候选 ${candidates.length} 条，但都低于阈值 ${ragCfg.minScore}，降级`)
    return []
  }

  console.log(
    `[rag] 语言=${detected} 候选=${candidates.length} 命中：` +
      hits.map((h) => `${h.id}=${h.score.toFixed(3)}`).join(', '),
  )
  return hits
}
