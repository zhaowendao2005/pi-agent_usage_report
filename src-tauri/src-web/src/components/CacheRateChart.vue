<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">缓存命中率</h3>
      <p class="text-xs text-muted-foreground mt-0.5">Cache Read / (Input + Cache Read)</p>
    </div>
    <v-chart :option="option" :style="{ height: '220px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GaugeChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { summary } = storeToRefs(useUsageStore())

use([CanvasRenderer, GaugeChart, TooltipComponent])

const option = computed(() => {
  const rate = summary.value.cacheHitRate
  const color = rate >= 50 ? '#22c55e' : rate >= 25 ? '#f59e0b' : '#ef4444'
  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'gauge',
      startAngle: 200,
      endAngle: -20,
      min: 0,
      max: 100,
      radius: '85%',
      center: ['50%', '58%'],
      splitNumber: 5,
      axisLine: {
        lineStyle: {
          width: 12,
          color: [
            [rate / 100, color],
            [1, 'rgba(0,0,0,0.08)'],
          ],
        },
      },
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        distance: -28,
        color: '#94a3b8',
        fontSize: 10,
        formatter: (v: number) => v + '%',
      },
      detail: {
        valueAnimation: true,
        formatter: '{value}%',
        color,
        fontSize: 28,
        fontWeight: 700,
        offsetCenter: [0, '-5%'],
      },
      title: {
        offsetCenter: [0, '22%'],
        fontSize: 12,
        color: '#64748b',
      },
      data: [{ value: rate, name: '命中率' }],
    }],
  }
})
</script>
