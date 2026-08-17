<template>
  <div class="space-y-4">
    <div class="bg-card border border-border rounded-lg overflow-hidden">
      <!-- Header Bar -->
      <div class="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-foreground">调用明细</h3>
          <p class="text-[11px] text-muted-foreground mt-0.5">
            可点击表头排序 · 虚拟滚动 · 右键记录可进行删除
            <span v-if="errorCount > 0" class="text-red-500 ml-1">· {{ errorCount }} 失败</span>
          </p>
        </div>
        <span class="text-xs text-muted-foreground shrink-0">{{ rows.length.toLocaleString() }} 条记录</span>
      </div>

      <!-- Horizontal scroll wraps sticky header + virtual body -->
      <div class="overflow-x-auto" @contextmenu.prevent>
        <div :style="{ minWidth: `${tableMinWidth}px` }">
          <!-- Sticky Header with Sort toggles -->
          <div
            class="grid border-b border-border bg-card sticky top-0 z-10 select-none"
            :style="gridStyle"
          >
            <div
              v-for="col in columns"
              :key="col.key"
              @click="toggleSort(col.key)"
              class="px-3 py-2.5 text-[11px] text-muted-foreground font-medium whitespace-nowrap cursor-pointer hover:bg-accent/50 transition-colors flex items-center gap-1"
              :class="col.align === 'right' ? 'justify-end text-right' : 'justify-start text-left'"
            >
              <span>{{ col.label }}</span>
              <span v-if="sortKey === col.key" class="text-[10px] text-foreground font-bold shrink-0">
                {{ sortOrder === 'asc' ? '▲' : '▼' }}
              </span>
              <span v-else class="text-[9px] text-muted-foreground/30 opacity-0 hover:opacity-100 transition-opacity shrink-0">
                ▲
              </span>
            </div>
          </div>

          <!-- Virtual viewport (visible when not sorting) -->
          <div
            v-if="!isSorting"
            ref="viewportEl"
            class="overflow-y-auto relative"
            :style="{ height: `${viewportHeight}px` }"
            @scroll="onScroll"
          >
            <div v-if="rows.length === 0" class="px-4 py-10 text-center text-sm text-muted-foreground">
              暂无数据
            </div>

            <div v-else :style="{ height: `${totalHeight}px`, position: 'relative' }">
              <div
                class="absolute left-0 right-0"
                :style="{ transform: `translateY(${offsetY}px)` }"
              >
                <div
                  v-for="row in visibleRows"
                  :key="row._key"
                  class="grid border-b border-border/50 hover:bg-accent/30 transition-colors items-center text-xs"
                  :class="row.failed ? 'bg-red-50/40' : ''"
                  :style="{ ...gridStyle, height: `${ROW_HEIGHT}px` }"
                  @contextmenu.prevent="onRowContextMenu($event, row)"
                >
                  <div class="px-3 font-mono text-muted-foreground truncate" :title="row.time">
                    {{ row.time }}
                  </div>
                  <div class="px-3 truncate">
                    <span
                      v-if="row.provider"
                      class="px-1.5 py-0.5 rounded text-[11px] font-mono"
                      :style="{ background: modelColor(row.provider) + '22', color: modelColor(row.provider) }"
                    >{{ row.provider }}</span>
                    <span v-else class="text-muted-foreground">—</span>
                  </div>
                  <div class="px-3 truncate">
                    <span
                      class="px-1.5 py-0.5 rounded text-[11px] font-mono"
                      :style="{ background: modelColor(row.model) + '22', color: modelColor(row.model) }"
                      :title="row.model"
                    >{{ row.model }}</span>
                  </div>
                  <div class="px-3 text-right font-mono text-blue-600" :title="String(row.input)">{{ fmt(row.input) }}</div>
                  <div class="px-3 text-right font-mono text-purple-600" :title="String(row.output)">{{ fmt(row.output) }}</div>
                  <div class="px-3 text-right font-mono text-green-600" :title="String(row.cacheRead)">{{ fmt(row.cacheRead) }}</div>
                  <div class="px-3 text-right font-mono text-amber-600" :title="String(row.cacheWrite)">{{ fmt(row.cacheWrite) }}</div>
                  <div class="px-3 text-right font-mono text-violet-600">{{ row.ttft }}</div>
                  <div class="px-3 text-right font-mono text-pink-600">{{ row.duration }}</div>
                  <div class="px-3 text-right font-mono text-cyan-600">{{ row.tpsTotal }}</div>
                  <div class="px-3 text-right font-mono text-sky-600">{{ row.tpsGen }}</div>
                  <div class="px-3 text-right font-mono text-red-600">${{ row.cost.toFixed(5) }}</div>
                  <div class="px-3 text-right">
                    <span :class="hitRateClass(row.cacheRead, row.input)">
                      {{ hitRate(row.cacheRead, row.input) }}%
                    </span>
                  </div>
                  <div class="px-3 text-right">
                    <span
                      class="font-mono font-semibold"
                      :class="statusClass(row)"
                      :title="statusTitle(row)"
                    >{{ statusLabel(row) }}</span>
                  </div>
                  <div class="px-3 truncate" :title="row.stopReason || ''">
                    <span class="text-xs" :class="row.failed ? 'text-red-600 font-medium' : 'text-muted-foreground'">
                      {{ row.stopReason || '—' }}
                    </span>
                  </div>
                  <div class="px-3 truncate" :title="row.errorMessage || ''">
                    <span class="text-xs text-red-600">
                      {{ row.errorMessage || '—' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Skeleton Viewport (shows during sorting for pure UX and non-blocking layout feel) -->
          <div v-else class="overflow-y-auto" :style="{ height: `${viewportHeight}px` }">
            <div
              v-for="i in 12"
              :key="i"
              class="grid border-b border-border/40 items-center bg-card animate-pulse"
              :style="{ ...gridStyle, height: `${ROW_HEIGHT}px` }"
            >
              <div v-for="col in columns" :key="col.key" class="px-3">
                <div
                  class="h-3 bg-muted rounded"
                  :class="col.align === 'right' ? 'ml-auto' : ''"
                  :style="{ width: `${col.width * 0.5}px` }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <!-- Elegant Mini Right-click Context Menu -->
      <div
        v-if="contextMenu.show"
        :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
        class="fixed z-50 w-32 bg-popover border border-border rounded shadow-lg py-1 text-xs text-foreground animate-fade-in"
      >
        <button
          type="button"
          class="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-sm text-left transition-colors cursor-pointer"
          @click="deleteSelectedCall"
        >
          <Trash2Icon class="w-3.5 h-3.5 shrink-0" />
          <span class="font-medium">删除这条记录</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import { formatTokensM, fmtSec, recomputeTps } from '@/lib/utils'
import { Trash2Icon } from 'lucide-vue-next'
import { useMessage } from '@/lib/message'

const message = useMessage()

const usageStore = useUsageStore()
const { series, summary } = storeToRefs(usageStore)
const errorCount = computed(() => summary.value.errorCount)

const MODEL_COLORS = [
  '#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#14b8a6',
]

function modelColor(m: string) {
  let h = 0
  for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0
  return MODEL_COLORS[h % MODEL_COLORS.length]
}

const columns = [
  { key: 'time', label: '时间戳', align: 'left' as const, width: 150 },
  { key: 'provider', label: '提供商', align: 'left' as const, width: 100 },
  { key: 'model', label: '模型', align: 'left' as const, width: 140 },
  { key: 'input', label: '输入 Token', align: 'right' as const, width: 90 },
  { key: 'output', label: '输出 Token', align: 'right' as const, width: 90 },
  { key: 'cacheRead', label: '缓存读取', align: 'right' as const, width: 90 },
  { key: 'cacheWrite', label: '缓存写入', align: 'right' as const, width: 90 },
  { key: 'ttft', label: '首字延迟', align: 'right' as const, width: 85 },
  { key: 'duration', label: '总耗时', align: 'right' as const, width: 85 },
  { key: 'tpsTotal', label: 'TPS(含首字)', align: 'right' as const, width: 95 },
  { key: 'tpsGen', label: 'TPS(纯生成)', align: 'right' as const, width: 95 },
  { key: 'cost', label: '费用 (USD)', align: 'right' as const, width: 95 },
  { key: 'hitRate', label: '缓存命中率', align: 'right' as const, width: 90 },
  { key: 'status', label: 'HTTP 状态', align: 'right' as const, width: 85 },
  { key: 'stopReason', label: '停止原因', align: 'left' as const, width: 100 },
  { key: 'error', label: '错误信息', align: 'left' as const, width: 200 },
]

const tableMinWidth = columns.reduce((a, c) => a + c.width, 0)
const gridStyle = {
  gridTemplateColumns: columns.map(c => `${c.width}px`).join(' '),
}

const ROW_HEIGHT = 40
const OVERSCAN = 8
const viewportHeight = 520

const viewportEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
/** rAF throttle */
let raf = 0

// Sorting states
const sortKey = ref<string>('time')
const sortOrder = ref<'asc' | 'desc'>('desc')
const isSorting = ref<boolean>(false)
const sortedRows = ref<DetailRow[]>([])

const rows = computed<DetailRow[]>(() => sortedRows.value)

const totalHeight = computed(() => rows.value.length * ROW_HEIGHT)

const startIndex = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN),
)

