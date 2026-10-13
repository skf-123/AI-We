<script setup lang="ts">
/**
 * 一本摊开、页面上正在"逐行写字"的小书。
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
 * 书页上那几道短线**一行一行长出来**，然后整页翻过去、重新写 ——
 * 和产品在做的事（把解释一段段生成出来）是同一件事。
 *
 * ⚠️ 两个坑（都踩过）：
 *   · 封面一开始画错了方向：书脊被画成"封面中间陷进去的凹口"，而真实的
 *     书脊是**向下凸出来**的一小块；封面也必须**包住左右两侧**，
 *     否则「正/反封面」根本不存在。
 *   · 父级出现 overflow / opacity<1 / filter / clip-path 这类"分组属性"，
 *     会把 preserve-3d 强制降级成 flat。所以这一版不用 clip-path，
 *     翻页也不能用 opacity 淡入淡出。
 */
</script>

<template>
  <!-- 纯装饰，对读屏器隐藏 -->
  <span class="bk" aria-hidden="true">
    <span class="bk-book">
      <!-- 封面 / 封底：整本的底子，比里面的书页大一圈 -->
      <span class="bk-cover" />

      <!-- 书口：书页那一叠的侧边，一排细线 -->
      <span class="bk-edges" />

      <!-- 摊开的两页 -->
      <span class="bk-page bk-page--left">
        <span class="bk-line" />
        <span class="bk-line" />
        <span class="bk-line" />
      </span>
      <span class="bk-page bk-page--right" />

      <!-- 翻动中的那一页：正反两面各自带字 -->
      <span class="bk-leaf">
        <span class="bk-leaf-face bk-leaf-face--front">
          <span class="bk-line" />
          <span class="bk-line" />
          <span class="bk-line" />
        </span>
        <span class="bk-leaf-face bk-leaf-face--back">
          <span class="bk-line" />
          <span class="bk-line" />
          <span class="bk-line" />
        </span>
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
  width: 84px;
  height: 76px;
  perspective: 370px;
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
   那两条竖边就是「正封面」和「封底」。 */
.bk-cover {
  position: absolute;
  left: 0;
  right: 0;
  top: 1px;
  bottom: -4px;
  border-radius: 6px;
  background: linear-gradient(to bottom, #7c92ad 0%, #55698a 100%);
  /* 顶边一道高光 —— 硬壳书那块板子的受光边。没有它，封面看着是块平色块 */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42);
}

/* ═══════ ② 书口 ═══════
   书页那一叠的侧边。重复渐变画成一排细线 —— 那几根线就是"很多页"。 */
.bk-edges {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 4px;
  height: 12px;
  border-radius: 0 0 2px 2px;
  background: repeating-linear-gradient(to bottom, #feffff 0 1px, #e2eaf4 1px 2px);
}

/* ═══════ ③ 摊开的两页 ═══════
   左右各缩进 4px（让封面露出来），底部留出书口那一截。
   靠近中缝处压暗 —— 这是"页面凹进去"这个立体感的全部来源。 */
.bk-page {
  position: absolute;
  top: 4px;
  bottom: 15px;
}

.bk-page--left {
  left: 4px;
  width: calc(50% - 4px);
  border-radius: 4px 0 0 3px;
  background: linear-gradient(to right, #ffffff 0%, #edf3f9 62%, #b9c8db 100%);
}

.bk-page--right {
  right: 4px;
  width: calc(50% - 4px);
  border-radius: 0 4px 3px 0;
  background: linear-gradient(to left, #ffffff 0%, #edf3f9 62%, #b9c8db 100%);
}

/* ═══════ ④ 页面上的"字" ═══════
   三道短线，一行一行从左往右"长"出来 —— 演的正是内容被写出来的过程。
   用 scaleX 而不是改 width：只动 transform，不触发布局。 */
.bk-line {
  position: absolute;
  left: 12%;
  height: 2px;
  border-radius: 1px;
  background: #93a6bd;
  transform-origin: left center;
  animation: bk-write 3.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.bk-line:nth-child(1) {
  top: 22%;
  width: 60%;
  animation-delay: 0s;
}
.bk-line:nth-child(2) {
  top: 40%;
  width: 74%;
  animation-delay: 0.17s;
}
.bk-line:nth-child(3) {
  top: 58%;
  width: 46%;
  animation-delay: 0.34s;
}

@keyframes bk-write {
  0%,
  4% {
    transform: scaleX(0);
  }
  30% {
    transform: scaleX(1);
  }
  76% {
    transform: scaleX(1);
  }
  88%,
  100% {
    transform: scaleX(0);
  }
}

/* ═══════ ⑤ 翻动中的那一页 ═══════
   两个面各贴一张纸，背面转 180° 挡住后脑勺 —— 翻过去才看得到纸背。
   周期和写字一样是 3.8 秒，两件事才像在讲同一个故事：写满 → 翻页 → 再写。 */
.bk-leaf {
  position: absolute;
  left: 50%;
  right: 4px;
  top: 4px;
  bottom: 15px;
  transform-style: preserve-3d;
  transform-origin: left center;
  animation: bk-turn 3.8s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}

.bk-leaf-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  /* 比静止页亮 + 一道投影：否则两边都是近白色，翻起来看不出哪一页在动 */
  box-shadow: 0 2px 6px rgba(71, 85, 105, 0.18);
}

.bk-leaf-face--front {
  border-radius: 0 4px 3px 0;
  background: linear-gradient(to left, #ffffff 0%, #f4f8fc 68%, #ccd8e6 100%);
}

.bk-leaf-face--back {
  border-radius: 4px 0 0 3px;
  background: linear-gradient(to right, #ffffff 0%, #f4f8fc 68%, #ccd8e6 100%);
  transform: rotateY(180deg);
}

@keyframes bk-turn {
  0%,
  62% {
    transform: rotateY(0deg);
  }
  78%,
  88% {
    transform: rotateY(-180deg);
  }
  98%,
  100% {
    transform: rotateY(0deg);
  }
}

/* ═══════ ⑥ 书脊 ═══════
   中缝最下面、**向下凸出**的那一小块。方向不能反。 */
.bk-spine {
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 14px;
  height: 11px;
  transform: translateX(-50%);
  border-radius: 0 0 6px 6px;
  background: linear-gradient(to bottom, #6b809e 0%, #4d6183 100%);
}

/* 地面投影：把书"放"在桌面上，不是浮在空中 */
.bk-ground {
  position: absolute;
  left: 5%;
  right: 5%;
  bottom: 0;
  height: 10px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(51, 65, 85, 0.34), rgba(51, 65, 85, 0) 70%);
}

/* 系统开了「减少动态效果」→ 停在写满、摊开的样子 */
@media (prefers-reduced-motion: reduce) {
  .bk-leaf {
    animation: none;
    transform: rotateY(-34deg);
  }
  .bk-line {
    animation: none;
    transform: scaleX(1);
  }
}
</style>
