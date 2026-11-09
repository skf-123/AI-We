import { apiFetchJson } from '~/utils/api'
/**
 * 代码截图识别。
 *
 * 只负责「把 File 变成一段代码文本」：校验格式和大小、转 data URL、
 * 调 /api/ocr、把服务端的报错翻译成能直接显示的一句话。
 * 不碰输入框、不碰解析按钮 —— 放不放进输入框、要不要开始解析，由组件决定。
 */

/** 和 server/api/ocr.post.ts 的上限保持一致 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const ACCEPTED = /^image\/(png|jpeg|webp)$/

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读不到这张图片'))
    reader.readAsDataURL(file)
  })
}

export function useImageCode() {
  const reading = ref(false)
  const error = ref('')

  async function extract(file: File): Promise<string | null> {
    error.value = ''

    if (!ACCEPTED.test(file.type)) {
      error.value = '只支持 PNG、JPG、WebP 三种截图格式'
      return null
    }

    if (file.size > MAX_IMAGE_BYTES) {
      error.value = `图片约 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 5 MB 的上限`
      return null
    }

    reading.value = true

    try {
      const image = await readAsDataUrl(file)
      const result = await apiFetchJson<{ code: string }>('/api/ocr', {
        method: 'POST',
        body: { image },
      })
      return result.code
    } catch (err) {
      const message = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      error.value = message || '识别失败，请稍后重试，或直接把代码粘进来'
      return null
    } finally {
      reading.value = false
    }
  }

  return { reading, error, extract }
}
