<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">Token 分布</h3>
      <p class="text-xs text-muted-foreground mt-0.5">按 Token 类型占比</p>
    </div>
    <v-chart :option="option" :style="{ height: '220px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { summary } from '@/composables/useTokenData'

use([CanvasRenderer, PieChart, TooltipComponent, LegendComponent])

const option = computed(() => {
  const s = summary.value
  const data = [
    { value: s.totalInput,      name: '输入',     itemStyle: { color: '#3b82f6' } },
    { value: s.totalOutput,     name: '输出',     itemStyle: { color: '#a855f7' } },
    { value: s.totalCacheRead,  name: '缓存读取', itemStyle: { color: '#22c55e' } },
    { value: s.totalCacheWrite, name: '缓存写入', itemStyle: { color: '#f59e0b' } },
  ]
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (p: any) =>
        `<div style="color:${p.color}">● ${p.name}</div>
         <div style="font-weight:600">${p.value.toLocaleString()} <span style="color:#64748b">(${p.percent}%)</span></div>`,
    },
    legend: {
      bottom: 0,
      orient: 'horizontal',
      itemWidth: 10, itemHeight: 10,
      textStyle: { color: '#64748b', fontSize: 11 },
    },
    series: [{
      type: 'pie',
      radius: ['40%', '68%'],
      center: ['50%', '44%'],
      data,
      label: { show: false },
      emphasis: {
        itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' },
      },
      itemStyle: { borderRadius: 4, borderColor: 'transparent', borderWidth: 2 },
    }],
  }
})
</script>
