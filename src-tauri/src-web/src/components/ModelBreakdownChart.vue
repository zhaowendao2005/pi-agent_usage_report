<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">模型用量分布</h3>
      <p class="text-xs text-muted-foreground mt-0.5">灯泡图 · 总 Token = 缓存命中 + 缓存写入 + 输入 + 输出</p>
    </div>
    <v-chart :option="option" :style="{ height: `${chartHeight}px` }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import type { ModelUsage } from '@/stores/usage'

const { modelUsage } = storeToRefs(useUsageStore())

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, LegendComponent])

// 与 TokenPieChart 保持一致的配色
const COLORS = {
  cache: '#22c55e', // 缓存命中
  write: '#f59e0b', // 缓存写入
  input: '#3b82f6', // 输入
  output: '#a855f7', // 输出
}

function totalOf(m: ModelUsage): number {
  return m.cacheRead + m.cacheWrite + m.inputTokens + m.outputTokens
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M'
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K'
  return String(v)
}

function shortModel(name: string): string {
  let m = name.split('/').pop() ?? name
  m = m.replace(/^claude-/, '')
  m = m.replace(/-\d{6,8}$/, '') // 去掉 -20250514 之类日期后缀
  return m
}

const sorted = computed(() => [...modelUsage.value].sort((a, b) => totalOf(b) - totalOf(a)))

const chartHeight = computed(() => Math.max(240, sorted.value.length * 46 + 100))

const option = computed(() => {
  const data = sorted.value
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter(params: any[]) {
        const m = data[params[0].dataIndex]
        const rows: Array<[string, number, string]> = [
          ['总 Token', totalOf(m), '#334155'],
          ['缓存命中', m.cacheRead, COLORS.cache],
          ['缓存写入', m.cacheWrite, COLORS.write],
          ['输入', m.inputTokens, COLORS.input],
          ['输出', m.outputTokens, COLORS.output],
        ]
        return (
          `<div style="color:#64748b;margin-bottom:4px;font-size:11px">${m.model}</div>` +
          rows
            .map(
              ([label, value, color]) =>
                `<div style="display:flex;justify-content:space-between;gap:20px;margin:2px 0">
                  <span style="color:${color}">● ${label}</span>
                  <span style="font-weight:600;color:${color}">${Number(value).toLocaleString()}</span>
                </div>`
            )
            .join('')
        )
      },
    },
    legend: {
      bottom: 0,
      orient: 'horizontal',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#64748b', fontSize: 11 },
    },
    grid: { top: 10, right: 76, bottom: 36, left: 8, containLabel: true },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        formatter: (v: number) => (v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v),
      },
    },
    yAxis: {
      type: 'category',
      inverse: true, // 总量最大的模型排最上面
      data: data.map(d => shortModel(d.model)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#64748b', fontSize: 11 },
    },
    series: [
      {
        name: '缓存命中',
        type: 'bar',
        stack: 'total',
        barMaxWidth: 26,
        data: data.map(d => d.cacheRead),
        itemStyle: { color: COLORS.cache },
      },
      {
        name: '缓存写入',
        type: 'bar',
        stack: 'total',
        barMaxWidth: 26,
        data: data.map(d => d.cacheWrite),
        itemStyle: { color: COLORS.write },
      },
      {
        name: '输入',
        type: 'bar',
        stack: 'total',
        barMaxWidth: 26,
        data: data.map(d => d.inputTokens),
        itemStyle: { color: COLORS.input },
      },
      {
        name: '输出',
        type: 'bar',
        stack: 'total',
        barMaxWidth: 26,
        data: data.map(d => d.outputTokens),
        // 末段右侧圆角 → 灯泡圆头
        itemStyle: { color: COLORS.output, borderRadius: [0, 6, 6, 0] },
        // 灯泡尖端的「总 Token」数值
        label: {
          show: true,
          position: 'right',
          color: '#334155',
          fontSize: 11,
          fontWeight: 600,
          formatter: (p: any) => formatTokens(totalOf(data[p.dataIndex])),
        },
        labelLayout: { hideOverlap: true },
      },
    ],
  }
})
</script>
