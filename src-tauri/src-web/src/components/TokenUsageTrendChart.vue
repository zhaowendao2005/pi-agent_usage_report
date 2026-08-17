<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="flex items-start justify-between gap-2 mb-2">
      <div>
        <h3 class="text-sm font-semibold text-foreground">Token 用量趋势</h3>
        <p class="text-xs text-muted-foreground mt-0.5">输入 / 输出 / 缓存 · 缓存命中率 · Token 用 M</p>
      </div>
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-[11px]">
      <button
        v-for="item in legend"
        :key="item.name"
        type="button"
        class="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-all hover:bg-accent/60"
        :class="hidden.has(item.name) ? 'opacity-35 line-through' : ''"
        @click="toggle(item.name)"
      >
        <span class="h-0.5 w-3 rounded-full" :style="{ background: item.color }" />
        {{ item.name }}
      </button>
    </div>
    <v-chart
      :option="option"
      :style="{ height: '260px' }"
      autoresize
      :update-options="{ notMerge: false, replaceMerge: ['series'] }"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import { formatTokenAxis, formatTokensM, buildFullPointTooltip, type TrendTooltipMode } from '@/lib/utils'

const props = withDefaults(defineProps<{ tooltipMode?: TrendTooltipMode }>(), {
  tooltipMode: 'all',
})

const { series } = storeToRefs(useUsageStore())
use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, DataZoomComponent])

const legend = [
  { name: '输入', color: '#3b82f6' },
  { name: '输出', color: '#a855f7' },
  { name: '缓存读', color: '#22c55e' },
  { name: '缓存写', color: '#f59e0b' },
  { name: '缓存命中率', color: '#14b8a6' },
]
const hidden = ref(new Set<string>())
function toggle(name: string) {
  const n = new Set(hidden.value)
  n.has(name) ? n.delete(name) : n.add(name)
  hidden.value = n
}

const option = computed(() => {
  void props.tooltipMode
  const s = series.value
  const times = s.map(d => d.time)
  const hitRate = s.map(d => {
    const den = d.inputTokens + d.cacheRead
    return den > 0 ? +((d.cacheRead / den) * 100).toFixed(2) : 0
  })

  const tokenDefs = [
    {
      name: '输入', color: '#3b82f6', id: 'input', yAxisIndex: 0,
      data: s.map(d => d.inputTokens),
      area: 'rgba(59,130,246,0.12)',
    },
    {
      name: '输出', color: '#a855f7', id: 'output', yAxisIndex: 0,
      data: s.map(d => d.outputTokens),
      area: 'rgba(168,85,247,0.10)',
    },
    {
      name: '缓存读', color: '#22c55e', id: 'cr', yAxisIndex: 0,
      data: s.map(d => d.cacheRead),
      dashed: true,
    },
    {
      name: '缓存写', color: '#f59e0b', id: 'cw', yAxisIndex: 0,
      data: s.map(d => d.cacheWrite),
      dashed: true,
    },
    {
      name: '缓存命中率', color: '#14b8a6', id: 'hit', yAxisIndex: 1,
      data: hitRate,
      // 下方填充
      area: 'rgba(20,184,166,0.28)',
      areaBottom: 'rgba(20,184,166,0.02)',
      width: 2.5,
    },
  ].filter(d => !hidden.value.has(d.name))

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any[]) => {
        const idx = params[0]?.dataIndex
        const p = idx != null ? s[idx] : null
        if (!p) return ''
        if (props.tooltipMode === 'all') {
          const base = buildFullPointTooltip(p, params[0].axisValue)
          const den = p.inputTokens + p.cacheRead
          const rate = den > 0 ? ((p.cacheRead / den) * 100).toFixed(1) + '%' : '—'
          return base +
            `<div style="display:flex;justify-content:space-between;gap:20px;margin-top:2px">
              <span style="color:#14b8a6">● 缓存命中率</span>
              <span style="font-weight:600">${rate}</span>
            </div>`
        }
        const model = p.provider ? `${p.provider}/${p.model}` : p.model
        const head = `<div style="color:#3b82f6;font-weight:600;font-size:11px;margin-bottom:4px">${model}</div>`
        const t = `<div style="color:#64748b;font-size:11px;margin-bottom:6px">${params[0].axisValue}</div>`
        const rows = params.map((x: any) => {
          const isRate = x.seriesName === '缓存命中率'
          const val = isRate
            ? Number(x.value).toFixed(1) + '%'
            : formatTokensM(Number(x.value))
          return `<div style="display:flex;justify-content:space-between;gap:18px">
            <span style="color:${x.color}">● ${x.seriesName}</span>
            <span style="font-weight:600">${val}</span>
          </div>`
        }).join('')
        return head + t + rows
      },
    },
    grid: { top: 12, right: 48, bottom: 40, left: 8, containLabel: true },
    xAxis: {
      type: 'category', data: times,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
      axisLabel: {
        color: '#64748b', fontSize: 10,
        formatter: (v: string) => v.slice(11, 16),
        interval: Math.floor(times.length / 8),
      },
    },
    yAxis: [
      {
        type: 'value', name: 'Token',
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
        axisLabel: { color: '#64748b', fontSize: 10, formatter: formatTokenAxis },
      },
      {
        type: 'value', name: '命中率',
        min: 0, max: 100,
        position: 'right',
        nameTextStyle: { color: '#0d9488', fontSize: 10 },
        splitLine: { show: false },
        axisLine: { lineStyle: { color: 'rgba(20,184,166,0.35)' } },
        axisLabel: {
          color: '#0d9488', fontSize: 10,
          formatter: (v: number) => v + '%',
        },
      },
    ],
    dataZoom: [
      { type: 'inside' },
      {
        type: 'slider', height: 16, bottom: 2, borderColor: 'transparent',
        backgroundColor: 'rgba(0,0,0,0.03)', fillerColor: 'rgba(59,130,246,0.12)',
        handleStyle: { color: '#3b82f6' }, textStyle: { fontSize: 9, color: '#64748b' },
      },
    ],
    series: tokenDefs.map(d => ({
      id: d.id,
      name: d.name,
      type: 'line',
      smooth: true,
      symbol: 'none',
      yAxisIndex: d.yAxisIndex,
      data: d.data,
      z: d.name === '缓存命中率' ? 3 : 2,
      lineStyle: {
        color: d.color,
        width: d.width ?? 2,
        type: d.dashed ? 'dashed' : 'solid',
      },
      itemStyle: { color: d.color },
      areaStyle: d.area
        ? {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: d.area },
                { offset: 1, color: d.areaBottom ?? 'rgba(255,255,255,0)' },
              ],
            },
          }
        : undefined,
    })),
  }
})
</script>
