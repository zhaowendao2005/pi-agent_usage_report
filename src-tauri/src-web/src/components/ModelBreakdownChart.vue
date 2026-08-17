<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3 flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-foreground">模型用量分布</h3>
        <p class="text-xs text-muted-foreground mt-0.5">
          堆叠条形 · Token 构成 · 计费单位 M
        </p>
      </div>
      <div class="flex shrink-0 rounded-md border border-border bg-muted/40 p-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="px-2 py-1 text-[11px] rounded transition-colors"
          :class="
            groupMode === tab.key
              ? 'bg-background text-foreground shadow-sm font-medium'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="groupMode = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- 顶部摘要 -->
    <div class="mb-3 grid grid-cols-4 gap-2">
      <div
        v-for="chip in typeChips"
        :key="chip.name"
        class="rounded-lg border border-border/60 px-2 py-1.5"
      >
        <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span class="h-1.5 w-1.5 rounded-full" :style="{ background: chip.color }" />
          {{ chip.name }}
        </div>
        <div class="mt-0.5 text-sm font-semibold tabular-nums" :style="{ color: chip.color }">
          {{ formatTokensM(chip.value) }}
        </div>
        <div class="text-[10px] text-muted-foreground">{{ chip.pct }}%</div>
      </div>
    </div>

    <v-chart :option="option" :style="{ height: '280px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import type { ModelUsage } from '@/stores/usage'
import { formatTokensM } from '@/lib/utils'

const { modelUsage } = storeToRefs(useUsageStore())

use([CanvasRenderer, BarChart, TooltipComponent, GridComponent, LegendComponent])

type GroupMode = 'provider' | 'model' | 'provider_model'

const tabs: { key: GroupMode; label: string }[] = [
  { key: 'provider', label: '提供商' },
  { key: 'model', label: '模型' },
  { key: 'provider_model', label: '提供商+模型' },
]

const groupMode = ref<GroupMode>('model')

const TOKEN_TYPES = [
  { key: 'cacheRead' as const, name: '缓存命中', color: '#22c55e' },
  { key: 'cacheWrite' as const, name: '缓存写入', color: '#f59e0b' },
  { key: 'input' as const, name: '输入', color: '#3b82f6' },
  { key: 'output' as const, name: '输出', color: '#a855f7' },
]

interface GroupSlice {
  name: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  total: number
}

function shortModel(name: string): string {
  let m = name.split('/').pop() ?? name
  m = m.replace(/^claude-/, '')
  m = m.replace(/-\d{6,8}$/, '')
  return m
}

function groupLabel(m: ModelUsage, mode: GroupMode): string {
  const model = shortModel(m.model || 'unknown')
  switch (mode) {
    case 'provider':
      return m.provider ?? '(未知提供商)'
    case 'model':
      return model
    case 'provider_model':
      return m.provider ? `${m.provider} / ${model}` : model
  }
}

const groups = computed<GroupSlice[]>(() => {
  const map = new Map<string, GroupSlice>()
  for (const row of modelUsage.value) {
    const name = groupLabel(row, groupMode.value)
    const prev = map.get(name) ?? {
      name,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      total: 0,
    }
    prev.input += row.inputTokens
    prev.output += row.outputTokens
    prev.cacheRead += row.cacheRead
    prev.cacheWrite += row.cacheWrite
    prev.cost += row.cost
    prev.total = prev.input + prev.output + prev.cacheRead + prev.cacheWrite
    map.set(name, prev)
  }
  return [...map.values()]
    .filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)
})

const totals = computed(() => {
  const g = groups.value
  return {
    input: g.reduce((a, x) => a + x.input, 0),
    output: g.reduce((a, x) => a + x.output, 0),
    cacheRead: g.reduce((a, x) => a + x.cacheRead, 0),
    cacheWrite: g.reduce((a, x) => a + x.cacheWrite, 0),
  }
})

const typeChips = computed(() => {
  const t = totals.value
  const sum = t.input + t.output + t.cacheRead + t.cacheWrite || 1
  return TOKEN_TYPES.map(tt => {
    const value =
      tt.key === 'cacheRead'
        ? t.cacheRead
        : tt.key === 'cacheWrite'
          ? t.cacheWrite
          : tt.key === 'input'
            ? t.input
            : t.output
    return {
      name: tt.name,
      color: tt.color,
      value,
      pct: ((value / sum) * 100).toFixed(1),
    }
  })
})

const option = computed(() => {
  const gs = groups.value
  const names = gs.map(g => g.name).reverse()
  const series = TOKEN_TYPES.map(tt => ({
    name: tt.name,
    type: 'bar' as const,
    stack: 'tok',
    barMaxWidth: 18,
    itemStyle: {
      color: tt.color,
      borderRadius: tt.key === 'output' ? [0, 4, 4, 0] : 0,
    },
    emphasis: { focus: 'series' as const },
    data: gs
      .map(g =>
        tt.key === 'cacheRead'
          ? g.cacheRead
          : tt.key === 'cacheWrite'
            ? g.cacheWrite
            : tt.key === 'input'
              ? g.input
              : g.output,
      )
      .reverse(),
  }))

  const costByName = new Map(gs.map(g => [g.name, g.cost]))

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any[]) => {
        if (!params?.length) return ''
        const name = params[0].axisValue as string
        const cost = costByName.get(name) ?? 0
        const sum = params.reduce((a, p) => a + (Number(p.value) || 0), 0)
        const rows = params
          .filter(p => Number(p.value) > 0)
          .map(
            p =>
              `<div style="display:flex;justify-content:space-between;gap:18px">
                <span style="color:${p.color}">● ${p.seriesName}</span>
                <span style="font-weight:600">${formatTokensM(Number(p.value))}</span>
              </div>`,
          )
          .join('')
        return (
          `<div style="font-weight:600;margin-bottom:4px">${name}</div>` +
          `<div style="color:#64748b;font-size:11px;margin-bottom:6px">合计 ${formatTokensM(sum)} · $${cost.toFixed(4)}</div>` +
          rows
        )
      },
    },
    legend: {
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#64748b', fontSize: 11 },
      data: TOKEN_TYPES.map(t => t.name),
    },
    grid: {
      top: 8,
      right: 16,
      bottom: 36,
      left: 8,
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        formatter: (v: number) => formatTokensM(v, 2),
      },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        width: 100,
        overflow: 'truncate',
      },
    },
    series,
  }
})
</script>
