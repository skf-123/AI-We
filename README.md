# 麦穗 · 代码理解助手（WheatBend）

> 贴一段代码，**不用写任何提示词**，自动输出：逐词逐句 → 局部关系与作用 → 整段整体作用 → 技术溯源。

传智杯 · AI Web 网页开发挑战赛 参赛作品。

---

## 当前进度

本项目按 **M0 → M6** 分批推进，每一步都是"能独立演示"的完整功能。
当前处于 **M0（最小可执行版本）**。

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M0** | 贴代码 → 流式输出四段解析 | ✅ 已完成 |
| **M1** | 知识框架图（Vue Flow 渲染） | ✅ 已完成 |
| **M2** | **知识库（RAG）：自有语料 + 向量检索 + 引用来源** | ✅ 已完成 |
| M3 | 交互打磨：错误兜底、手机适配 | ⬜ 未开始 |
| M4 | 伪视频播放器 | ⬜ 未开始 |
| M5 | Agent 思考链面板 | ⬜ 未开始 |
| M6 | 代码截图上传 → 识别 → 解析 | ⬜ 未开始 |

### 知识库（M2）

这是项目"不只是调 API"的关键部分。

```
用户代码 → 判断语言 → 检索我们自己的语料库 → 找到相关资料
                                                    ↓
                          大模型照着资料回答，并在句中标注 [1][2]
                                                    ↓
                          前端显示"引用来源卡片"，可点击查证原文
```

| | |
|---|---|
| **语料** | `server/rag/corpus.json` —— 人工整理的技术资料，每条带出处链接 |
| **向量** | `server/rag/corpus.embeddings.json` —— 离线预计算，**必须提交进 git** |
| **embedding 服务** | 智谱 `embedding-3`（1024 维），与生成回答的 DeepSeek 完全分开 |
| **检索** | 内存暴力算余弦，不装向量数据库（语料只有几十条） |
| **引用编号** | 服务端生成，通过响应头 `X-Rag-Sources` 传给前端，与正文 `[n]` 一一对应 |

**改了语料之后必须重跑：**

```bash
npm run rag:build      # 重新生成向量
```

否则新语料不会有向量（程序会检测到并跳过它们，不会给出错误答案）。

**校准检索阈值：**

```bash
node --env-file=.env scripts/rag-probe.mjs
```

**优雅降级**：检索不到 / embedding 服务挂了 / 语料缺失 / 遇到未收录的语言（如 C++）
→ 自动退回纯模型回答，不报错、不白屏。

---

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | **Nuxt 4**（Vue 3） | 前后端一体，服务端路由直接当后端用，不用单独买服务器 |
| 语言 | TypeScript | |
| 样式 | Tailwind CSS 4 | |
| 数据校验 | Zod | 校验请求参数，后续用于校验 AI 的结构化输出 |
| 大模型 | 智谱 GLM（`glm-5.3-flash`） | 生成解释文字；走 OpenAI 兼容接口，换 provider 只改 `.env` |
| 部署 | Vercel | 免费、不用备案、推送即上线 |

> **为什么不做单独的 Python 后端？**
> 大赛文档明确鼓励"充分利用现代前端框架的全栈能力（如 API Routes）简化后端逻辑"。
> Nuxt 的 `server/` 目录本身就是后端，少维护一套服务、少买一台服务器、少一次备案。

---

## 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 配置密钥：复制模板，填入自己的 DeepSeek key
cp .env.example .env
#    然后编辑 .env，把 NUXT_DEEPSEEK_API_KEY 填上

# 3. 启动开发服务器
npm run dev
#    打开 http://localhost:3000
```

---

## 目录结构

```
AI-Web/
├── app/
│   ├── app.vue                    # 应用外壳
│   ├── assets/css/main.css        # 全局样式（引入 Tailwind）
│   ├── components/
│   │   ├── GraphView.vue          # 知识框架图（Vue Flow + dagre）
│   │   └── SourceList.vue         # 引用来源卡片
│   └── pages/index.vue            # 主页面：输入框 + 流式输出 + 图 + 引用
├── server/
│   ├── api/analyze.post.ts        # POST /api/analyze —— 检索 + 调模型 + 流转发
│   ├── utils/prompt.ts            # 提示词（本项目的核心资产）
│   └── rag/                       # ★ 知识库
│       ├── corpus.json            #   人工整理的语料（改这个）
│       ├── corpus.embeddings.json #   预计算向量（脚本生成，要提交）
│       ├── types.ts
│       ├── corpus.ts              #   加载 + 校验 + 缓存
│       ├── embed.ts               #   调智谱 embedding
│       └── retrieve.ts            #   语言过滤 + 余弦 + top-k
├── scripts/
│   ├── build-embeddings.mjs       # npm run rag:build
│   └── rag-probe.mjs              # 检索阈值校准探针
├── nuxt.config.ts
├── .env.example                   # 环境变量模板（可提交）
└── .env                           # 真实密钥（已被 .gitignore 排除）
```

---

## ⚠️ 提交前检查清单

- [ ] 仓库里搜不到 `sk-`（确认没有任何密钥被提交）
- [ ] `.env` 没有被提交，`.env.example` 已提交
- [ ] README、环境配置说明完整
- [ ] Git 提交历史是逐步积累的，不是一次性推上去的

---

## 团队

麦穗团队（WheatBend）
