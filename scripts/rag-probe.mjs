#!/usr/bin/env node
/**
 * 检索校准探针（只读，不改任何文件）。
 *
 * 用途：拿一批「应该命中」和「应该命中不了」的真实样本跑一遍，
 *       看检索效果，据此校准 NUXT_RAG_MIN_SCORE。
 *
 * 用法：
 *   node --env-file=.env scripts/rag-probe.mjs
 *
 * ⚠️ 这里的 buildQuery / detectBucket / LANG_BUCKET 必须与
 *    server/rag/retrieve.ts 里的实现保持一致，改了那边要同步改这边。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const API_KEY = process.env.NUXT_EMBEDDING_API_KEY
const BASE_URL = (process.env.NUXT_EMBEDDING_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, '')
const MODEL = process.env.NUXT_EMBEDDING_MODEL || 'embedding-3'
const DIMENSIONS = Number(process.env.NUXT_EMBEDDING_DIMENSIONS || 1024)

// ---------- 与 retrieve.ts 保持一致的部分 ----------

const LANG_BUCKET = {
  javascript: 'frontend', typescript: 'frontend', react: 'frontend', vue: 'frontend', css: 'frontend',
  python: 'python', java: 'java', sql: 'sql',
}

function detectBucket(code) {
  // 我们没收录的语言
  if (/(^|\n)\s*#include\s*[<"]/.test(code) || /\bstd::/.test(code) || /\bprintf\s*\(/.test(code)) return 'none'
  if (/(^|\n)\s*using\s+namespace\s+std\b/.test(code)) return 'none'
  if (/(^|\n)\s*package\s+\w+/.test(code) && /\bfunc\s+\w*\s*\(/.test(code)) return 'none'
  if (/\bfn\s+\w+\s*\(/.test(code) && /(\blet\s+mut\b|println!|use\s+std::|\bimpl\b)/.test(code)) return 'none'

  if (/\bpublic\s+(class|interface|enum)\b/.test(code) || /\bSystem\.(out|err)\.print/.test(code) ||
      /(^|\n)\s*import\s+java\./.test(code) || /@(Override|Autowired|RestController|Service)\b/.test(code)) return 'java'

  // import 规则要收紧，否则会把 JS 的 `import React from 'react'` 误判成 Python
  if (/(^|\n)\s*def\s+\w+\s*\([^)]*\)\s*:/.test(code) ||
      /(^|\n)\s*import\s+\w+(\s*,\s*\w+)*\s*$/m.test(code) ||
      /(^|\n)\s*from\s+[\w.]+\s+import\b/.test(code) ||
      /\b(elif|self\.|__init__)\b/.test(code)) return 'python'

  if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/i.test(code) &&
      /\b(FROM|WHERE|VALUES|SET|INTO)\b/i.test(code)) return 'sql'

  if (/\b(import|export)\b/.test(code) || /\b(const|let|var|function)\s/.test(code) || /=>/.test(code) ||
      /<\/?[A-Za-z][\w-]*/.test(code) || /\b(useState|useEffect|ref|reactive|computed)\s*\(/.test(code) ||
      /[.#][\w-]+\s*\{/.test(code)) return 'frontend'
  return 'unknown'
}

const QUERY_NOISE = new Set()

function buildQuery(code) {
  const head = code.slice(0, 1500)
  const importLines = code
    .split('\n')
    .filter((line) => /^\s*(import\s|from\s|const\s+\w+\s*=\s*require|#include|using\s)/.test(line))
    .slice(0, 12)
  return [head, ...importLines].join('\n')
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ---------- 测试样本 ----------

const SHOULD_HIT = [
  {
    label: 'JS 数组链式操作（页面示例 1）',
    expect: ['js-array-reduce', 'js-array-map', 'js-array-filter'],
    code: `const orders = [{ id: 1, amount: 120, paid: true },{ id: 2, amount: 80, paid: false }];
const total = orders.filter(o => o.paid).map(o => o.amount).reduce((s, n) => s + n, 0);
console.log(total);`,
  },
  {
    label: 'React 状态与副作用',
    expect: ['react-usestate', 'react-useeffect'],
    code: `import { useState, useEffect } from 'react';
function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => { document.title = 'count: ' + count; }, [count]);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}`,
  },
  {
    label: 'React 列表渲染',
    expect: ['react-key', 'react-props'],
    code: `function List({ items }) {
  return <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>;
}`,
  },
  {
    label: 'JS 异步',
    expect: ['js-async-await', 'js-promise'],
    code: `async function loadUser(id) {
  try { const res = await fetch('/api/users/' + id); return await res.json(); }
  catch (err) { console.error(err); }
}`,
  },
  {
    label: 'JS 闭包与解构',
    expect: ['js-closure', 'js-destructuring'],
    code: `function makeCounter() {
  let n = 0;
  return () => ++n;
}
const { name, age } = user;`,
  },
  {
    label: 'Python 装饰器（页面示例 2）',
    expect: ['py-decorator'],
    code: `import time
from functools import wraps

def timer(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        cost = time.perf_counter() - start
        print(f"{func.__name__} 耗时 {cost:.4f}s")
        return result
    return wrapper

@timer
def slow_sum(n):
    return sum(i * i for i in range(n))

slow_sum(1_000_000)`,
  },
  {
    label: 'Python 有安全隐患（页面示例 3）',
    expect: ['py-sql-injection'],
    code: `def find_user(username):
    sql = "SELECT * FROM users WHERE name = '" + username + "'"
    cursor.execute(sql)
    return cursor.fetchone()`,
  },
  {
    label: 'Python 列表推导与生成器',
    expect: ['py-list-comprehension', 'py-generator-yield'],
    code: `def load_lines(path):
    with open(path) as f:
        for line in f:
            yield line.strip()

squares = [x * x for x in range(10) if x % 2 == 0]`,
  },
  {
    label: 'Vue 组合式 API',
    expect: ['vue-ref', 'vue-computed'],
    code: `import { ref, computed, watch } from 'vue'

const count = ref(0)
const doubled = computed(() => count.value * 2)
watch(count, (val) => console.log('变了', val))`,
  },
  {
    label: 'CSS Flex 布局',
    expect: ['css-flexbox'],
    code: `.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-sizing: border-box;
}`,
  },
  {
    label: 'Java Stream 与泛型',
    expect: ['java-stream', 'java-generics'],
    code: `import java.util.List;
import java.util.stream.Collectors;

public class Demo {
    public static void main(String[] args) {
        List<Integer> nums = List.of(1, 2, 3, 4);
        List<Integer> even = nums.stream()
            .filter(n -> n % 2 == 0)
            .collect(Collectors.toList());
        System.out.println(even);
    }
}`,
  },
  {
    label: 'SQL 连接与分组',
    expect: ['sql-join', 'sql-group-by'],
    code: `SELECT c.name, COUNT(o.id) AS order_count
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.created_at >= '2026-01-01'
GROUP BY c.name
HAVING COUNT(o.id) > 3;`,
  },
]

const SHOULD_MISS = [
  {
    label: 'C++ 模板与智能指针（识别为未收录语言 → 应直接放弃检索）',
    code: `#include <iostream>
#include <vector>
template <typename T> T sum(const std::vector<T>& v){ T t{}; for(auto& x:v) t+=x; return t; }
int main(){ std::cout << sum(v) << std::endl; }`,
  },
  {
    label: 'Go（识别为未收录语言 → 应直接放弃检索）',
    code: `package main

import "fmt"

func main() {
    nums := []int{1, 2, 3}
    total := 0
    for _, n := range nums {
        total += n
    }
    fmt.Println(total)
}`,
  },
  {
    label: 'Rust（识别为未收录语言 → 应直接放弃检索）',
    code: `use std::collections::HashMap;

fn main() {
    let mut scores: HashMap<&str, i32> = HashMap::new();
    scores.insert("blue", 10);
    println!("{:?}", scores);
}`,
  },
]

// ---------- 执行 ----------

async function embed(text) {
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, input: [text], dimensions: DIMENSIONS }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).data[0].embedding
}

async function main() {
  if (!API_KEY) { console.error('❌ 缺少 NUXT_EMBEDDING_API_KEY'); process.exit(1) }

  const corpus = JSON.parse(readFileSync(join(ROOT, 'server/rag/corpus.json'), 'utf8'))
  const embeddings = JSON.parse(readFileSync(join(ROOT, 'server/rag/corpus.embeddings.json'), 'utf8'))
  const byId = new Map(embeddings.items.map((i) => [i.id, i]))

  console.log(`语料 ${corpus.length} 条，向量 ${embeddings.items.length} 条\n`)

  const hitMins = []

  console.log('════════ 应该命中的样本 ════════')
  for (const s of SHOULD_HIT) {
    const detected = detectBucket(s.code)
    const candidates = corpus.filter((e) => LANG_BUCKET[e.lang] === detected)

    if (candidates.length === 0) {
      console.log(`\n【${s.label}】\n   ⚠️ 语言识别为 ${detected}，但没有候选语料 → 会降级`)
      continue
    }

    const qv = await embed(buildQuery(s.code))
    const scored = candidates
      .map((e) => ({ id: e.id, score: cosine(qv, byId.get(e.id).vector) }))
      .sort((a, b) => b.score - a.score)

    const top = scored.slice(0, 4)
    console.log(`\n【${s.label}】  语言=${detected}  候选=${candidates.length}`)
    top.forEach((t, i) => {
      const mark = s.expect.includes(t.id) ? ' ✓' : ''
      console.log(`   ${i + 1}. ${t.id.padEnd(28)} ${t.score.toFixed(4)}${mark}`)
    })
    const missing = s.expect.filter((e) => !top.map((t) => t.id).includes(e))
    if (missing.length) console.log(`   ⚠️ 未进前 4：${missing.join(', ')}`)

    // 记下「期望命中项」中最低的那个分数 —— 这就是阈值的安全下限
    const hitScores = scored.filter((x) => s.expect.includes(x.id)).map((x) => x.score)
    if (hitScores.length) hitMins.push(Math.min(...hitScores))
  }

  console.log('\n════════ 应该命中不了的样本 ════════')
  for (const s of SHOULD_MISS) {
    const detected = detectBucket(s.code)
    const candidates = corpus.filter((e) => LANG_BUCKET[e.lang] === detected)
    const conclusion = detected === 'none'
      ? '识别为未收录语言 → 直接放弃检索 ✅'
      : candidates.length === 0
        ? `语言=${detected} 但无候选语料 → 放弃检索 ✅`
        : `语言=${detected} 候选=${candidates.length} → 会走向量检索 ⚠️`
    console.log(`\n【${s.label}】\n   ${conclusion}`)
  }

  console.log('\n════════ 阈值建议 ════════')
  if (hitMins.length) {
    const lowest = Math.min(...hitMins)
    console.log(`   期望命中项里的最低分: ${lowest.toFixed(4)}`)
    console.log(`   建议 NUXT_RAG_MIN_SCORE 取 ${(lowest - 0.06).toFixed(2)} 左右`)
    console.log('   （留一点余量，让边缘命中不被误杀）')
  } else {
    console.log('   没有采集到命中样本的分数')
  }
}

main().catch((err) => { console.error('❌ 探测失败：', err.message); process.exit(1) })
