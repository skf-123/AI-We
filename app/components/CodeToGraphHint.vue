<script setup lang="ts">
/**
 * 空态的那张小动画：「一段代码 → 一张知识框架图」。
 *
 * 放在「解析结果」面板还没开始解析时的空状态里。它干的不是"转圈等加载"
 * （那时候系统什么都没做，转圈是在撒谎），而是**把产品的核心动作演一遍**：
 * 贴代码 → 出框架图。所以它既是装饰，也是产品说明。
 *
 * 三段循环：代码块亮起 → 连线生长 → 三个节点依次亮起 → 整体回落。
 * 全部是手写 SVG + CSS 关键帧：零依赖、零许可问题、颜色随主题。
 *
 * 节点三种颜色直接沿用知识框架图的图例（代码=绿 / 技术=蓝 / 概念=橙），
 * 让用户在看图之前就先熟悉这套配色。
 */
</script>

<template>
  <!-- 纯装饰，对读屏器隐藏（旁边的引导文字才是内容） -->
  <svg class="ctg" viewBox="0 0 126 48" fill="none" aria-hidden="true">
    <!-- 左：一小段代码 -->
    <g class="ctg-code">
      <rect x="1" y="12" width="42" height="24" rx="5" />
      <line x1="9" y1="19" x2="28" y2="19" />
      <line x1="9" y1="24" x2="36" y2="24" />
      <line x1="9" y1="29" x2="23" y2="29" />
    </g>

    <!-- 中：连过去的线（用 pathLength 归一化，方便一格一格"长"出来） -->
    <line class="ctg-link" pathLength="1" x1="50" y1="24" x2="74" y2="24" />

    <!-- 右：迷你知识框架图 -->
    <g class="ctg-graph">
      <line class="ctg-edge ctg-edge-1" pathLength="1" x1="80" y1="15" x2="110" y2="24" />
      <line class="ctg-edge ctg-edge-2" pathLength="1" x1="80" y1="33" x2="110" y2="24" />
      <circle class="ctg-node ctg-node-1" cx="80" cy="15" r="4.5" />
      <circle class="ctg-node ctg-node-2" cx="80" cy="33" r="4.5" />
      <circle class="ctg-node ctg-node-3" cx="110" cy="24" r="4.5" />
    </g>
  </svg>
</template>

<style scoped>
/* 尺寸由组件自己定死：这是这幅画的固有比例，不该由容器决定。
   （早先写成 width:100%，结果被撑满整个面板、大得吓人。） */
.ctg {
  display: block;
  width: 180px;
  max-width: 100%;
  height: auto;
}

/* ---------- 静止状态 ----------
   这也是「系统开了减少动态效果」时看到的样子：
   全部画完、静静摆着。所以基础样式就写成"完成态"，
   动画只负责在它上面做明暗起伏。 */
.ctg-code rect {
  fill: none;
  stroke: #cbd5e1;
  stroke-width: 1.5;
}
.ctg-code line {
  stroke: #94a3b8;
  stroke-width: 1.5;
  stroke-linecap: round;
}
.ctg-link,
.ctg-edge {
  stroke: #cbd5e1;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
}
/* 三种颜色 = 知识框架图的图例：代码 / 技术 / 概念 */
.ctg-node-1 {
  fill: #10b981;
}
.ctg-node-2 {
  fill: #3b82f6;
}
.ctg-node-3 {
  fill: #f59e0b;
}

/* ---------- 循环动画 ----------
   从左到右依次点亮：代码块 → 连线 → 节点。
   `backwards` 是必需的：没有它，延迟期间元素会先按基础样式全亮一下再跳暗。 */
.ctg-code,
.ctg-node {
  animation: ctg-breathe 3.6s ease-in-out infinite backwards;
}
.ctg-link,
.ctg-edge {
  animation: ctg-draw 3.6s ease-in-out infinite backwards;
}

.ctg-code {
  animation-delay: 0s;
}
.ctg-link {
  animation-delay: 0.45s;
}
.ctg-edge-1,
.ctg-node-1 {
  animation-delay: 0.9s;
}
.ctg-edge-2,
.ctg-node-2 {
  animation-delay: 1.05s;
}
.ctg-node-3 {
  animation-delay: 1.2s;
}

/* 明暗起伏 */
@keyframes ctg-breathe {
  0% {
    opacity: 0.18;
  }
  14% {
    opacity: 1;
  }
  60% {
    opacity: 1;
  }
  80% {
    opacity: 0.18;
  }
  100% {
    opacity: 0.18;
  }
}

/* 线条"长"出来：先亮起，再把 dashoffset 收回去 */
@keyframes ctg-draw {
  0% {
    opacity: 0.18;
    stroke-dashoffset: 1;
  }
  8% {
    opacity: 1;
    stroke-dashoffset: 1;
  }
  30% {
    opacity: 1;
    stroke-dashoffset: 0;
  }
  60% {
    opacity: 1;
    stroke-dashoffset: 0;
  }
  80% {
    opacity: 0.18;
    stroke-dashoffset: 0;
  }
  100% {
    opacity: 0.18;
    stroke-dashoffset: 0;
  }
}

/* 系统开了「减少动态效果」→ 全部静止在完成态 */
@media (prefers-reduced-motion: reduce) {
  .ctg-code,
  .ctg-node,
  .ctg-link,
  .ctg-edge {
    animation: none;
  }
}
</style>
