<template>
  <div class="space-y-4">
    <div class="bg-card border border-border rounded-lg overflow-hidden">
      <div class="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 class="text-sm font-semibold text-foreground">调用明细</h3>
        <span class="text-xs text-muted-foreground">{{ rows.length }} 条记录</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-border">
              <th v-for="col in columns" :key="col.key"
                class="px-4 py-2.5 text-left text-muted-foreground font-medium whitespace-nowrap">
                {{ col.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="i"
              class="border-b border-border/50 hover:bg-accent/30 transition-colors">
              <td class="px-4 py-2.5 font-mono text-muted-foreground">{{ row.time }}</td>
              <td class="px-4 py-2.5">
                <span class="px-1.5 py-0.5 rounded text-xs font-mono"
                  :style="{ background: modelColor(row.model) + '22', color: modelColor(row.model) }">
                  {{ row.model }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-right font-mono text-blue-600">{{ row.input.toLocaleString() }}</td>
              <td class="px-4 py-2.5 text-right font-mono text-purple-600">{{ row.output.toLocaleString() }}</td>
              <td class="px-4 py-2.5 text-right font-mono text-green-600">{{ row.cacheRead.toLocaleString() }}</td>
              <td class="px-4 py-2.5 text-right font-mono text-amber-600">{{ row.cacheWrite.toLocaleString() }}</td>
              <td class="px-4 py-2.5 text-right font-mono text-cyan-600">{{ row.ttft }}</td>
              <td class="px-4 py-2.5 text-right font-mono text-sky-600">{{ row.tpsGen }}</td>
              <td class="px-4 py-2.5 text-right font-mono text-foreground">${{ row.cost.toFixed(5) }}</td>
              <td class="px-4 py-2.5 text-right">
                <span :class="hitRateClass(row.cacheRead, row.input)">
                  {{ hitRate(row.cacheRead, row.input) }}%
                </span>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="10" class="px-4 py-8 text-center text-muted-foreground">暂无数据</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { series } = storeToRefs(useUsageStore())

const MODEL_COLORS = [
  '#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#14b8a6',
]

function modelColor(m: string) {
  let h = 0
  for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0
  return MODEL_COLORS[h % MODEL_COLORS.length]
}

const columns = [
  { key: 'time',       label: '时间戳' },
  { key: 'model',      label: '模型' },
  { key: 'input',      label: '输入 Token' },
  { key: 'output',     label: '输出 Token' },
  { key: 'cacheRead',  label: '缓存读' },
  { key: 'cacheWrite', label: '缓存写' },
  { key: 'ttft',       label: 'TTFT' },
  { key: 'tpsGen',     label: 'TPS(纯生成)' },
  { key: 'cost',       label: '费用 (USD)' },
  { key: 'hitRate',    label: '缓存命中率' },
]

const rows = computed(() =>
  series.value.map(d => ({
    time: d.time,
    model: d.model || 'unknown',
    input: d.inputTokens,
    output: d.outputTokens,
    cacheRead: d.cacheRead,
    cacheWrite: d.cacheWrite,
    ttft: d.ttftMs != null ? `${d.ttftMs}ms` : '—',
    tpsGen: d.tpsGen ? d.tpsGen.toFixed(1) : '—',
    cost: d.totalCost,
  }))
)

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
