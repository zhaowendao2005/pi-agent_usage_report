<template>
  <div class="space-y-4">
    <div class="bg-card border border-border rounded-lg overflow-hidden">
      <div class="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-foreground">调用明细</h3>
          <p class="text-[11px] text-muted-foreground mt-0.5">
            最新在前 · 虚拟滚动
            <span v-if="errorCount > 0" class="text-red-500 ml-1">· {{ errorCount }} 失败</span>
          </p>
        </div>
        <span class="text-xs text-muted-foreground shrink-0">{{ rows.length.toLocaleString() }} 条记录</span>
      </div>

      <!-- Horizontal scroll wraps sticky header + virtual body -->
      <div class="overflow-x-auto">
        <div :style="{ minWidth: `${tableMinWidth}px` }">
          <!-- Header -->
          <div
            class="grid border-b border-border bg-card sticky top-0 z-10"
            :style="gridStyle"
          >
            <div
              v-for="col in columns"
              :key="col.key"
              class="px-3 py-2.5 text-[11px] text-muted-foreground font-medium whitespace-nowrap"
              :class="col.align === 'right' ? 'text-right' : 'text-left'"
            >
              {{ col.label }}
            </div>
          </div>

          <!-- Virtual viewport -->
          <div
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
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import { formatTokensM, fmtSec, recomputeTps } from '@/lib/utils'

const { series, summary } = storeToRefs(useUsageStore())
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

function onScroll(e: Event) {
  const el = e.target as HTMLElement
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    scrollTop.value = el.scrollTop
    raf = 0
  })
}

interface DetailRow {
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
}

function isFailed(httpStatus: number | null, stopReason: string | null): boolean {
  if (httpStatus != null && (httpStatus < 200 || httpStatus >= 300)) return true
  if (stopReason === 'error' || stopReason === 'aborted') return true
  return false
}

/** Newest first (time desc). "YYYY-MM-DD HH:mm:ss" sorts lexicographically. */
const rows = computed<DetailRow[]>(() => {
  const list = series.value.map((d, i) => ({
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
    tpsTotal: (() => { const t = recomputeTps(d); return t.tpsTotal > 0 ? t.tpsTotal.toFixed(1) : '—' })(),
    tpsGen: (() => { const t = recomputeTps(d); return t.tpsGen > 0 ? t.tpsGen.toFixed(1) : '—' })(),
    cost: d.totalCost,
    httpStatus: d.httpStatus,
    stopReason: d.stopReason,
    errorMessage: d.errorMessage,
    failed: isFailed(d.httpStatus, d.stopReason),
  }))
  // series is ASC from API; reverse for newest-first without mutating store
  return list.slice().reverse()
})

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

onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf)
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
