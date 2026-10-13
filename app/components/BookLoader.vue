<script setup lang="ts">
/**
 * 一本摊开、书页翻动的小书。
 *
 * 用在「解析结果」面板等首字的那一两秒 —— 整条流程里唯一
 * 「真的在等、又没东西可看」的时段。
 *
 * ── 摊开的书，从下往上看是什么样 ──
 *
 *      ┌──┐                  ┌──┐
 *      │▓▓│  两页上表面        │▓▓│   ← 封面在左右露出的那两条竖边
 *      │▓▓│                  │▓▓│      就是「正封面 / 封底」
 *      │▓▓├──────────────────┤▓▓│
 *      │▓▓│  书口（一叠纸侧边） │▓▓│   ← 一排细线 = 很多页
 *      ├──┴──────────────────┴──┤
 *      │      封面底边（连续）     │
 *      └───────────┬───────────┘
 *                  ▓▓                 ← 书脊「凸出去」，不是凹进去
 *
 * ⚠️ 这里踩过一个坑，记下来：最早我在封面中间用 clip-path 挖了个 V 形凹口
 *    当作书脊 —— **方向反了**。真实的书脊是往下凸出来的一小块，
 *    封面本身是连续的。而且封面必须包住左右两侧，否则「正/反封面」就没了。
 *
 * ⚠️ 另一个坑：父级出现 overflow / opacity<1 / filter / clip-path 这类
 *    "分组属性"，会把 preserve-3d 强制降级成 flat。所以这一版**不用 clip-path**，
 *    全靠"大一圈的底 + 内缩的正方形"叠出来。翻页也不能用 opacity 淡入淡出。
 */
</script>

<template>
  <!-- 纯装饰，对读屏器隐藏 -->
  <span class="bk" aria-hidden="true">
    <span class="bk-book">
      <!-- 封面 / 封底：整本的底子。比里面的书页大一圈，露出来的那圈就是它 -->
      <span class="bk-cover" />

      <!-- 书口：书页那一叠的侧边，一排细线 -->
      <span class="bk-edges" />

      <!-- 摊开的两页 -->
      <span class="bk-page bk-page--left" />
      <span class="bk-page bk-page--right" />

      <!-- 翻动中的那一页 -->
      <span class="bk-leaf">
        <span class="bk-leaf-face bk-leaf-face--front" />
        <span class="bk-leaf-face bk-leaf-face--back" />
      </span>

      <!-- 书脊：中缝向下凸出的小圆头 -->
      <span class="bk-spine" />
    </span>

    <span class="bk-ground" />
  </span>
</template>

<style scoped>
.bk {
  position: relative;
  display: inline-block;
  width: 68px;
  height: 62px;
  perspective: 300px;
  perspective-origin: 50% 26%;
  vertical-align: middle;
}

/* 整本书的 3D 上下文：稍微俯视，露出"摊在桌上"的透视 */
.bk-book {
  position: absolute;
  inset: 0;
  transform: rotateX(20deg);
  transform-style: preserve-3d;
}

/* ═══════ ① 封面 / 封底 ═══════
   整本的底子。书页在内侧缩进，所以它的左右两侧会露出来 ——
   那两条竖边就是「正封面」和「封底」。底部也让它多出一点，形成书的厚度。 */
.bk-cover {
  position: absolute;
  left: 0;
  right: 0;
  top: 1px;
  bottom: -3px;
  border-radius: 5px;
  background: linear-gradient(to bottom, #b6c3d3 0%, #92a4ba 100%);
}

/* ═══════ ② 书口 ═══════
   书页那一叠的侧边。用重复渐变画成一排细线 —— 那几根线就是"很多页"。
   只在底部露出（上面被两页盖住）。 */
.bk-edges {
  position: absolute;
  left: 3px;
  right: 3px;
  bottom: 3px;
  height: 10px;
  border-radius: 0 0 2px 2px;
  background: repeating-linear-gradient(to bottom, #f7fafc 0 1px, #dfe6ef 1px 2px);
}

/* ═══════ ③ 摊开的两页 ═══════
   左右各缩进 6px（让封面露出来），底部留出书口那一截。
   靠近中缝处压暗 —— 这是"页面凹进去"这个立体感的全部来源。 */
.bk-page {
  position: absolute;
  top: 3px;
  bottom: 12px;
}

.bk-page--left {
  left: 3px;
  width: calc(50% - 3px);
  border-radius: 3px 0 0 2px;
  background: linear-gradient(to right, #f1f5fa 0%, #e0e8f2 68%, #bccadb 100%);
}

.bk-page--right {
  right: 3px;
  width: calc(50% - 3px);
  border-radius: 0 3px 2px 0;
  background: linear-gradient(to left, #f1f5fa 0%, #e0e8f2 68%, #bccadb 100%);
}

/* ═══════ ④ 翻动中的那一页 ═══════
   两个面各贴一张纸，背面转 180° 挡住后脑勺 —— 翻过去才看得到纸背。 */
.bk-leaf {
  position: absolute;
  left: 50%;
  right: 3px;
  top: 3px;
  bottom: 12px;
  transform-style: preserve-3d;
  transform-origin: left center;
  /* 1.9 秒一个来回 —— 这本书的可见窗口只有「等首字」那一秒多 */
  animation: bk-turn 1.9s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}

.bk-leaf-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  /* 比静止页亮 + 一道投影：否则两边都是近白色，翻起来看不出哪一页在动 */
  box-shadow: 0 2px 5px rgba(71, 85, 105, 0.2);
}

.bk-leaf-face--front {
  border-radius: 0 4px 3px 0;
  background: linear-gradient(to left, #ffffff 0%, #eef3f9 70%, #d8e0ea 100%);
}

.bk-leaf-face--back {
  border-radius: 4px 0 0 3px;
  background: linear-gradient(to right, #ffffff 0%, #eef3f9 70%, #d8e0ea 100%);
  transform: rotateY(180deg);
}

@keyframes bk-turn {
  0%,
  6% {
    transform: rotateY(0deg);
  }
  50%,
  64% {
    transform: rotateY(-180deg);
  }
  96%,
  100% {
    transform: rotateY(0deg);
  }
}

/* ═══════ ⑤ 书脊 ═══════
   中缝最下面、**向下凸出**的那一小块。颜色比封面深一档。
   注意方向：是凸出来，不是陷进去。 */
.bk-spine {
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 11px;
  height: 9px;
  transform: translateX(-50%);
  border-radius: 0 0 5px 5px;
  background: linear-gradient(to bottom, #94a6bd 0%, #7b8fa8 100%);
}

/* 地面投影：把书"放"在桌面上，不是浮在空中 */
.bk-ground {
  position: absolute;
  left: 5%;
  right: 5%;
  bottom: 0;
  height: 8px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    rgba(100, 116, 139, 0.3),
    rgba(100, 116, 139, 0) 70%
  );
}

/* 系统开了「减少动态效果」→ 停在摊开的样子，不翻 */
@media (prefers-reduced-motion: reduce) {
  .bk-leaf {
    animation: none;
    transform: rotateY(-34deg);
  }
}
</style>
