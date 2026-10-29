<script setup lang="ts">
/**
 * 测试入口：固定图 + 固定文件内容 + 固定结构结论，只跑分批自检。
 *
 * 这里不走上传、地图、逐文件 analyze、总览；用来量自检预算，
 * 避免为了测一次自检重新解析整个项目。页面不在导航里。
 */
import type { ProjectFileEntry, ProjectGraphData } from '~/types/project'
import type { SelfCheckPlan } from '~/utils/self-check-plan'
import { buildSelfCheckPlan } from '~/utils/self-check-plan'
import { useProjectAgent } from '~/composables/useProjectAgent'

definePageMeta({ layout: false })

const route = useRoute()
const fixtureUrl =
  route.query.fixture === '187'
    ? '/dev/self-check-fixture-187.json'
    : '/dev/self-check-fixture.json'

interface Fixture {
  graph: ProjectGraphData
  files: { path: string; name: string; content: string }[]
  projectContext: string
}

const fixture = ref<Fixture | null>(null)
const plan = ref<SelfCheckPlan | null>(null)
const entries = ref<ProjectFileEntry[]>([])
const fileMap = new Map<string, File>()
const loadError = ref('')
const result = ref<Awaited<ReturnType<ReturnType<typeof useProjectAgent>['runSelfCheckBatch']>>>(null)
const agent = useProjectAgent()
const running = agent.running
const error = agent.error

onMounted(async () => {
  try {
    const data = await $fetch<Fixture>(fixtureUrl)
    fixture.value = data
    entries.value = data.files.map((file) => ({
      path: file.path,
      name: file.name,
      size: file.content.length,
      category: 'user',
      subtype: 'source',
      unrecorded: false,
      include: true,
      configMode: 'context',
      systemMode: 'context',
    }))
    for (const file of data.files) {
      fileMap.set(file.path, new File([file.content], file.name, { type: 'text/plain' }))
    }
    plan.value = buildSelfCheckPlan(data.graph, [])
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
})

async function run() {
  if (!fixture.value || !plan.value || agent.running.value) return
  result.value = await agent.runSelfCheckBatch({
    plan: plan.value,
    projectContext: fixture.value.projectContext,
    entries: entries.value,
    readablePaths: entries.value.map((entry) => entry.path),
    getFile: (path) => fileMap.get(path),
  })
}
</script>

<template>
  <main class="mx-auto max-w-4xl p-6 font-sans text-slate-800">
    <h1 class="text-lg font-semibold">固定图自检测试入口</h1>
    <p class="mt-1 text-xs text-slate-500">
      不经过上传、逐文件解析、地图、总览；只用固定图和固定文件内容跑分批自检。
    </p>

    <p v-if="loadError" class="mt-4 text-sm text-red-600">{{ loadError }}</p>
    <template v-else-if="fixture && plan">
      <div class="mt-4 rounded border border-slate-200 p-3 text-xs">
        <div>图：{{ fixture.graph.nodes.length }} 节点 / {{ fixture.graph.edges.length }} 边</div>
        <div>文件：{{ entries.length }} 个；结构结论：{{ fixture.projectContext.length }} 字符</div>
        <div>计划：{{ plan.total }} 条边，程序支持 {{ plan.supported }} 条，{{ plan.batches.length }} 批</div>
      </div>

      <button
        type="button"
        class="mt-4 rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        :disabled="running"
        @click="run"
      >
        {{ running ? '自检中…' : '只跑一次自检' }}
      </button>
      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>

      <pre
        v-if="result"
        class="mt-4 max-h-[65vh] overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-5 text-slate-100"
      >{{ JSON.stringify({
        coverage: result.coverage,
        usedTokens: result.usedTokens,
        modelCalls: result.modelCalls,
        toolCalls: result.toolCalls,
        stopped: result.stopped,
        decisions: result.decisions.length,
        actions: result.decisions.reduce((counts, decision) => {
          counts[decision.action] = (counts[decision.action] ?? 0) + 1
          return counts
        }, {} as Record<string, number>),
      }, null, 2) }}</pre>
    </template>
    <p v-else class="mt-4 text-sm text-slate-500">正在读取固定夹具…</p>
  </main>
</template>
