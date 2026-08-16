<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <div>
        <h3 class="text-sm font-semibold text-foreground">Token 使用趋势</h3>
        <p class="text-xs text-muted-foreground mt-0.5">上下游 token、缓存、TPS 与费用随时间变化</p>
      </div>
    </div>

    <!-- Clickable legend -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-2 text-xs">
      <span
        v-for="item in legend"
        :key="item.name"
        class="flex items-center gap-1.5 cursor-pointer select-none transition-all rounded px-1.5 py-0.5 hover:bg-accent/60"
        :class="hidden.has(item.name) ? 'opacity-35 line-through' : ''"
        @click="toggleLegend(item.name)"
        :title="hidden.has(item.name) ? `显示 ${item.name}` : `隐藏 ${item.name}`"
      >
        <span class="w-3 h-0.5 rounded-full inline-block" :style="{ background: item.color }" />
        {{ item.name }}
      </span>
    </div>

    <!-- notMerge:false 强制 merge 模式：computed option 每次刷新都是新对象引用，
         vue-echarts 默认会 notMerge:true 全量重建图表，导致 dataZoom 缩放状态被重置回全量 -->
    <v-chart :option="option" :style="{ height: '280px' }" autoresize :update-options="{ notMerge: false }" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, DataZoomComponent,
} from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { series } = storeToRefs(useUsageStore())

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, DataZoomComponent])

const legend = [
  { name: '输入 Token', color: '#3b82f6', axis: 0 },
  { name: '输出 Token', color: '#a855f7', axis: 0 },
  { name: '缓存读取',   color: '#22c55e', axis: 0 },
  { name: '缓存写入',   color: '#f59e0b', axis: 0 },
  { name: 'TPS(含首字)', color: '#06b6d4', axis: 1 },
  { name: 'TPS(纯生成)', color: '#0ea5e9', axis: 1 },
  { name: '费用/点',    color: '#ef4444', axis: 2 },
]

// series that can be toggled off by clicking legend
const hidden = ref<Set<string>>(new Set())

function toggleLegend(name: string) {
  const next = new Set(hidden.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  hidden.value = next
}

const times = computed(() => series.value.map(d => d.time))

const baseSeries = computed(() => {
  const s = series.value
  return [
    {
      key: '输入 Token',
      series: {
        name: '输入 Token', type: 'line', smooth: true, yAxisIndex: 0, id: 'input',
        data: s.map(d => d.inputTokens),
        lineStyle: { color: '#3b82f6', width: 2 },
        itemStyle: { color: '#3b82f6' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(59,130,246,0.18)' }, { offset: 1, color: 'rgba(59,130,246,0.01)' }]
        }},
        symbol: 'none',
      },
    },
    {
      key: '输出 Token',
      series: {
        name: '输出 Token', type: 'line', smooth: true, yAxisIndex: 0, id: 'output',
        data: s.map(d => d.outputTokens),
        lineStyle: { color: '#a855f7', width: 2 },
        itemStyle: { color: '#a855f7' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(168,85,247,0.13)' }, { offset: 1, color: 'rgba(168,85,247,0.01)' }]
        }},
        symbol: 'none',
      },
    },
    {
      key: '缓存读取',
      series: {
        name: '缓存读取', type: 'line', smooth: true, yAxisIndex: 0, id: 'cache-read',
        data: s.map(d => d.cacheRead),
        lineStyle: { color: '#22c55e', width: 1.5, type: 'dashed' },
        itemStyle: { color: '#22c55e' },
        symbol: 'none',
      },
    },
    {
      key: '缓存写入',
      series: {
        name: '缓存写入', type: 'line', smooth: true, yAxisIndex: 0, id: 'cache-write',
        data: s.map(d => d.cacheWrite),
        lineStyle: { color: '#f59e0b', width: 1.5, type: 'dashed' },
        itemStyle: { color: '#f59e0b' },
        symbol: 'none',
      },
    },
    {
      key: 'TPS(含首字)',
      series: {
        name: 'TPS(含首字)', type: 'line', smooth: true, yAxisIndex: 1, id: 'tps-total',
        data: s.map(d => d.tpsTotal ?? d.tps ?? 0),
        lineStyle: { color: '#06b6d4', width: 2 },
        itemStyle: { color: '#06b6d4' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(6,182,212,0.14)' }, { offset: 1, color: 'rgba(6,182,212,0.01)' }]
        }},
        symbol: 'none',
      },
    },
    {
      key: 'TPS(纯生成)',
      series: {
        name: 'TPS(纯生成)', type: 'line', smooth: true, yAxisIndex: 1, id: 'tps-gen',
        data: s.map(d => d.tpsGen ?? d.tps ?? 0),
        lineStyle: { color: '#0ea5e9', width: 2, type: 'dashed' },
        itemStyle: { color: '#0ea5e9' },
        symbol: 'none',
      },
    },
    {
      key: '费用/点',
      series: {
        name: '费用/点', type: 'line', smooth: true, yAxisIndex: 2, id: 'cost',
        data: s.map(d => d.totalCost),
        lineStyle: { color: '#ef4444', width: 1.5, type: 'dotted' },
        itemStyle: { color: '#ef4444' },
        symbol: 'circle', symbolSize: 3,
      },
    },
  ]
})

