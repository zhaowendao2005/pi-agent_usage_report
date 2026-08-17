<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3 flex items-start justify-between">
      <div>
        <h3 class="text-sm font-semibold text-foreground">模型排行榜</h3>
        <p class="text-xs text-muted-foreground mt-0.5">按调用次数排序 · Token 分布</p>
      </div>
    </div>
    <v-chart :option="option" :style="{ height: '320px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { modelUsage } = storeToRefs(useUsageStore())

use([CanvasRenderer, BarChart, TooltipComponent, GridComponent, LegendComponent])

const option = computed(() => {
  // 聚合数据
  const map = new Map<string, { input: number; output: number; cacheRead: number; calls: number }>()

  for (const row of modelUsage.value) {
    const model = shortModel(row.model)
    const stat = map.get(model) ?? { input: 0, output: 0, cacheRead: 0, calls: 0 }
    stat.input += row.inputTokens
    stat.output += row.outputTokens
    stat.cacheRead += row.cacheRead
    stat.calls++
    map.set(model, stat)
  }

  const data = Array.from(map.entries())
    .map(([model, stat]) => ({ model, ...stat }))
    .sort((a, b) => b.input + b.output + b.cacheRead - (a.input + a.output + a.cacheRead))
    .slice(0, 10)

  const models = data.map(d => d.model)
  const inputData = data.map(d => d.input)
  const outputData = data.map(d => d.output)
  const cacheData = data.map(d => d.cacheRead)

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      axisPointer: { type: 'shadow' },
    },
    legend: {
      bottom: 0,
      data: ['输入', '输出', '缓存读取'],
      textStyle: { color: '#64748b', fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    grid: {
      top: 20,
      right: 20,
      bottom: 50,
      left: 10,
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        formatter: (v: number) => {
          if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M'
          if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K'
          return String(v)
        },
      },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: models,
      axisLabel: { color: '#64748b', fontSize: 10 },
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
    },
    series: [
      {
        name: '输入',
        type: 'bar',
        stack: 'total',
        data: inputData,
        itemStyle: { color: '#3b82f6' },
      },
      {
        name: '输出',
        type: 'bar',
        stack: 'total',
        data: outputData,
        itemStyle: { color: '#a855f7' },
      },
      {
        name: '缓存读取',
        type: 'bar',
        stack: 'total',
        data: cacheData,
        itemStyle: { color: '#22c55e' },
      },
    ],
  }
})

function shortModel(name: string): string {
  let m = name.split('/').pop() ?? name
  m = m.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return m.length > 18 ? m.slice(0, 16) + '…' : m
}
</script>
