<script setup lang="ts">
/**
 * 左栏：代码输入区。
 *
 * 只做输入这一件事：示例按钮、输入框、字数提醒、三个动作按钮，
 * 外加「被选中时高亮对应行」。
 *
 * ── 行高亮为什么需要一个"镜像层" ──
 * 原生 `<textarea>` **没法只给某几行加背景色**（它的内容不由 DOM 节点构成）。
 * 所以底下垫一层和它**同字体、同字号、同行距、同内边距**的 div，里面是
 * **同一份文本**（文字透明），只给命中的行上背景色 —— textarea 压在它上面。
 *
 * 为什么是"镜像同一份文本"而不是算 `top = (行号-1) × 行高`：
 * 长代码行在框里会**折行**，折行之后"逻辑第 N 行"在屏幕上占了几行就不确定了，
 * 算出来的位置必错。镜像层的文本和 textarea 同源同度量，折行位置自然一致。
 *
 * ⚠️ 唯一的坑是**内容宽度**：textarea 一旦出现纵向滚动条，它的内容区会窄
 *    一个滚动条宽，镜像层却不会 —— 两边宽度不等，折行位置就漂。
 *    这里的做法是**实测**滚动条的宽度（offsetWidth - clientWidth），
 *    用它把镜像层右边缘往里收，让两者的内容区严格相等。
 */
const props = defineProps<{
  modelValue: string
  /** 是否正在解析（决定第三个按钮是「开始解析」还是「停止」） */
  loading: boolean
  /** 代码长度上限（与服务端 zod 同步） */
  maxLength: number
  /** 超过这个长度就醒目提醒（还没到上限） */
  warnAt: number
  /** 要高亮的原始代码行号（1 起）。空数组表示不高亮 */
  highlightLines: number[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'analyze' | 'stop' | 'clear'): void
}>()

