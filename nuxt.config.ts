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
        { name: 'theme-color', content: '#f5f6f8' },
      ],
    },
  },

  runtimeConfig: {
    // ============================================================
    //  私有配置：只在服务端可见，绝不会打包进浏览器代码
    //  全部通过 .env 控制（.env 已被 .gitignore 排除，模板见 .env.example）
    // ============================================================

    // ---------- LLM 主调用：负责生成四段解释 ----------
    // 环境变量：NUXT_LLM_API_KEY / NUXT_LLM_BASE_URL / NUXT_LLM_MODEL
    llmApiKey: '',
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-chat',

    // ---------- Embedding：负责把文字变成向量，供知识库检索 ----------
    // 环境变量：NUXT_EMBEDDING_API_KEY / _BASE_URL / _MODEL / _DIMENSIONS
    //
    // ⚠️ 这两组配置是完全分开的，各用各家的服务：
    //    LLM       → DeepSeek（生成文字）
    //    Embedding → 智谱 GLM（生成向量）
    // 这是刻意的设计，不要互相顶替 —— 两家的向量空间不通用，
    // 拿错 key 去调只会得到 404 或维度错乱，不会"凑合能用"。
    embeddingApiKey: '',
    embeddingBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    embeddingModel: 'embedding-3',
    embeddingDimensions: 1024,

    // ---------- 知识库检索行为 ----------
    // ragMinScore 是实测校准出来的，不是拍脑袋定的：
    // 跑 `node --env-file=.env scripts/rag-probe.mjs` 可以看到
    // 「期望命中项」的最低分在 0.55 附近，取 0.50 留了一点余量。
    // 扩充语料后建议重跑一次探针重新校准。
    ragEnabled: true,
    ragTopK: 4,
    ragMinScore: 0.5,
  },
})
