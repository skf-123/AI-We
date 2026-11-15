/**
 * 把 Vue Flow 画布导成 PNG。
 *
 * 只截传入的那个画布元素，不截外层工具栏和图例；Vue Flow 自己的缩放控件、
 * 小地图会通过 filter 排除，否则图片右下角会多出一块按钮。
 *
 * 大图的风险：浏览器 canvas 有尺寸上限。这里按最长边 8000 像素反推
 * pixelRatio，宁可降清晰度也不让导出直接失败。
 */

export interface GraphExportOptions {
  backgroundColor?: string
  /** 期望的像素比，默认 2 倍 */
  pixelRatio?: number
  /** 导出图最长边，默认 8000 像素 */
  maxPixels?: number
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function download(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export async function exportGraphImage(
  element: HTMLElement | null,
  filename: string,
  options: GraphExportOptions = {},
): Promise<void> {
  if (!element) throw new Error('图还没有渲染完成')

  // 等一帧，确保 Vue Flow 的节点和边都已经落到 DOM 上
  await nextFrame()
  await nextFrame()

  const rect = element.getBoundingClientRect()
  const longest = Math.max(rect.width, rect.height, 1)
  const wanted = options.pixelRatio ?? 2
  const maxPixels = options.maxPixels ?? 8000
  const pixelRatio = Math.max(1, Math.min(wanted, maxPixels / longest))

  // html-to-image 把画布克隆进 foreignObject 后，SVG 的 fill / stroke 可能丢失，
  // 边线会被填成黑色大块；卡片阴影也会画成黑块。导出期间先写成内联样式，截完再恢复。
  const restoreStyles: (() => void)[] = []
  for (const path of element.querySelectorAll<SVGPathElement>('.vue-flow__edge-path')) {
    const previous = path.style.cssText
    path.style.fill = 'none'
    path.style.stroke = '#cbd5e1'
    path.style.strokeWidth = '1.2px'
    restoreStyles.push(() => {
      path.style.cssText = previous
    })
  }
  for (const bg of element.querySelectorAll<SVGElement>('.vue-flow__edge-textbg')) {
    const previous = bg.style.fill
    bg.style.fill = '#ffffff'
    restoreStyles.push(() => {
      bg.style.fill = previous
    })
  }
  for (const text of element.querySelectorAll<SVGElement>('.vue-flow__edge-text')) {
    const previous = text.style.fill
    text.style.fill = '#94a3b8'
    restoreStyles.push(() => {
      text.style.fill = previous
    })
  }
  // 节点卡片的 box-shadow 在 foreignObject 里会被画成大块黑色阴影，导出时先关掉
  for (const node of element.querySelectorAll<HTMLElement>('*')) {
    if (getComputedStyle(node).boxShadow !== 'none') {
      const previous = node.style.boxShadow
      node.style.boxShadow = 'none'
      restoreStyles.push(() => {
        node.style.boxShadow = previous
      })
    }
  }

  try {
    const { toPng } = await import('html-to-image')
    const dataUrl = await toPng(element, {
      backgroundColor: options.backgroundColor ?? '#fbfcfd',
      pixelRatio,
      cacheBust: true,
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true
        return (
          !node.classList.contains('vue-flow__controls') &&
          !node.classList.contains('vue-flow__panel') &&
          !node.classList.contains('vue-flow__minimap')
        )
      },
    })

    download(dataUrl, filename)
  } finally {
    for (const restore of restoreStyles) restore()
  }
}

/** 文件名带日期，避免连续导出时互相覆盖 */
export function graphFileName(label: string, state?: string): string {
  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  return `${label}${state ? `-${state}` : ''}-${date}.png`
}
