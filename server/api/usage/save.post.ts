/**
 * POST /api/usage/save —— 把当前记录改名成一份保留记录，然后从 0 重新开始。
 */

import { saveSession, listSessions, usageEnabled } from '../../utils/usage-store'

export default defineEventHandler(async (event) => {
  if (!usageEnabled()) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const body = (await readBody(event).catch(() => null)) as { name?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name : ''

  try {
    const session = saveSession(name)
    return { session, sessions: listSessions() }
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : '保留失败',
    })
  }
})
