/**
 * POST /api/usage/clear —— 清空当前记录，不生成保留文件。
 */

import { clearCurrent, usageEnabled } from '../../utils/usage-store'

export default defineEventHandler(() => {
  if (!usageEnabled()) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  clearCurrent()
  return { ok: true }
})
