<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">时段分布</h3>
      <p class="text-xs text-muted-foreground mt-0.5">24小时调用量柱状图</p>
    </div>
    <v-chart :option="option" :style="{ height: '240px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { TooltipComponent, GridComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { series } = storeToRefs(useUsageStore())

use([CanvasRenderer, BarChart, TooltipComponent, GridComponent])

const option = computed(() => {
  const hours = Array.from({ length: 24 }, () => 0)

  for (const d of series.value) {
    const date = new Date(d.time.replace(' ', 'T'))
    const hour = date.getHours()
    hours[hour]++
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const p = params[0]
        return `
          <div style="color:#64748b;font-size:11px;margin-bottom:4px">${p.axisValue}:00 - ${p.axisValue}:59</div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:${p.color}">● 调用次数</span>
            <span style="font-weight:600">${p.value}</span>
          </div>
        `
      },
    },
    grid: {
      top: 20,
      right: 20,
      bottom: 30,
      left: 40,
    },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, i) => i),
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        formatter: (v: number) => `${v}h`,
      },
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
    },
    series: [
      {
        type: 'bar',
        data: hours,
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#3b82f6' },
              { offset: 1, color: '#06b6d4' },
            ],
          },
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(59,130,246,0.5)',
          },
        },
      },
    ],
  }
})
</script>
