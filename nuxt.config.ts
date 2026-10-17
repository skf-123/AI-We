import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  // 代码规范：@nuxt/eslint 会在 `nuxt prepare` 时生成 .nuxt/eslint.config.mjs，
  // 我们的 eslint.config.mjs 以它为基线（否则 Nuxt 自动导入的 ref/defineProps 会被报成未定义）
  modules: ['@nuxt/eslint'],

  vite: {
    plugins: [tailwindcss()],
    // 这些依赖在项目页第一次渲染时才会被用到；不预打包的话，Vite 会在
    // 运行中现发现、然后整页刷新一次，正在上传/解析的页面会被冲掉。
    optimizeDeps: {
      include: [
        '@vue-flow/background',
        '@vue-flow/controls',
        '@vue-flow/core',
        'dagre',
        'markdown-it',
      ],
    },
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
    // 「期望命中项」的最低分在 0.42 附近（SQL 那几条最低，因为 SQL 语句
    // 短、关键词密集，和散文式的语料天然距离远），取 0.38 留了余量。
    //
    // 取值原则：宁可多出一条不相关的卡片（模型会自己判断不引用它），
    // 也不要让该出现的资料被阈值挡掉 —— 后者在演示时看起来像功能坏了。
    // 语料规模变了就重跑一次探针重新校准。
    ragEnabled: true,
    ragTopK: 4,
    ragMinScore: 0.38,

    // ---------- 追问（/api/ask）带多少历史 ----------
    // 模型没有记忆，每问一次都要把之前的对话重新发一遍。一直问下去不能无限带，
    // 所以按**长度**给一个预算（不是按条数 —— 为什么不用条数、这个数怎么定的，
    // 见 docs/追问上下文预算说明.md，那里有实测数据）。
    //
    // 换算是 ÷0.6（见 server/utils/history.ts），10 万 token ≈ 16.6 万字符 ≈ 470 轮典型问答。
    // 要调就只动这一个数，不用改代码：环境变量 NUXT_ASK_HISTORY_TOKENS 可覆盖。
    askHistoryTokens: 100000,
  },
})
