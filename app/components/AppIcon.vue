<script setup lang="ts">
/**
 * 首页和说明卡共用的线性图标。
 *
 * 只用内联 SVG：不引图标库，不加载外部字体或图片，首屏不增加请求。
 * 颜色跟 currentColor 走，尺寸由调用方用 class 控制。
 */
type IconName =
  'code' | 'project' | 'book' | 'graph' | 'shield' | 'info' | 'upload' | 'chat' | 'list' | 'layers'

defineProps<{ name: IconName }>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'code'">
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m13.5 5-3 14" />
    </template>
    <template v-else-if="name === 'project'">
      <rect x="3" y="4" width="7" height="7" rx="1.5" />
      <rect x="14" y="13" width="7" height="7" rx="1.5" />
      <path d="M10 7.5h4.5A2.5 2.5 0 0 1 17 10v3" />
    </template>
    <template v-else-if="name === 'book'">
      <path
        d="M12 6.5C10.5 5.2 8.5 4.5 6 4.5H4v13h2c2.5 0 4.5.7 6 2 1.5-1.3 3.5-2 6-2h2v-13h-2c-2.5 0-4.5.7-6 2Z"
      />
      <path d="M12 6.5v13" />
    </template>
    <template v-else-if="name === 'graph'">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.2 7.2 10.5 16" />
      <path d="M16.2 8.7 13.6 16" />
      <path d="M8.5 6.2h7" />
    </template>
    <template v-else-if="name === 'shield'">
      <path d="M12 3 5 6v5c0 4.5 3 7.5 7 10 4-2.5 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </template>
    <template v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </template>
    <template v-else-if="name === 'list'">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </template>
    <template v-else-if="name === 'layers'">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </template>
    <template v-else-if="name === 'chat'">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3v-3H6.5A2.5 2.5 0 0 1 4 13.5v-8Z"
      />
      <path d="M8 8h8M8 11h5" />
    </template>
    <template v-else-if="name === 'upload'">
      <path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
      <path d="M12 3v11" />
      <path d="m8 7 4-4 4 4" />
    </template>
  </svg>
</template>
