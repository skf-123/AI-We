<script setup lang="ts">
/**
 * 一本摊开、书页翻动的小书。
 *
 * 用在「解析结果」面板等首字的那一两秒 —— 整条流程里唯一
 * 「真的在等、又没东西可看」的时段。
 *
 * ── 结构上分成两截 ──
 *
 *  上半截「书页」：用 CSS 3D 做（perspective + preserve-3d + rotateY）。
 *    两页摊开、中缝有书沟阴影，还有一张翻动中的书页（正反两面）。
 *
 *  下半截「厚度」：用 2D 画出来，**故意不放进 3D 上下文**——
 *    因为 clip-path 这类属性会把 preserve-3d 拍平。这一截负责
 *    把书"是一本有封面、有封底、有书脊的实物"这件事说清楚：
 *      ① 书口：一叠纸的侧边，用 repeating-linear-gradient 画成一排细线
 *      ② 封面/封底：底下那一条，两头略宽（近大远小），中间被书脊压出一个凹口
 *      ③ 书脊：中缝最下面那一小块，颜色最深，是整本书的最低点
 *
 * 没有这三样，画面上就只是"两片纸在翻"。
 *
 * ⚠️ 两个坑（都踩过）：
 *   · 父级出现 overflow / opacity<1 / filter / clip-path 这类"分组属性"，
 *     浏览器会把 preserve-3d 强制降级成 flat。
 *   · 所以翻页**不能用 opacity 淡入淡出**（那会拍平两个面、纸背就露不出来），
 *     只能让它翻过去再翻回来。
 */
</script>

<template>
  <!-- 纯装饰，对读屏器隐藏 -->
  <span class="bk" aria-hidden="true">
    <!-- 上半截：书页（3D） -->
    <span class="bk-book">
      <span class="bk-page bk-page--left" />
      <span class="bk-page bk-page--right" />

      <span class="bk-leaf">
        <span class="bk-leaf-face bk-leaf-face--front" />
        <span class="bk-leaf-face bk-leaf-face--back" />
      </span>
    </span>

    <!-- 下半截：厚度（2D，故意不放进 3D 上下文，见文件头注释） -->
    <span class="bk-thick">
      <span class="bk-edges" />
      <span class="bk-cover" />
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
  height: 58px;
  perspective: 260px;
  perspective-origin: 50% 28%;
  vertical-align: middle;
}

/* ═══════════ 上半截：书页 ═══════════ */

.bk-book {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 40px;
  transform: rotateX(22deg);
  transform-style: preserve-3d;
}

/* 靠近中缝（书沟）处压暗，是"页面凹进去"这个立体感的全部来源 */
.bk-page {
  position: absolute;
  top: 0;
  width: 50%;
  height: 100%;
}

.bk-page--left {
  left: 0;
  border-radius: 5px 0 0 5px;
  background: linear-gradient(to right, #e8edf4 0%, #d9e1ec 70%, #b9c7d8 100%);
}

.bk-page--right {
  left: 50%;
  border-radius: 0 5px 5px 0;
  background: linear-gradient(to left, #e8edf4 0%, #d9e1ec 70%, #b9c7d8 100%);
}

/* 翻动页：两个面各贴一张纸，背面转 180° 挡住后脑勺 —— 翻过去才看得到纸背 */
.bk-leaf {
  position: absolute;
  left: 50%;
  top: 0;
  width: 50%;
  height: 100%;
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
  box-shadow: 0 2px 5px rgba(71, 85, 105, 0.22);
}

.bk-leaf-face--front {
  border-radius: 0 5px 5px 0;
  background: linear-gradient(to left, #ffffff 0%, #eef2f7 70%, #d5dde8 100%);
}

.bk-leaf-face--back {
  border-radius: 5px 0 0 5px;
  background: linear-gradient(to right, #ffffff 0%, #eef2f7 70%, #d5dde8 100%);
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

/* ═══════════ 下半截：厚度 ═══════════ */

.bk-thick {
  position: absolute;
  left: 2px;
  right: 2px;
  bottom: 7px;
  height: 15px;
}

/* ① 书口：一叠纸的侧边。用重复渐变画成一排细线 —— 这几根线就是"很多页" */
.bk-edges {
  position: absolute;
  left: 3px;
  right: 3px;
  top: 0;
  height: 6px;
  background: repeating-linear-gradient(to bottom, #f4f7fb 0 1px, #dbe3ec 1px 2px);
  border-radius: 0 0 2px 2px;
}

/* ② 封面 / 封底：底下这一条，两头略宽（近大远小），
      中间被书脊压出一个凹口 —— 凹口用 clip-path 挖出来 */
.bk-cover {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 10px;
  background: linear-gradient(to bottom, #a8b6c8 0%, #8c9db3 100%);
  clip-path: polygon(0 0, 42% 0, 50% 32%, 58% 0, 100% 0, 100% 100%, 0 100%);
  /* 圆角只留一点点 —— 给太多会变成药丸，不像书的硬壳边 */
  border-radius: 0 0 2px 2px;
}

/* ③ 书脊：中缝最下面那一小块，颜色最深 —— 它是整本书的最低点，
      也是"封面和封底是在这里连起来"的视觉交代 */
.bk-spine {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 7px;
  height: 13px;
  transform: translateX(-50%);
  background: linear-gradient(to bottom, #93a3b8 0%, #7c8ea5 100%);
  border-radius: 0 0 2px 2px;
}

/* 地面投影：把书"放"在桌面上，不是浮在空中 */
.bk-ground {
  position: absolute;
  left: 4%;
  right: 4%;
  bottom: -1px;
  height: 7px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    rgba(100, 116, 139, 0.32),
    rgba(100, 116, 139, 0) 70%
  );
}

/* 系统开了「减少动态效果」→ 停在摊开的样子，不翻 */
@media (prefers-reduced-motion: reduce) {
  .bk-leaf {
    animation: none;
    transform: rotateY(-36deg);
  }
}
</style>
