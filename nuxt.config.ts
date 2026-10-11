import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  app: {
    head: {
      title: '麦穗 · 代码理解助手',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { name: 'description', content: '零提示词的代码理解助手：粘贴代码，自动解释' },
      ],
    },
  },

  runtimeConfig: {
    // 私有配置：只在服务端可见，绝不会打包进浏览器代码
    // 对应的环境变量：NUXT_DEEPSEEK_API_KEY / NUXT_DEEPSEEK_BASE_URL / NUXT_DEEPSEEK_MODEL
    deepseekApiKey: '',
    deepseekBaseUrl: 'https://api.deepseek.com',
    deepseekModel: 'deepseek-flash',
  },
})
