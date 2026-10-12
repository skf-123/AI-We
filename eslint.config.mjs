// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import prettier from 'eslint-config-prettier/flat'

/**
 * ESLint 配置，分三层：
 *
 *   1. withNuxt() —— @nuxt/eslint 生成的基线。它认得 Nuxt 的自动导入
 *      （ref / computed / defineProps / defineNuxtConfig…），
 *      否则这些会被 ESLint 报成"未定义"，满屏噪音。
 *   2. 项目自己的忽略项。
 *   3. prettier —— 必须放最后，它负责关掉所有与 Prettier 打架的格式规则。
 *
 * 代码风格以 .prettierrc 为准（无分号 / 单引号 / 100 列）。
 */
export default withNuxt(
  {
    name: 'wheatbend/ignores',
    ignores: [
      // 语料与预计算的向量：是数据，不是代码
      'server/rag/corpus.json',
      'server/rag/corpus.embeddings.json',
    ],
  },
  prettier,
)