/** 演示用示例代码（录视频和评委体验时一键可用） */
const SAMPLES: { label: string; code: string }[] = [
  {
    label: 'Java · 订单事务',
    code: [
      'package com.example.order;',
      '',
      'import jakarta.validation.Valid;',
      'import jakarta.validation.constraints.*;',
      'import org.apache.ibatis.annotations.Insert;',
      'import org.apache.ibatis.annotations.Select;',
      'import org.springframework.stereotype.Service;',
      'import org.springframework.transaction.annotation.Transactional;',
      '',
      'import java.util.List;',
      '',
      '@Service',
      'public class OrderService {',
      '    private final OrderMapper mapper;',
      '    private final StockClient stockClient;',
      '',
      '    public OrderService(OrderMapper mapper, StockClient stockClient) {',
      '        this.mapper = mapper;',
      '        this.stockClient = stockClient;',
      '    }',
      '',
      '    @Transactional',
      '    public Order createOrder(@Valid CreateOrderRequest request) {',
      '        // 1. 扣库存：远程调用放在事务里，失败会回滚本地事务',
      '        stockClient.deduct(request.skuId(), request.quantity());',
      '        // 2. 写订单：用 #{} 预编译，避免 SQL 注入',
      '        Order order = new Order(request.skuId(), request.quantity());',
      '        mapper.insert(order);',
      '        // 3. 自调用：同一个类里直接调 audit，事务注解不会再生效',
      '        audit(order);',
      '        return order;',
      '    }',
      '',
      '    public void audit(Order order) {',
      '        mapper.insertAudit(order.getId(), "CREATED");',
      '    }',
      '}',
      '',
      'interface OrderMapper {',
      '    @Insert("INSERT INTO orders(sku_id, quantity) VALUES(#{skuId}, #{quantity})")',
      '    void insert(Order order);',
      '',
      '    @Insert("INSERT INTO order_audit(order_id, action) VALUES(#{orderId}, #{action})")',
      '    void insertAudit(Long orderId, String action);',
      '',
      '    // 反例：${} 是字符串拼接，keyword 会直接进入 SQL',
      '    @Select("SELECT * FROM orders WHERE user_id = #{userId} AND title LIKE \'%${keyword}%\'")',
      '    List<Order> searchByKeyword(String userId, String keyword);',
      '}',
      '',
      'record CreateOrderRequest(@NotNull Long skuId, @Min(1) int quantity) {}',
    ].join('\n'),
  },
  {
    label: 'Vue · 组合式表单',
    code: [
      '<script setup lang="ts">',
      "import { computed, inject, reactive, ref, watch } from 'vue'",
      '',
      'interface Order { id: number; amount: number; paid: boolean }',
      'interface Props { title: string; orders: Order[] }',
      'const props = defineProps<Props>()',
      "const emit = defineEmits<{ (e: 'submit', ids: number[]): void }>()",
      '',
      "const keyword = ref('')",
      'const selected = reactive<number[]>([])',
      "const api = inject<{ pay: (ids: number[]) => Promise<void> }>('orderApi')",
      '',
      'const visibleOrders = computed(() =>',
      '  props.orders.filter((order) => String(order.id).includes(keyword.value)),',
      ')',
      'const total = computed(() =>',
      '  visibleOrders.value.filter((o) => o.paid).reduce((sum, o) => sum + o.amount, 0),',
      ')',
      '',
      'watch(keyword, () => {',
      '  selected.splice(0, selected.length)',
      '})',
      '',
      'async function submit() {',
      '  if (!api || selected.length === 0) return',
      '  await api.pay([...selected])',
      "  emit('submit', [...selected])",
      '}',
      '</scr' + 'ipt>',
      '',
      '<template>',
      '  <section class="order-panel">',
      '    <header>',
      '      <h3>{{ title }}</h3>',
      '      <input v-model.trim="keyword" placeholder="按订单号筛选" />',
      '    </header>',
      '    <ul>',
      '      <li v-for="order in visibleOrders" :key="order.id">',
      '        <label>',
      '          <input v-model="selected" type="checkbox" :value="order.id" />',
      "          #{{ order.id }} · ¥{{ order.amount }} · {{ order.paid ? '已支付' : '未支付' }}",
      '        </label>',
      '      </li>',
      '    </ul>',
      '    <footer>',
      '      已付合计：¥{{ total }}',
      '      <button :disabled="selected.length === 0" @click="submit">提交支付</button>',
      '    </footer>',
      '  </section>',
      '</template>',
    ].join('\n'),
  },
  {
    label: 'Python · 装饰器与生成器',
    code: [
      'import time',
      'from contextlib import contextmanager',
      'from functools import wraps',
      'from typing import Callable, Generator, Iterable, TypeVar',
      '',
      'T = TypeVar("T")',
      '',
      'def timed(func: Callable[..., T]) -> Callable[..., T]:',
      '    """记录函数耗时的装饰器；wraps 保留原函数名和文档字符串。"""',
      '    @wraps(func)',
      '    def wrapper(*args, **kwargs) -> T:',
      '        start = time.perf_counter()',
      '        try:',
      '            return func(*args, **kwargs)',
      '        finally:',
      '            cost = time.perf_counter() - start',
      '            print(f"{func.__name__} 耗时 {cost:.4f}s")',
      '    return wrapper',
      '',
      '@contextmanager',
      'def session():',
      '    """用上下文管理器保证连接一定关闭。"""',
      '    conn = {"open": True}',
      '    try:',
      '        yield conn',
      '    finally:',
      '        conn["open"] = False',
      '',
      'def read_orders(path: str) -> Generator[dict, None, None]:',
      '    """生成器逐行读文件，不会一次把全部订单放进内存。"""',
      '    with open(path, encoding="utf-8") as fp:',
      '        for line in fp:',
      '            order_id, amount, paid = line.strip().split(",")',
      '            yield {"id": int(order_id), "amount": float(amount), "paid": paid == "1"}',
      '',
      '@timed',
      'def summarize(rows: Iterable[dict]) -> float:',
      '    return sum(row["amount"] for row in rows if row["paid"])',
      '',
      'with session() as conn:',
      '    rows = list(read_orders("orders.csv"))',
      '    print("已支付合计:", summarize(rows))',
    ].join('\n'),
  },
  {
    label: 'TS · 异步汇总',
    code: [
      'type Order = {',
      '  id: number',
      '  userId: string',
      '  amount: number',
      "  status: 'new' | 'paid' | 'cancelled'",
      '  tags?: string[]',
      '}',
      '',
      'interface Page<T> {',
      '  items: T[]',
      '  total: number',
      '}',
      '',
      'async function fetchPage<T>(url: string): Promise<Page<T>> {',
      '  const res = await fetch(url)',
      '  if (!res.ok) throw new Error(`请求失败：${res.status}`)',
      '  return (await res.json()) as Page<T>',
      '}',
      '',
      "function isPaid(order: Order): order is Order & { status: 'paid' } {",
      "  return order.status === 'paid'",
      '}',
      '',
      'function pickIds(orders: Order[], keyword: string): number[] {',
      '  const normalized = keyword.trim().toLowerCase()',
      '  return orders',
      "    .filter((order) => order.status !== 'cancelled')",
      '    .filter((order) => !normalized || order.tags?.some((tag) => tag.toLowerCase().includes(normalized)))',
      '    .map((order) => order.id)',
      '}',
      '',
      "async function loadDashboard(userId: string, keyword = '') {",
      '  const [orders, points] = await Promise.all([',
      '    fetchPage<Order>(`/api/orders?userId=${encodeURIComponent(userId)}`),',
      '    fetchPage<{ value: number }>(`/api/points?userId=${encodeURIComponent(userId)}`),',
      '  ])',
      '  const paid = orders.items.filter(isPaid)',
      '  const orderTotal = paid.reduce((sum, order) => sum + order.amount, 0)',
      '  const pointsTotal = points.items.reduce((sum, point) => sum + point.value, 0)',
      '  return { ids: pickIds(orders.items, keyword), total: orderTotal + pointsTotal }',
      '}',
      '',
      "loadDashboard('u-1').then((data) => console.log(data))",
    ].join('\n'),
  },
  {
    label: 'SQL · 统计与索引',
    code: [
      '-- 订单表与明细表；订单统计、索引与深分页',
      'CREATE TABLE orders (',
      '  id BIGINT PRIMARY KEY,',
      '  user_id BIGINT NOT NULL,',
      '  status VARCHAR(16) NOT NULL,',
      '  amount DECIMAL(12,2) NOT NULL,',
      '  created_at DATETIME NOT NULL',
      ');',
      '',
      'CREATE TABLE order_items (',
      '  id BIGINT PRIMARY KEY,',
      '  order_id BIGINT NOT NULL,',
      '  sku_id BIGINT NOT NULL,',
      '  quantity INT NOT NULL,',
      '  price DECIMAL(12,2) NOT NULL,',
      '  KEY idx_order (order_id)',
      ');',
      '',
      '-- 1. 每个用户已支付订单数和金额；GROUP BY 先过滤再聚合',
      'SELECT o.user_id,',
      '       COUNT(*) AS order_count,',
      '       SUM(o.amount) AS total_amount',
      'FROM orders o',
      "WHERE o.status = 'PAID'",
      "  AND o.created_at >= '2026-01-01'",
      'GROUP BY o.user_id',
      'HAVING SUM(o.amount) > 1000',
      'ORDER BY total_amount DESC;',
      '',
      '-- 2. 子查询：找出买过指定 SKU 的用户',
      'SELECT DISTINCT o.user_id',
      'FROM orders o',
      'JOIN order_items i ON i.order_id = o.id',
      'WHERE i.sku_id = 1001',
      "  AND o.status = 'PAID';",
      '',
      '-- 3. 联合索引最左前缀：user_id + status + created_at',
      'ALTER TABLE orders ADD KEY idx_user_status_time (user_id, status, created_at);',
      '',
      '-- 4. 深分页：OFFSET 越大越慢，改成“记住上一页最后一条”',
      'SELECT id, user_id, amount',
      'FROM orders',
      "WHERE status = 'PAID'",
      '  AND id > 100000',
      'ORDER BY id',
      'LIMIT 20;',
      '',
      '-- 5. 看执行计划，确认有没有走索引',
      'EXPLAIN SELECT id, amount',
      'FROM orders',
      "WHERE user_id = 42 AND status = 'PAID'",
      'ORDER BY created_at DESC',
      'LIMIT 20;',
    ].join('\n'),
  },
]

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const mirrorRef = ref<HTMLElement | null>(null)

