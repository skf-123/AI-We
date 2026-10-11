import { findEntry } from '../../rag/corpus'

/**
 * GET /api/source/:id
 *
 * 取知识库里某一条语料的正文，供前端"点开引用卡片看原文"用。
 *
 * 为什么单独开一个接口，而不是把正文塞进 /api/analyze 的响应头：
 *   4 条中文语料 URL 编码后约 8.5 KB，逼近 Node 默认的 16KB 头部上限，
 *   而某些部署环境的代理会卡在 8KB。点开时才取，既避开这个风险，
 *   也不用为每次解析都多传一份用不上的正文。
 *
 * 语料本身是公开的（在公开仓库里），所以直接返回正文没有泄露问题。
 */
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: '缺少语料 id' })
  }

  const entry = findEntry(id)

  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: `知识库里没有这条语料：${id}` })
  }

  return entry
})
