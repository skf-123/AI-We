<script setup lang="ts">
/**
 * 一本不断「打开又合上」的小书。
 *
 * 用在「解析结果」面板正在生成时的位置 —— 替掉原来那个只会微弱闪烁的绿方块。
 * 含义：内容正在被翻开、生成出来。
 *
 * 纯 CSS 3D：perspective + transform-style: preserve-3d + rotateY + 关键帧。
 * 零依赖、零许可问题。
 *
 * ── 为什么是"开合"而不是"翻页" ──
 * 一开始做的是"右页绕书脊翻到左边"（经典翻页）。放大一看**完全不像书**：
 * 26px 的空间里，两团圆角矩形只是在互相挪动，看着像一根被切开的进度条。
 * 根因是尺寸 —— 那么小的面积放不下"书的轮廓"，只能靠颜色差异，而颜色差异
 * 在这个尺度上太弱。
 *
 * 所以改成**形状变化**：合上时是一个矩形，打开时两张页面各转 50° 变成 V 形。
 * 轮廓变化足够大，小尺寸也一眼看得出来。
 *
 * ⚠️ 踩坑提醒（来自「书本效果」那份调研）：父级只要出现 overflow 非 visible、
 *    opacity < 1、filter、clip-path 这类"分组属性"，浏览器会把 preserve-3d
 *    强制降级成 flat，立体感直接消失。所以这一块外面**不要**套这类样式。
 */
</script>

<template>
  <!-- 纯装饰，对读屏器隐藏（旁边的「正在生成…」才是内容） -->
  <span class="book-scene" aria-hidden="true">
    <span class="book">
      <span class="book-page book-page--left" />
      <span class="book-page book-page--right" />
    </span>
  </span>
</template>

<style scoped>
/* 尺寸放大到 52px：26px 时试过三版（翻页 / 加书脊 / 开合）都读不出"书" ——
   太小了，放不下书的形。放大后才画得出书脊、页面透视和翻动的纵深。 */
.book-scene {
  display: inline-block;
  width: 52px;
  height: 34px;
  perspective: 180px;
  vertical-align: middle;
}

.book {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
}

.book-page {
  position: absolute;
  top: 0;
  width: 50%;
  height: 100%;
}

/* 左页：绕自己的右边缘（书脊）开合 */
.book-page--left {
  left: 0;
  background: #cbd5e1;
  border-radius: 4px 0 0 4px;
  transform-origin: right center;
  animation: book-open-left 2.6s ease-in-out infinite;
}

/* 右页：绕自己的左边缘开合；颜色深一档，合上时能看出"这是一本有封面的书" */
.book-page--right {
  left: 50%;
  background: #94a3b8;
  border-radius: 0 4px 4px 0;
  transform-origin: left center;
  animation: book-open-right 2.6s ease-in-out infinite;
}

/* ⚠️ 关键：角度**永远不回到 0°**。
   回到 0° 就是"合上"，而平视一本合着的书，画面上就是一个矩形 ——
   于是有一半时间读不出"书"。让它一直保持摊开的 V 形，只做开合幅度的呼吸，
   形状就始终是"一本打开的书"。 */
@keyframes book-open-left {
  0%,
  100% {
    transform: rotateY(-36deg);
  }
  50% {
    transform: rotateY(-62deg);
  }
}

@keyframes book-open-right {
  0%,
  100% {
    transform: rotateY(36deg);
  }
  50% {
    transform: rotateY(62deg);
  }
}

/* 系统开了「减少动态效果」→ 停在合上的样子，不翻 */
@media (prefers-reduced-motion: reduce) {
  .book-page--left,
  .book-page--right {
    animation: none;
  }
}
</style>
