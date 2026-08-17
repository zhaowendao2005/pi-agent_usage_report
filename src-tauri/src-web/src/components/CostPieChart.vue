<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">费用分布</h3>
      <p class="text-xs text-muted-foreground mt-0.5">按模型费用占比</p>
    </div>
    <v-chart :option="option" :style="{ height: '280px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { modelUsage } = storeToRefs(useUsageStore())

use([CanvasRenderer, PieChart, TooltipComponent, LegendComponent])

const COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444', '#8b5cf6', '#14b8a6']

const option = computed(() => {
  const map = new Map<string, number>()

  for (const row of modelUsage.value) {
    const model = shortModel(row.model)
    map.set(model, (map.get(model) || 0) + row.cost)
  }

  const data = Array.from(map.entries())
    .map(([name, value], idx) => ({
      name,
      value,
      itemStyle: { color: COLORS[idx % COLORS.length] },
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any) => {
        return `
          <div style="color:${params.color};font-weight:600;margin-bottom:4px">${params.name}</div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">费用</span>
            <span style="font-weight:600">$${Number(params.value).toFixed(4)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">占比</span>
            <span style="font-weight:600">${params.percent}%</span>
          </div>
        `
      },
    },
    legend: {
      bottom: 0,
      orient: 'horizontal',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#64748b', fontSize: 10 },
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['50%', '45%'],
        data,
        label: {
          show: true,
          position: 'outside',
          fontSize: 10,
          color: '#64748b',
          formatter: (params: any) => {
            if (params.percent < 5) return ''
            return `$${Number(params.value).toFixed(2)}`
          },
        },
        labelLine: {
          show: true,
          length: 8,
          length2: 6,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.2)',
          },
        },
        itemStyle: {
          borderColor: '#fff',
          borderWidth: 2,
        },
      },
    ],
  }
})

function shortModel(name: string): string {
  let m = name.split('/').pop() ?? name
  m = m.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return m.length > 15 ? m.slice(0, 13) + '…' : m
}
</script>