/**
 * 代码截图上传（M9）。
 *
 * 识别结果只放进输入框，不自动开始解析：用户要先看一眼识别得对不对。
 * 输入框里已经有代码时直接拒绝，避免把用户手写的内容悄悄覆盖掉。
 */
const { reading: imageReading, error: imageError, extract } = useImageCode()
const imageInputRef = ref<HTMLInputElement | null>(null)
const imageHint = ref('')

function pickImage() {
  if (props.loading || imageReading.value) return

  if (props.modelValue.trim()) {
    imageHint.value = ''
    imageError.value = '输入框里已经有代码了。先清空，再上传截图，避免覆盖。'
    return
  }

  imageInputRef.value?.click()
}

async function onImageChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  imageHint.value = ''
  const code = await extract(file)
  if (code) {
    emit('update:modelValue', code)
    imageHint.value = `已从截图识别 ${code.split('\n').length} 行，检查无误后再点开始解析`
  }

  // 允许再次选择同一张图
  input.value = ''
}

/** 外部传进来的值是只读 prop，要改必须显式往上抛事件 */
const text = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})

/** 镜像层按行切开渲染，这样能给某一行加背景色 */
const mirrorLines = computed(() => props.modelValue.split('\n'))

const hitSet = computed(() => new Set(props.highlightLines))

