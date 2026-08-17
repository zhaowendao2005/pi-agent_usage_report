<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">延迟热力图</h3>
      <p class="text-xs text-muted-foreground mt-0.5">时段 × 模型的平均首字延迟分布</p>
    </div>
    <v-chart :option="option" :style="{ height: '280px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { HeatmapChart } from 'echarts/charts'
import { TooltipComponent, GridComponent, VisualMapComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { series } = storeToRefs(useUsageStore())

use([CanvasRenderer, HeatmapChart, TooltipComponent, GridComponent, VisualMapComponent])

const option = computed(() => {
  // 按小时和模型分组
  const map = new Map<string, { sum: number; count: number }>()
  const models = new Set<string>()
  const hours = Array.from({ length: 24 }, (_, i) => i)

  for (const d of series.value) {
    if (d.ttftMs == null || d.ttftMs <= 0) continue
    const date = new Date(d.time.replace(' ', 'T'))
    const hour = date.getHours()
    const model = shortModel(d.model)
    models.add(model)

    const key = `${hour}::${model}`
    const stat = map.get(key) ?? { sum: 0, count: 0 }
    stat.sum += d.ttftMs
    stat.count++
    map.set(key, stat)
  }

  const modelList = Array.from(models).sort().slice(0, 8) // 最多8个模型

  // 生成热力图数据 [小时, 模型索引, 平均延迟]
  const data: [number, number, number][] = []
  hours.forEach(hour => {
    modelList.forEach((model, modelIdx) => {
      const key = `${hour}::${model}`
      const stat = map.get(key)
      if (stat && stat.count > 0) {
        // 存秒，保留 2 位
        data.push([hour, modelIdx, +((stat.sum / stat.count) / 1000).toFixed(2)])
      }
    })
  })

  const maxLatency = Math.max(...data.map(d => d[2]), 1)

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any) => {
        const [hour, modelIdx, latency] = params.value
        const model = modelList[modelIdx]
        return `
          <div style="color:#64748b;font-size:11px;margin-bottom:4px">${hour}:00 - ${hour}:59</div>
          <div style="font-weight:600;margin-bottom:4px">${model}</div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">平均延迟</span>
            <span style="font-weight:600;color:${params.color}">${Number(latency).toFixed(2)}s</span>
          </div>
        `
      },
    },
    grid: {
      top: 30,
      right: 100,
      bottom: 40,
      left: 80,
    },
    xAxis: {
      type: 'category',
      data: hours.map(h => `${h}h`),
      splitArea: { show: true },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    yAxis: {
      type: 'category',
      data: modelList,
      splitArea: { show: true },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    visualMap: {
      min: 0,
      max: maxLatency,
      calculable: true,
      orient: 'vertical',
      right: 10,
      top: 'center',
      inRange: {
        color: ['#22c55e', '#f59e0b', '#ef4444'],
      },
      textStyle: { color: '#64748b', fontSize: 10 },
      formatter: (value: number) => `${Number(value).toFixed(1)}s`,
    },
    series: [
      {
        type: 'heatmap',
        data,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.3)',
          },
        },
      },
    ],
  }
})

function shortModel(name: string): string {
  let m = name.split('/').pop() ?? name
  m = m.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return m.length > 12 ? m.slice(0, 10) + '…' : m
}
</script>
