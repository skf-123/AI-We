import { resolveLlmConfig } from '../../utils/llm-config'

/**
 * 设置弹窗需要的公开信息：用哪家、哪个模型、服务端有没有配默认 key。
 * 永远不返回 key 本身。
 */
export default defineEventHandler((event) => {
  const llm = resolveLlmConfig(event)

  return {
    provider: 'DeepSeek',
    model: llm.model,
    visionModel: llm.visionModel,
    defaultKeyConfigured: Boolean(llm.apiKey),
    usingOwnKey: llm.usingOwnKey,
  }
})