const endIndex = computed(() => {
  const visible = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
  return Math.min(rows.value.length, startIndex.value + visible)
})

const offsetY = computed(() => startIndex.value * ROW_HEIGHT)

const visibleRows = computed(() => rows.value.slice(startIndex.value, endIndex.value))

function onScroll(e: Event) {
  closeContextMenu()
  const el = e.target as HTMLElement
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    scrollTop.value = el.scrollTop
    raf = 0
  })
}

interface DetailRow {
  id: number
  _key: string
  time: string
  provider: string | null
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  ttft: string
  duration: string
  tpsTotal: string
  tpsGen: string
  cost: number
  httpStatus: number | null
  stopReason: string | null
  errorMessage: string | null
  failed: boolean
  // Pre-mapped comparative metrics for optimal sorting
  rawTtft: number
  rawDuration: number
  rawTpsTotal: number
  rawTpsGen: number
}

function isFailed(httpStatus: number | null, stopReason: string | null): boolean {
  if (httpStatus != null && (httpStatus < 200 || httpStatus >= 300)) return true
  if (stopReason === 'error' || stopReason === 'aborted') return true
  return false
}

/** Optimized Schwartzian Transform Asynchronous Sorting so it never freezes main thread */
async function performSort(showSkeleton = false) {
  if (showSkeleton) {
    isSorting.value = true
    // Give browser event loop 50ms breathing room to cleanly render skeleton
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  const rawList: DetailRow[] = series.value.map((d, i) => {
    const tpsInfo = recomputeTps(d)
    return {
      id: d.id,
      _key: `${d.time}_${d.model}_${i}`,
      time: d.time,
      provider: d.provider,
      model: d.model || 'unknown',
      input: d.inputTokens,
      output: d.outputTokens,
      cacheRead: d.cacheRead,
      cacheWrite: d.cacheWrite,
      ttft: fmtSec(d.ttftMs),
      duration: fmtSec(d.durationMs),
      tpsTotal: tpsInfo.tpsTotal > 0 ? tpsInfo.tpsTotal.toFixed(1) : '—',
      tpsGen: tpsInfo.tpsGen > 0 ? tpsInfo.tpsGen.toFixed(1) : '—',
      cost: d.totalCost,
      httpStatus: d.httpStatus,
      stopReason: d.stopReason,
      errorMessage: d.errorMessage,
      failed: isFailed(d.httpStatus, d.stopReason),
      rawTtft: d.ttftMs ?? -1,
      rawDuration: d.durationMs ?? -1,
      rawTpsTotal: tpsInfo.tpsTotal,
      rawTpsGen: tpsInfo.tpsGen,
    }
  })

  const key = sortKey.value
  const order = sortOrder.value

  // Map key-values for Schwartzian transform to run at extreme speeds
  const mapped = rawList.map((item, index) => {
    let val: any
    switch (key) {
      case 'time':
        val = item.time
        break
      case 'provider':
        val = item.provider || ''
        break
      case 'model':
        val = item.model || ''
        break
      case 'input':
        val = item.input
        break
      case 'output':
        val = item.output
        break
      case 'cacheRead':
        val = item.cacheRead
        break
      case 'cacheWrite':
        val = item.cacheWrite
        break
      case 'ttft':
        val = item.rawTtft
        break
      case 'duration':
        val = item.rawDuration
        break
      case 'tpsTotal':
        val = item.rawTpsTotal
        break
      case 'tpsGen':
        val = item.rawTpsGen
        break
      case 'cost':
        val = item.cost
        break
      case 'hitRate': {
        const total = item.input + item.cacheRead
        val = total > 0 ? (item.cacheRead / total) : 0
        break
      }
      case 'status':
        val = item.httpStatus ?? -1
        break
      case 'stopReason':
        val = item.stopReason || ''
        break
      case 'error':
        val = item.errorMessage || ''
        break
      default:
        val = item.time
    }
    return { index, value: val, item }
  })

  // Standard optimized Timsort/Quicksort
  mapped.sort((a, b) => {
    const va = a.value
    const vb = b.value
    if (va === vb) return 0
    if (va === null || va === undefined || va === -1) return order === 'asc' ? 1 : -1
    if (vb === null || vb === undefined || vb === -1) return order === 'asc' ? -1 : 1

    if (typeof va === 'string' && typeof vb === 'string') {
      return va.localeCompare(vb)
    }
    return va < vb ? -1 : 1
  })

  let finalResult = mapped.map(x => x.item)
  if (order === 'desc') {
    finalResult = finalResult.reverse()
  }

  sortedRows.value = finalResult
  isSorting.value = false
}

// Watch store series to update sorted rows in background on updates
watch(() => series.value, () => {
  void performSort(false)
}, { immediate: true })

async function toggleSort(key: string) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    // Default descending for numeric metrics / time, ascending for names
    sortOrder.value = ['provider', 'model', 'stopReason', 'error'].includes(key) ? 'asc' : 'desc'
  }
  await performSort(true)
}

