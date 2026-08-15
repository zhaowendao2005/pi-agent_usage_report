<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">模型用量分布</h3>
      <p class="text-xs text-muted-foreground mt-0.5">各模型 Token 消耗对比</p>
    </div>
    <v-chart :option="option" :style="{ height: '220px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { modelUsage } = storeToRefs(useUsageStore())

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent])

const PALETTE = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#06b6d4']

const option = computed(() => {
  const data = modelUsage.value
  const models = data.map(d => d.model.replace('claude-', '').replace('gpt-', 'gpt-'))
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter(params: any[]) {
        const model = data[params[0].dataIndex].model
        return `<div style="color:#64748b;margin-bottom:4px;font-size:11px">${model}</div>` +
          params.map((p: any) =>
            `<div style="display:flex;justify-content:space-between;gap:16px">
              <span style="color:${p.color}">● ${p.seriesName}</span>
              <span style="font-weight:600">${Number(p.value).toLocaleString()}</span>
            </div>`
          ).join('')
      },
    },
    grid: { top: 8, right: 8, bottom: 48, left: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: models,
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
      axisTick: { show: false },
      axisLabel: { color: '#64748b', fontSize: 10, interval: 0 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
      axisLabel: {
        color: '#64748b', fontSize: 10,
        formatter: (v: number) => v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v,
      },
    },
    series: [
      {
        name: '输入',
        type: 'bar', stack: 'total', barMaxWidth: 32,
        data: data.map((d, i) => ({ value: d.inputTokens, itemStyle: { color: PALETTE[i % PALETTE.length] + 'cc' } })),
        itemStyle: { borderRadius: [0, 0, 0, 0] },
      },
      {
        name: '输出',
        type: 'bar', stack: 'total', barMaxWidth: 32,
        data: data.map((d, i) => ({ value: d.outputTokens, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      },
    ],
  }
})
</script>
