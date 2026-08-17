<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">性能漏斗</h3>
      <p class="text-xs text-muted-foreground mt-0.5">从总调用到成功完成的转化率</p>
    </div>
    <v-chart :option="option" :style="{ height: '280px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { FunnelChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { series } = storeToRefs(useUsageStore())

use([CanvasRenderer, FunnelChart, TooltipComponent, LegendComponent])

const option = computed(() => {
  let total = series.value.length
  let withOutput = 0
  let withCache = 0
  let fastResponse = 0
  let success = 0

  for (const d of series.value) {
    if (d.outputTokens > 0) withOutput++
    if (d.cacheRead > 0) withCache++
    if (d.ttftMs != null && d.ttftMs < 1000) fastResponse++
    if (!d.httpStatus || (d.httpStatus >= 200 && d.httpStatus < 300)) {
      if (!d.stopReason || (d.stopReason !== 'error' && d.stopReason !== 'aborted')) {
        success++
      }
    }
  }

  const data = [
    { value: total, name: '总调用', itemStyle: { color: '#3b82f6' } },
    { value: withOutput, name: '产生输出', itemStyle: { color: '#06b6d4' } },
    { value: fastResponse, name: '快速响应(<1s)', itemStyle: { color: '#22c55e' } },
    { value: withCache, name: '命中缓存', itemStyle: { color: '#f59e0b' } },
    { value: success, name: '成功完成', itemStyle: { color: '#8b5cf6' } },
  ]

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any) => {
        const rate = total > 0 ? ((params.value / total) * 100).toFixed(1) : 0
        return `
          <div style="color:${params.color};font-weight:600;margin-bottom:4px">${params.name}</div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">数量</span>
            <span style="font-weight:600">${params.value.toLocaleString()}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">占总数</span>
            <span style="font-weight:600">${rate}%</span>
          </div>
        `
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#64748b', fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    series: [
      {
        type: 'funnel',
        top: 30,
        bottom: 60,
        left: '10%',
        width: '80%',
        minSize: '10%',
        maxSize: '100%',
        sort: 'descending',
        gap: 2,
        data,
        label: {
          show: true,
          position: 'inside',
          fontSize: 12,
          color: '#fff',
          fontWeight: 600,
          formatter: '{b}: {c}',
        },
        emphasis: {
          label: {
            fontSize: 14,
          },
        },
      },
    ],
  }
})
</script>
