<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">性能散点图</h3>
      <p class="text-xs text-muted-foreground mt-0.5">TPS vs 延迟 · 气泡大小 = 费用</p>
    </div>
    <v-chart :option="option" :style="{ height: '320px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { ScatterChart } from 'echarts/charts'
import { TooltipComponent, GridComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import { recomputeTps } from '@/lib/utils'

const { series } = storeToRefs(useUsageStore())

use([CanvasRenderer, ScatterChart, TooltipComponent, GridComponent])

const COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6']

const option = computed(() => {
  // 按模型分组
  const modelMap = new Map<string, Array<[number, number, number, string]>>()

  for (const d of series.value) {
    if (!d.ttftMs || d.ttftMs <= 0 || !d.outputTokens) continue
    const { tpsGen } = recomputeTps(d)
    if (tpsGen <= 0) continue
    const model = shortModel(d.model)
    if (!modelMap.has(model)) modelMap.set(model, [])
    // [TPS纯生成, TTFT秒, cost, label] — TPS 仅 output
    modelMap.get(model)!.push([+tpsGen.toFixed(2), +(d.ttftMs / 1000).toFixed(3), d.totalCost, model])
  }

  const seriesData = Array.from(modelMap.entries())
    .slice(0, 7)
    .map(([model, points], idx) => ({
      name: model,
      type: 'scatter',
      data: points,
      symbolSize: (data: any) => Math.min(Math.max(Math.sqrt(data[2]) * 100, 8), 40),
      itemStyle: {
        color: COLORS[idx % COLORS.length],
        opacity: 0.7,
      },
      emphasis: {
        itemStyle: {
          opacity: 1,
          shadowBlur: 10,
          shadowColor: COLORS[idx % COLORS.length],
        },
      },
    }))

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any) => {
        const [tps, ttft, cost, model] = params.value
        const ttftLabel = ttft < 10 ? ttft.toFixed(2) + 's' : ttft.toFixed(1) + 's'
        return `
          <div style="color:${params.color};font-weight:600;margin-bottom:4px">${model}</div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">TPS</span>
            <span style="font-weight:600">${tps.toFixed(1)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">首字延迟</span>
            <span style="font-weight:600">${ttftLabel}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">费用</span>
            <span style="font-weight:600">$${cost.toFixed(5)}</span>
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
    grid: {
      top: 30,
      right: 20,
      bottom: 50,
      left: 60,
      containLabel: false,
    },
    xAxis: {
      type: 'value',
      name: 'TPS',
      nameTextStyle: { color: '#94a3b8', fontSize: 10 },
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
    },
    yAxis: {
      type: 'value',
      name: '首字延迟 (s)',
      nameTextStyle: { color: '#94a3b8', fontSize: 10 },
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
    },
    series: seriesData,
  }
})

function shortModel(name: string): string {
  let m = name.split('/').pop() ?? name
  m = m.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return m.length > 15 ? m.slice(0, 13) + '…' : m
}
</script>
