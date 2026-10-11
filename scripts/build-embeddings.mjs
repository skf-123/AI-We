#!/usr/bin/env node
/**
 * 离线预计算语料的向量，生成 server/rag/corpus.embeddings.json。
 *
 * 用法：
 *   npm run rag:build
 *   （等价于 node --env-file=.env scripts/build-embeddings.mjs）
 *
 * 为什么要离线跑，而不是在用户请求时现算：
 *   - 语料是固定的，向量也是固定的，没必要每次请求都算一遍
 *   - 省时间（几十毫秒×N 条）也省钱（少调几十次 API）
 *
 * 产物必须提交进 git —— Vercel 构建时不会、也不该调 embedding API。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CORPUS_PATH = join(ROOT, 'server/rag/corpus.json')
const OUT_PATH = join(ROOT, 'server/rag/corpus.embeddings.json')

const API_KEY = process.env.NUXT_EMBEDDING_API_KEY
const BASE_URL = (process.env.NUXT_EMBEDDING_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')
const MODEL = process.env.NUXT_EMBEDDING_MODEL || 'embedding-3'
const DIMENSIONS = Number(process.env.NUXT_EMBEDDING_DIMENSIONS || 1024)

/** 智谱 embedding 接口单次数组上限是 64 条 */
const BATCH_SIZE = 64

/**
 * 内容哈希，用于运行时检测「语料改了但忘了重跑脚本」。
 * ⚠️ 这个实现必须与 server/rag/corpus.ts 里的 hashText() 完全一致，
 *    改了一边就要同步改另一边，否则所有向量都会被判定为失效。
 */
function hashText(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

async function embedBatch(texts, offset) {
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: texts,
      dimensions: DIMENSIONS,
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`第 ${offset + 1} 条起的一批请求失败（HTTP ${res.status}）：${detail.slice(0, 300)}`)
  }

  const json = await res.json()
  const vectors = json?.data?.map((d) => d.embedding)

  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error(
      `返回的向量数量对不上：请求 ${texts.length} 条，返回 ${Array.isArray(vectors) ? vectors.length : '非数组'}`,
    )
  }
  return vectors
}

async function main() {
  console.log('=== 开始预计算语料向量 ===')
  console.log(`服务地址：${BASE_URL}`)
  console.log(`模型：${MODEL}  维度：${DIMENSIONS}`)
  console.log('')

  if (!API_KEY) {
    console.error('❌ 缺少 NUXT_EMBEDDING_API_KEY')
    console.error('   请确认 .env 里有这一项，并用 npm run rag:build 运行（它会自动加载 .env）')
    process.exit(1)
  }

  if (!existsSync(CORPUS_PATH)) {
    console.error(`❌ 找不到语料文件：${CORPUS_PATH}`)
    process.exit(1)
  }

  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
  if (!Array.isArray(corpus) || corpus.length === 0) {
    console.error('❌ 语料为空')
    process.exit(1)
  }
  console.log(`读到语料 ${corpus.length} 条`)

  // 送进 embedding 的文本 = 标题 + 正文。
  // 带标题是因为标题往往是技术名（如 "Array.prototype.reduce"），
  // 对检索的区分度贡献很大。
  const texts = corpus.map((e) => `${e.title}\n${e.content}`)

  const allVectors = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    process.stdout.write(`  正在向量化 ${i + 1} ~ ${i + batch.length} …`)
    const vectors = await embedBatch(batch, i)
    allVectors.push(...vectors)
    console.log(' 完成')
  }

  const items = corpus.map((entry, i) => {
    const vector = allVectors[i]
    if (!Array.isArray(vector) || vector.length !== DIMENSIONS) {
      throw new Error(
        `第 ${i + 1} 条（${entry.id}）向量维度异常：期望 ${DIMENSIONS}，实际 ${Array.isArray(vector) ? vector.length : '非数组'}`,
      )
    }
    return {
      id: entry.id,
      hash: hashText(`${entry.title}\n${entry.content}`),
      vector,
    }
  })

  const out = {
    model: MODEL,
    dimensions: DIMENSIONS,
    generatedAt: new Date().toISOString(),
    items,
  }

  writeFileSync(OUT_PATH, JSON.stringify(out), 'utf8')

  const sizeKB = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(1)
  console.log('')
  console.log(`✅ 完成：${items.length} 条向量已写入`)
  console.log(`   ${OUT_PATH}`)
  console.log(`   文件大小：${sizeKB} KB`)
  console.log('')
  console.log('提醒：这个文件要提交进 git，Vercel 构建时不会重新生成它。')
}

main().catch((err) => {
  console.error('')
  console.error('❌ 生成失败：', err.message)
  process.exit(1)
})
