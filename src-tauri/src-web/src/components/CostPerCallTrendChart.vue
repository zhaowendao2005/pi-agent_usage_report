<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-2">
      <h3 class="text-sm font-semibold text-foreground">单次费用趋势</h3>
      <p class="text-xs text-muted-foreground mt-0.5">每次调用费用 (USD) · Token 用量按 M 展示</p>
    </div>
    <v-chart
      :option="option"
      :style="{ height: '240px' }"
      autoresize
      :update-options="{ notMerge: false, replaceMerge: ['series'] }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import { formatTokensM, buildFullPointTooltip, type TrendTooltipMode } from '@/lib/utils'

const props = withDefaults(defineProps<{ tooltipMode?: TrendTooltipMode }>(), {
  tooltipMode: 'all',
})

const { series } = storeToRefs(useUsageStore())
use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, DataZoomComponent])

const option = computed(() => {
  void props.tooltipMode
  const s = series.value
  const times = s.map(d => d.time)
  const costs = s.map(d => d.totalCost)

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
        const tok = p.inputTokens + p.outputTokens + p.cacheRead + p.cacheWrite
        return `
          <div style="color:#3b82f6;font-weight:600;font-size:11px;margin-bottom:4px">${model}</div>
          <div style="color:#64748b;font-size:11px;margin-bottom:6px">${params[0].axisValue}</div>
          <div style="display:flex;justify-content:space-between;gap:18px">
            <span style="color:#ef4444">● 费用</span>
            <span style="font-weight:600">$${Number(p.totalCost).toFixed(5)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:18px">
            <span style="color:#64748b">Token 合计</span>
            <span style="font-weight:600">${formatTokensM(tok)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:18px">
            <span style="color:#64748b">输入 / 输出</span>
            <span style="font-weight:600">${formatTokensM(p.inputTokens)} / ${formatTokensM(p.outputTokens)}</span>
          </div>
        `
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
      type: 'value', name: 'USD',
      nameTextStyle: { color: '#dc2626', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
      axisLabel: {
        color: '#dc2626', fontSize: 10,
        formatter: (v: number) => '$' + v.toFixed(3),
      },
    },
    dataZoom: [
      { type: 'inside' },
      {
        type: 'slider', height: 16, bottom: 2, borderColor: 'transparent',
        backgroundColor: 'rgba(0,0,0,0.03)', fillerColor: 'rgba(239,68,68,0.12)',
        handleStyle: { color: '#ef4444' }, textStyle: { fontSize: 9, color: '#64748b' },
      },
    ],
    series: [{
      id: 'cost',
      name: '费用/点',
      type: 'line',
      smooth: true,
      data: costs,
      symbol: 'circle',
      symbolSize: 3,
      lineStyle: { color: '#ef4444', width: 1.5 },
      itemStyle: { color: '#ef4444' },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(239,68,68,0.18)' },
            { offset: 1, color: 'rgba(239,68,68,0.01)' },
          ],
        },
      },
    }],
  }
})
</script>