/**
 * 滚动条的实测宽度。用它把镜像层右边缘往里收，
 * 使镜像层的内容区和 textarea 的内容区**严格相等** —— 折行位置才会一致。
 */
const scrollbarW = ref(0)

function measureScrollbar() {
  const ta = textareaRef.value
  if (!ta) return
  scrollbarW.value = ta.offsetWidth - ta.clientWidth
}

/** textarea 滚动时，镜像层跟着走 */
function syncScroll() {
  const ta = textareaRef.value
  const mirror = mirrorRef.value
  if (ta && mirror) mirror.scrollTop = ta.scrollTop
}

/**
 * 把高亮的第一行滚进视野。
 * 位置取自**镜像层里那个 span 的 offsetTop**，而不是
 * `(行号-1) × 行高` —— 前面有折行的行时，后者会算错。
 */
function focusLines(lines: number[]) {
  const ta = textareaRef.value
  const mirror = mirrorRef.value
  const first = lines[0]
  if (!ta || !mirror || first === undefined) return

  const span = mirror.children[first - 1] as HTMLElement | undefined
  if (!span) return

  ta.scrollTop = Math.max(0, span.offsetTop - ta.clientHeight / 3)
  syncScroll()
}

defineExpose({ focusLines })

onMounted(() => {
  measureScrollbar()
  window.addEventListener('resize', measureScrollbar)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureScrollbar)
})

// 代码换了（比如点了示例按钮）要重新量一次：滚动条可能因此出现或消失
watch(
  () => props.modelValue,
  () => nextTick(measureScrollbar),
)

// 清空输入后，上一次的截图提示也该跟着消失
watch(
  () => props.modelValue,
  (value) => {
    if (!value.trim() && !imageReading.value) {
      imageError.value = ''
      imageHint.value = ''
    }
  },
)
</script>

