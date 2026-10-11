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
    // 对应的环境变量：NUXT_LLM_API_KEY / NUXT_LLM_BASE_URL / NUXT_LLM_MODEL
    //
    // 用通用的 llm* 命名而不是绑定某一家，是为了换 provider 时
    // 只需要改 .env 里的三行，代码一行都不用动。
    // 这几项都是"OpenAI 兼容接口"的通用参数，DeepSeek / 智谱 GLM / Kimi 等都能套用。
    llmApiKey: '',
    llmBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    llmModel: 'glm-5.3-flash',
  },
})
