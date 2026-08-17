<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">费用趋势</h3>
      <p class="text-xs text-muted-foreground mt-0.5">累计 API 调用费用 (USD)</p>
    </div>
    <v-chart :option="option" :style="{ height: '220px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { useTrendDownsampler } from '@/composables/useTrendDownsampler'

const { renderedPoints } = useTrendDownsampler()

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent])

const option = computed(() => {
  // cumulative cost
  let cum = 0
  const points = renderedPoints.value
  const cumData = points.map(d => {
    cum += d.totalCost
    return +cum.toFixed(6)
  })
  const times = points.map(d => d.time)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any[]) =>
        `<div style="color:#64748b;font-size:11px;margin-bottom:4px">${params[0].axisValue}</div>
         <div style="color:#f59e0b;font-weight:600">$${params[0].value.toFixed(4)}</div>`,
    },
    grid: { top: 8, right: 8, bottom: 28, left: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#64748b', fontSize: 10,
        formatter: (v: string) => v.slice(11, 16),
        interval: Math.floor(times.length / 5),
      },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
      axisLabel: {
        color: '#64748b', fontSize: 10,
        formatter: (v: number) => '$' + v.toFixed(3),
      },
    },
    series: [{
      type: 'line',
      smooth: true,
      data: cumData,
      lineStyle: { color: '#f59e0b', width: 2 },
      itemStyle: { color: '#f59e0b' },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(245,158,11,0.2)' },
            { offset: 1, color: 'rgba(245,158,11,0.01)' },
          ],
        },
      },
      symbol: 'none',
    }],
  }
})
</script>
