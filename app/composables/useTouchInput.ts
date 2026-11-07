/**
 * 判断这台设备是不是“用手指、没有悬停”的输入方式。
 *
 * 用途有两个，判断的是能力而不是设备名：
 *   · 项目上传页：手机浏览器不支持选择整个文件夹，要禁用那个入口；
 *   · 追问气泡：手指设备上用右下角固定的“追问选中内容”，不用贴着选区的小浮标。
 *
 * 条件：没有悬停且主输入是手指（手机、平板，横竖屏都算）；
 * 另外补一条 iPad 桌面模式 —— UA 报成 Macintosh，但支持多点触控。
 * 触屏笔记本只要有鼠标或触控板，悬停仍然成立，不算。
 */
export function useTouchInput() {
  const touchLike = ref(false)
  let query: MediaQueryList | null = null

  function update() {
    if (typeof window === 'undefined') return

    const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches
    const iPadDesktop = navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)
    touchLike.value = coarse || iPadDesktop
  }

  onMounted(() => {
    update()
    query = window.matchMedia('(hover: none) and (pointer: coarse)')
    query.addEventListener('change', update)
  })

  onBeforeUnmount(() => {
    query?.removeEventListener('change', update)
  })

  return { touchLike }
}
