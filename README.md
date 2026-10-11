# 麦穗 · 代码理解助手（WheatBend）

> 贴一段代码，**不用写任何提示词**，自动输出：逐词逐句 → 局部关系与作用 → 整段整体作用 → 技术溯源 → 知识框架图。

传智杯 · AI Web 网页开发挑战赛 参赛作品。

---

## 当前进度

项目按 **M0 → M6** 分批推进，每一步都是"能独立演示"的完整功能。

**已完成 M0 / M1 / M2。**

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M0** | 贴代码 → 流式输出四段解析 | ✅ 已完成 |
| **M1** | 知识框架图（Vue Flow 渲染） | ✅ 已完成 |
| **M2** | **知识库（RAG）：自有语料 + 向量检索 + 引用来源** | ✅ 已完成 |
| M3 | 交互打磨：错误兜底、手机适配 | ⬜ 未开始 |
| M4 | 伪视频播放器 | ⬜ 未开始 |
| M5 | Agent 思考链面板 | ⬜ 未开始 |
| M6 | 代码截图上传 → 识别 → 解析 | ⬜ 未开始 |

---

## 系统架构

### 一次请求的完整链路

```
浏览器（app/pages/index.vue）
   │  POST /api/analyze  { code }
   ▼
Nuxt 服务端（server/api/analyze.post.ts）
   │
   ├─ ① 校验请求 ────────────── Zod 校验 code 长度 1~20000 字
   │
   ├─ ② 知识库检索 ────────────► server/rag/
   │      · 判断代码语言（未收录的语言如 C++ 直接跳过检索）
   │      · 把代码变成向量（调智谱 embedding-3）
   │      · 在内存里逐条算余弦相似度，取分数 ≥0.5 的前 4 条
   │
   ├─ ③ 组装提示词 ──────────── server/utils/prompt.ts
   │      · 系统提示词（四段输出的格式规范）
   │      · ＋ 参考资料使用规则（**只在检索到资料时才追加**）
   │      · ＋ 用户代码 ＋ 检索到的参考资料
   │
   ├─ ④ 调大模型 ────────────── DeepSeek，stream: true
   │
   ├─ ⑤ 流转发 ──────────────── 把上游 SSE 拆成纯文本流 → 浏览器（打字机效果）
   │
   └─ ⑥ 引用来源 ────────────── 放进响应头 X-Rag-Sources → 浏览器（引用卡片）
```

### 模块职责

| 路径 | 管什么 |
|---|---|
| `app/pages/index.vue` | 主页面：输入框、流式渲染、引用卡片、知识框架图 |
| `app/components/GraphView.vue` | 把图 JSON 渲染成可拖拽缩放的节点图（Vue Flow + dagre 自动排版） |
| `app/components/SourceList.vue` | 引用来源卡片 |
| `server/api/analyze.post.ts` | **唯一的接口**：检索 + 调模型 + 流转发 |
| `server/utils/prompt.ts` | 提示词（本项目的核心资产） |
| `server/rag/` | 知识库：语料、向量、检索 |
| `scripts/` | 离线脚本：生成向量、校准检索阈值 |

### 两个关键设计决策

**① 引用来源走 HTTP 响应头，而不是让大模型输出**

检索在流式回答开始**之前**就完成了，所以"检索到哪几条"是服务端**已经确定的事实**。
让大模型再复述一遍只会引入幻觉和截断，而且卡片要等全文流完才出现。

放进响应头（`X-Rag-Sources`）之后：来源 100% 准确，卡片在打字机刚启动时就能显示。

**② 检索前先做语言过滤**

实测发现：**embedding 模型分不开"相关"和"不相关"** —— C++ 代码对 JS 语料也能拿到 0.57 的相似度，
因为向量空间里"这是代码"的权重远大于"这是关于什么的"。

所以检索前先判断代码语言，只在该语言的资料里找；遇到没收录的语言（C++、Go 等）直接跳过检索，
干净地降级为纯模型回答。详见 `server/rag/retrieve.ts` 顶部的注释。

---

## 知识库（M2）

这是项目"不只是调 API"的关键部分。

| | |
|---|---|
| **语料** | `server/rag/corpus.json` —— 人工整理的技术资料，每条带出处链接 |
| **向量** | `server/rag/corpus.embeddings.json` —— 离线预计算，**必须提交进 git** |
| **embedding 服务** | 智谱 `embedding-3`（1024 维），与生成回答的 DeepSeek **完全分开** |
| **检索** | 内存暴力算余弦，不装向量数据库（语料只有几十条） |
| **引用编号** | 服务端生成，通过响应头 `X-Rag-Sources` 传给前端，与正文 `[n]` 一一对应 |

**改了语料之后必须重跑：**

```bash
npm run rag:build      # 重新生成向量
```

否则新语料不会有向量（程序会检测到并跳过它们，不会给出错误答案）。

