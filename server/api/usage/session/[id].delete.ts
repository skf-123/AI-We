/**
 * DELETE /api/usage/session/:id —— 删除一份已保留记录。
 */

import { deleteSession, listSessions, usageEnabled } from '../../../utils/usage-store'

export default defineEventHandler((event) => {
  if (!usageEnabled()) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const id = getRouterParam(event, 'id') ?? ''

  try {
    deleteSession(id)
    return { ok: true, sessions: listSessions() }
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : '删除失败',
    })
  }
})