// Compact context menu logic
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  rowId: null as number | null,
})

function onRowContextMenu(e: MouseEvent, row: DetailRow) {
  contextMenu.value = {
    show: true,
    x: e.clientX,
    y: e.clientY,
    rowId: row.id,
  }

  // Bind close on click away
  document.addEventListener('click', closeContextMenu, { once: true })
}

function closeContextMenu() {
  contextMenu.value.show = false
}

async function deleteSelectedCall() {
  const id = contextMenu.value.rowId
  closeContextMenu()
  if (id == null) return

  const ok = await message.confirm({
    title: '删除记录',
    message: '确定要永久删除这条 LLM 调用记录吗？此操作无法撤销。',
    confirmText: '永久删除',
    cancelText: '取消',
    danger: true,
  })
  if (!ok) return

  try {
    await usageStore.deleteCall(id)
    message.success('记录已删除')
  } catch (err) {
    message.error('删除失败: ' + String(err))
  }
}

onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf)
  document.removeEventListener('click', closeContextMenu)
})

function fmt(n: number) {
  return formatTokensM(n)
}

function statusLabel(row: DetailRow): string {
  if (row.httpStatus != null) return String(row.httpStatus)
  if (row.stopReason === 'error' || row.stopReason === 'aborted') return row.stopReason
  if (row.stopReason) return 'ok'
  return '—'
}

function statusClass(row: DetailRow): string {
  if (row.failed) return 'text-red-600'
  if (row.httpStatus != null && row.httpStatus >= 200 && row.httpStatus < 300) return 'text-green-600'
  if (row.stopReason && row.stopReason !== 'error' && row.stopReason !== 'aborted') return 'text-green-600'
  return 'text-muted-foreground'
}

function statusTitle(row: DetailRow): string {
  const parts: string[] = []
  if (row.httpStatus != null) parts.push(`HTTP ${row.httpStatus}`)
  if (row.stopReason) parts.push(`stop: ${row.stopReason}`)
  if (row.errorMessage) parts.push(row.errorMessage)
  return parts.join('\n') || '无状态信息（旧数据）'
}

function hitRate(read: number, input: number) {
  return input + read > 0 ? +((read / (read + input)) * 100).toFixed(1) : 0
}

function hitRateClass(read: number, input: number) {
  const r = hitRate(read, input)
  if (r >= 50) return 'text-green-600'
  if (r >= 25) return 'text-amber-600'
  return 'text-muted-foreground'
}
</script>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.animate-fade-in {
  animation: fadeIn 0.08s ease-out;
}
</style>
