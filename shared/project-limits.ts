/**
 * 项目逐文件解析的输入上限，前后端共用。
 *
 * 服务端 zod 用它挡住超长请求；前端在读取文件后先判断一次，
 * 避免把注定 400 的请求发出去。
 */
export const PROJECT_ANALYZE_MAX_CHARS = 100_000

/** 真正送进模型的上限；超过这个数会截断，但仍会解析 */
export const PROJECT_ANALYZE_MODEL_MAX_CHARS = 50_000

/** 超过硬上限时给用户看的说明；没超过返回 null */
export function projectAnalyzeTooLargeMessage(charCount: number): string | null {
  if (charCount <= PROJECT_ANALYZE_MAX_CHARS) return null
  return `文件有 ${charCount.toLocaleString()} 字符，超过单文件解析上限 ${PROJECT_ANALYZE_MAX_CHARS.toLocaleString()} 字符，没有发送。请取消勾选这个文件，或先拆分。`
}
