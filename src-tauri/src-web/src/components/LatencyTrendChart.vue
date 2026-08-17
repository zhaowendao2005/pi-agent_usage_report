<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="flex items-start justify-between gap-2 mb-2">
      <div>
        <h3 class="text-sm font-semibold text-foreground">延迟趋势</h3>
        <p class="text-xs text-muted-foreground mt-0.5">首字延迟 / 总耗时 · 单位秒</p>
      </div>
      <div v-if="isAggregated" class="inline-flex items-center gap-1 rounded bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">
        <span>📦 {{ modeText }}</span>
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
      :style="{ height: '240px' }"
      autoresize
      :update-options="{ notMerge: false, replaceMerge: ['series'] }"
      @datazoom="onDataZoom"
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
import { useTrendDownsampler } from '@/composables/useTrendDownsampler'
import { fmtSec, buildFullPointTooltip, type TrendTooltipMode } from '@/lib/utils'

const props = withDefaults(defineProps<{ tooltipMode?: TrendTooltipMode }>(), {
  tooltipMode: 'all',
})

const { renderedPoints, isAggregated, modeText, onDataZoom } = useTrendDownsampler()
use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, DataZoomComponent])

const legend = [
  { name: '首字延迟', color: '#8b5cf6' },
  { name: '总耗时', color: '#ec4899' },
]
const hidden = ref(new Set<string>())
function toggle(name: string) {
  const n = new Set(hidden.value)
  n.has(name) ? n.delete(name) : n.add(name)
  hidden.value = n
}

const option = computed(() => {
  void props.tooltipMode
  const s = renderedPoints.value
  const times = s.map(d => d.time)
  const defs = [
    {
      name: '首字延迟', color: '#8b5cf6', id: 'ttft',
      data: s.map(d => (d.ttftMs != null ? +(d.ttftMs / 1000).toFixed(3) : 0)),
    },
    {
      name: '总耗时', color: '#ec4899', id: 'dur', dashed: true,
      data: s.map(d => (d.durationMs != null ? +(d.durationMs / 1000).toFixed(3) : 0)),
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
          return buildFullPointTooltip(p, params[0].axisValue)
        }
        const model = p.provider ? `${p.provider}/${p.model}` : p.model
        const head = `<div style="color:#3b82f6;font-weight:600;font-size:11px;margin-bottom:4px">${model}</div>`
        const t = `<div style="color:#64748b;font-size:11px;margin-bottom:6px">${params[0].axisValue}</div>`
        const rows = params.map((x: any) => {
          const ms = x.seriesName === '首字延迟' ? p.ttftMs : p.durationMs
          return `<div style="display:flex;justify-content:space-between;gap:18px">
            <span style="color:${x.color}">● ${x.seriesName}</span>
            <span style="font-weight:600">${fmtSec(ms)}</span>
          </div>`
        }).join('')
        return head + t + rows
      },
    },
    grid: { top: 12, right: 12, bottom: 40, left: 8, containLabel: true },
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
    yAxis: {
      type: 'value', name: 's',
      nameTextStyle: { color: '#7c3aed', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
      axisLabel: {
        color: '#7c3aed', fontSize: 10,
        formatter: (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v)) + 's',
      },
    },
    dataZoom: [
      { type: 'inside' },
      {
        type: 'slider', height: 16, bottom: 2, borderColor: 'transparent',
        backgroundColor: 'rgba(0,0,0,0.03)', fillerColor: 'rgba(139,92,246,0.14)',
        handleStyle: { color: '#8b5cf6' }, textStyle: { fontSize: 9, color: '#64748b' },
      },
    ],
    series: defs.map(d => ({
      id: d.id, name: d.name, type: 'line', smooth: true, symbol: 'none',
      data: d.data,
      lineStyle: { color: d.color, width: 2, type: d.dashed ? 'dashed' : 'solid' },
      itemStyle: { color: d.color },
    })),
  }
})
</script>
