<script setup lang="ts">
/**
 * 一本摊开、书页来回翻动的小书。
 *
 * 用在「解析结果」面板等首字的那一两秒 —— 整条流程里唯一
 * 「真的在等、又没东西可看」的时段。
 *
 * ── 为什么这版才像书 ──
 * 前四版都丑，根因是我只画了「两块斜矩形」，一本书该有的东西一个都没有。
 * 这一版把书的特征补齐了：
 *   ① 书沟阴影 —— 两页靠近中缝处用渐变压暗，页面才有"凹进去"的立体感
 *   ② 正反两面的书页 —— 翻过去能看到纸背（backface-visibility + 两个面）
 *   ③ 俯视 22° —— 露出"摊在桌上"的透视，而不是正面一块牌子
 *   ④ 地面投影 —— 书底下一条模糊的椭圆影，把它"放"在桌面上
 *
 * 纯 CSS 3D，零依赖、零许可问题。
 *
 * ⚠️ 两个坑（都踩过）：
 *   · 父级出现 overflow / opacity<1 / filter / clip-path 这类"分组属性"，
 *     浏览器会把 preserve-3d 强制降级成 flat —— 所以这一块外面不能套这类样式。
 *   · 所以翻页**不能用 opacity 淡入淡出**（那会让两面被拍平、纸背就露不出来），
 *     只能让它翻过去再翻回来。
 */
</script>

<template>
  <!-- 纯装饰，对读屏器隐藏 -->
  <span class="bk" aria-hidden="true">
    <span class="bk-book">
      <span class="bk-page bk-page--left" />
      <span class="bk-page bk-page--right" />
      <span class="bk-leaf">
        <span class="bk-leaf-face bk-leaf-face--front" />
        <span class="bk-leaf-face bk-leaf-face--back" />
      </span>
    </span>
    <span class="bk-ground" />
  </span>
</template>

<style scoped>
.bk {
  display: inline-block;
  position: relative;
  width: 64px;
  height: 46px;
  perspective: 260px;
  perspective-origin: 50% 35%;
  vertical-align: middle;
}

.bk-book {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  transform: rotateX(22deg);
  transform-style: preserve-3d;
}

/* ---------- 摊开的两页 ----------
   靠近中缝（书沟）处压暗，是"页面凹进去"这个立体感的全部来源。 */
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

/* ---------- 翻动的那一页 ----------
   两个面各自贴一张"纸"，背面转到 180° 挡住后脑勺 —— 翻过去才看得到纸背。 */
.bk-leaf {
  position: absolute;
  left: 50%;
  top: 0;
  width: 50%;
  height: 100%;
  transform-style: preserve-3d;
  transform-origin: left center;
  /* 1.9 秒一个来回 —— 因为这本书的可见窗口只有「等首字」那一秒多，
     周期太长的话用户根本看不到一页翻完。 */
  animation: bk-turn 1.9s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}

.bk-leaf-face {
  position: absolute;
  inset: 0;
  backface-visibility: hidden;
  /* 翻动页比静止页亮，再加一道投影 —— 否则两边都是近白色，
     翻起来根本看不出哪一页在动 */
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

/* 翻过去、停一下、翻回来。不能淡入淡出 —— 见文件头注释。 */
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

/* 地面投影：把书"放"在桌面上，不是浮在空中 */
.bk-ground {
  position: absolute;
  left: 6%;
  right: 6%;
  bottom: -2px;
  height: 6px;
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