<template>
  <section
    class="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:h-[calc(100vh-200px)] lg:min-h-[420px] lg:overflow-hidden"
  >
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold text-slate-800">输入你的代码</h2>
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
        >
          自动识别语言
        </span>
        <span
          class="text-xs tabular-nums transition-colors"
          :class="modelValue.length >= warnAt ? 'font-medium text-amber-600' : 'text-slate-400'"
        >
          {{ modelValue.length }} / {{ maxLength.toLocaleString() }} 字符
        </span>
      </div>
    </div>

    <!-- 输入区：底下是镜像层，上面压着真正可编辑的 textarea -->
    <div
      class="relative min-h-[180px] flex-1 overflow-hidden rounded-lg border transition focus-within:border-emerald-500 sm:min-h-[240px] lg:min-h-0"
      :class="modelValue.trim() ? 'border-slate-200 bg-[#fbfcfd]' : 'border-transparent bg-white'"
    >
      <!--
        镜像层：纯装饰，对读屏器隐藏。
        右边缘内收一个滚动条宽度，和 textarea 的内容区对齐。
      -->
      <div
        ref="mirrorRef"
        class="mirror font-mono-code absolute inset-y-0 left-0 overflow-y-scroll p-3 text-base leading-relaxed break-words whitespace-pre-wrap text-transparent sm:text-sm"
        :style="{ right: `${scrollbarW}px` }"
        aria-hidden="true"
      >
        <span v-for="(line, i) in mirrorLines" :key="i" :class="{ 'line-hit': hitSet.has(i + 1) }"
          >{{ line }}{{ i < mirrorLines.length - 1 ? '\n' : '' }}</span
        >
      </div>

      <textarea
        ref="textareaRef"
        v-model="text"
        spellcheck="false"
        :maxlength="maxLength"
        placeholder="在这里粘贴代码，或选择下方示例开始体验……"
        class="font-mono-code absolute inset-0 h-full w-full resize-none border-0 bg-transparent p-3 text-base leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 sm:text-sm"
        @scroll.passive="syncScroll"
      />
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <span class="text-xs font-medium text-slate-500">试试示例：</span>
      <button
        v-for="s in SAMPLES"
        :key="s.label"
        class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
        @click="text = s.code"
      >
        {{ s.label }}
      </button>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="loading || imageReading"
        @click="pickImage"
      >
        <AppIcon v-if="!imageReading" name="upload" class="h-3.5 w-3.5" />
        <span
          v-else
          class="h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"
          aria-hidden="true"
        />
        {{ imageReading ? '正在识别截图…' : '上传代码截图' }}
      </button>
      <span class="text-[11px] text-slate-400">PNG / JPG / WebP，5 MB 以内</span>
    </div>
    <p v-if="imageError" class="mt-1.5 text-xs text-rose-600" role="alert">{{ imageError }}</p>
    <p v-else-if="imageHint" class="mt-1.5 text-xs text-emerald-700">{{ imageHint }}</p>

    <input
      ref="imageInputRef"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      class="hidden"
      @change="onImageChange"
    />

    <div class="mt-3 flex items-center justify-between gap-2">
      <span
        class="text-xs leading-relaxed transition-colors"
        :class="modelValue.length >= warnAt ? 'font-medium text-amber-600' : 'text-slate-400'"
      >
        支持最多 {{ maxLength.toLocaleString() }} 个字符
        <template v-if="modelValue.length >= warnAt">· 接近上限，建议只贴关键片段</template>
      </span>
      <button
        class="shrink-0 text-xs text-slate-500 transition hover:text-slate-700"
        @click="emit('clear')"
      >
        清空
      </button>
    </div>

    <button
      v-if="!loading"
      class="mt-3 w-full rounded-lg bg-emerald-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="!modelValue.trim()"
      @click="emit('analyze')"
    >
      开始解析
    </button>
    <p v-if="!loading && !modelValue.trim()" class="mt-2 text-center text-[11px] text-slate-400">
      先粘贴代码，或选一个示例
    </p>
    <button
      v-else-if="loading"
      class="mt-3 w-full rounded-lg border border-rose-300 px-5 py-3 text-sm text-rose-600 transition hover:bg-rose-50"
      @click="emit('stop')"
    >
      停止
    </button>
  </section>
</template>

<style scoped>
/*
 * 镜像层的滚动条要藏起来：它只是为了跟 textarea 的滚动位置同步，
 * 露出来会在输入框右侧压出一条多余的槽。
 */
.mirror {
  scrollbar-width: none;
}
.mirror::-webkit-scrollbar {
  display: none;
}

/* 命中的行：一条很淡的绿色背景带 */
.mirror .line-hit {
  background-color: rgb(16 185 129 / 16%);
  box-shadow: inset 2px 0 0 #10b981;
}
</style>