**语料变多后重新校准检索阈值：**

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
| 图渲染 | Vue Flow + dagre | 节点图渲染 + 自动排版 |
| 数据校验 | Zod | 校验接口入参 |
| 文本生成 | **DeepSeek**（`deepseek-chat`） | 生成四段解释文字 |
| 向量化 | **智谱 GLM**（`embedding-3`） | 把文字变成向量，供知识库检索 |
| 部署 | Vercel | 免费、不用备案、推送即上线 |

> **为什么用两家不同的服务？**
> 生成文字和"把文字变成数字"是两种完全不同的模型，DeepSeek 不提供 embedding 接口。
> 国内通行做法就是**生成用一家、向量化用另一家**。两组配置在 `.env` 里完全分开，互不回退。

> **为什么不做单独的 Python 后端？**
> 大赛文档明确鼓励"充分利用现代前端框架的全栈能力（如 API Routes）简化后端逻辑"。
> Nuxt 的 `server/` 目录本身就是后端，少维护一套服务、少买一台服务器、少一次备案。

---

## 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 配置密钥：复制模板
cp .env.example .env

# 3. 编辑 .env，至少填这两个（详见下一节）
#    NUXT_LLM_API_KEY=你的 DeepSeek key
#    NUXT_EMBEDDING_API_KEY=你的智谱 key

# 4. 启动开发服务器
npm run dev
#    打开 http://localhost:3000
```

> 只想看最基本的"贴代码 → 解释"效果：**只填 `NUXT_LLM_API_KEY` 就能跑**，
> 知识库检索会自动跳过（这是设计好的降级，不是报错）。

---

## 环境变量说明

全部通过 `.env` 控制（该文件已被 `.gitignore` 排除，**不会上传**；模板见 `.env.example`）。

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `NUXT_LLM_API_KEY` | ✅ **必填** | — | DeepSeek 的 key。申请：https://platform.deepseek.com |
| `NUXT_LLM_BASE_URL` | 可选 | `https://api.deepseek.com` | 换生成模型的服务商时改这里 |
| `NUXT_LLM_MODEL` | 可选 | `deepseek-chat` | 生成用的模型名 |
| `NUXT_EMBEDDING_API_KEY` | 建议填 | — | 智谱的 key。申请：https://open.bigmodel.cn<br>**不填则知识库检索自动跳过**，其余功能正常 |
| `NUXT_EMBEDDING_BASE_URL` | 可选 | `https://open.bigmodel.cn/api/paas/v4` | |
| `NUXT_EMBEDDING_MODEL` | 可选 | `embedding-3` | |
| `NUXT_EMBEDDING_DIMENSIONS` | 可选 | `1024` | ⚠️ 改这个必须重跑 `npm run rag:build`，否则维度对不上 |
| `NUXT_RAG_ENABLED` | 可选 | `true` | 设为 `false` 可关闭知识库，用于对比演示"有 RAG / 没 RAG" |
| `NUXT_RAG_TOP_K` | 可选 | `4` | 每次检索取回几条资料 |
| `NUXT_RAG_MIN_SCORE` | 可选 | `0.5` | 相似度低于此值不采用。**0.5 是实测校准出来的**，见 `scripts/rag-probe.mjs` |

> ⚠️ **LLM 和 Embedding 是两家不同的服务，两组 key 不能互换。**
> 两家的向量空间不通用，拿错 key 只会得到 404 或维度错乱。

---

## 目录结构

```
AI-Web/
├── app/                           # 前端（Nuxt 4 约定：源码在 app/ 下）
│   ├── app.vue                    # 应用外壳
│   ├── assets/css/main.css        # 全局样式 + Vue Flow 浅色覆盖
│   ├── components/
│   │   ├── GraphView.vue          # 知识框架图（Vue Flow + dagre）
│   │   └── SourceList.vue         # 引用来源卡片
│   └── pages/index.vue            # 主页面
├── server/                        # 后端（Nitro，跑在同一个进程里）
│   ├── api/analyze.post.ts        # POST /api/analyze —— 唯一接口
│   ├── utils/prompt.ts            # 提示词（核心资产）
│   └── rag/                       # ★ 知识库
│       ├── corpus.json            #   人工整理的语料（改这个）
│       ├── corpus.embeddings.json #   预计算向量（脚本生成，要提交）
│       ├── types.ts               #   类型定义
│       ├── corpus.ts              #   加载 + 校验 + 缓存
│       ├── embed.ts               #   调智谱 embedding
│       └── retrieve.ts            #   语言过滤 + 余弦 + top-k
├── scripts/
│   ├── build-embeddings.mjs       # npm run rag:build
│   └── rag-probe.mjs              # 检索阈值校准探针
├── nuxt.config.ts                 # 框架配置 + 服务端私有配置
├── package.json                   # 依赖清单
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

**麦穗团队（WheatBend）** · 武汉晴川学院

| 姓名 | 学校 | 负责 |
|---|---|---|
| 石凯樊 | 武汉晴川学院 | （待填） |

---

## 开源协议

本项目为参赛作品，代码仅供评审查阅。