const option = computed(() => {
  const timesArr = times.value
  const all = baseSeries.value
  const visible = all.filter(s => !hidden.value.has(s.key)).map(s => s.series)

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      axisPointer: { type: 'cross', crossStyle: { color: 'rgba(0,0,0,0.2)' } },
      valueFormatter: (v: any) => {
        if (typeof v !== 'number') return String(v)
        if (v > 0 && v < 1) return '$' + v.toFixed(4)
        return Number(v).toLocaleString()
      },
      formatter(params: any[]) {
        const head = `<div style="color:#64748b;margin-bottom:6px;font-size:11px">${params[0].axisValue}</div>`
        const rows = params.map((p: any) =>
          `<div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:${p.color}">● ${p.seriesName}</span>
            <span style="font-weight:600">${typeof p.value === 'number' && p.value > 0 && p.value < 1 ? '$' + p.value.toFixed(4) : Number(p.value).toLocaleString()}</span>
          </div>`
        ).join('')
        return head + rows
      },
    },
    legend: { show: false },
    grid: { top: 10, right: 132, bottom: 40, left: 60, containLabel: false },
    xAxis: {
      type: 'category',
      data: timesArr,
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#64748b', fontSize: 10,
        formatter: (v: string) => v.slice(11, 16),
        interval: Math.floor(timesArr.length / 8),
      },
    },
    yAxis: [
      {
        // left: tokens
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
        axisLabel: {
          color: '#64748b', fontSize: 10,
          formatter: (v: number) => v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v,
        },
        name: 'Tokens',
        nameTextStyle: { color: '#94a3b8', fontSize: 10, padding: [0, 0, 0, -40] },
      },
      {
        // right: TPS
        type: 'value',
        position: 'right',
        splitLine: { show: false },
        axisLine: { lineStyle: { color: 'rgba(6,182,212,0.4)' } },
        axisLabel: { color: '#0891b2', fontSize: 10 },
        name: 'TPS',
        nameTextStyle: { color: '#0891b2', fontSize: 10, padding: [0, 0, 0, 8] },
      },
      {
        // right offset: cost
        type: 'value',
        position: 'right',
        offset: 60,
        splitLine: { show: false },
        axisLine: { lineStyle: { color: 'rgba(239,68,68,0.4)' } },
        axisLabel: { color: '#dc2626', fontSize: 10, formatter: (v: number) => '$' + v.toFixed(3) },
        name: 'USD',
        nameTextStyle: { color: '#dc2626', fontSize: 10, padding: [0, 0, 0, 8] },
      },
    ],
    dataZoom: [{
      type: 'inside',
      // 注意：不要写死 start/end。computed option 会随 LIVE 刷新/图例切换重算并 setOption，
      // 一旦带上 start/end，ECharts merge 时就会覆盖用户手动缩放的窗口，导致“缩放自己回正”。
    }, {
      type: 'slider',
      height: 20,
      bottom: 0,
      borderColor: 'transparent',
      backgroundColor: 'rgba(0,0,0,0.03)',
      fillerColor: 'rgba(59,130,246,0.12)',
      handleStyle: { color: '#3b82f6' },
      textStyle: { color: '#64748b', fontSize: 10 },
    }],
    series: visible,
  }
})
</script>
