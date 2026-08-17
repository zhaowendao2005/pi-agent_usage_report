<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">调用量矩形树图</h3>
      <p class="text-xs text-muted-foreground mt-0.5">提供商 → 模型层级 · 面积 = Token 总量</p>
    </div>
    <v-chart :option="option" :style="{ height: '320px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { TreemapChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { modelUsage } = storeToRefs(useUsageStore())

use([CanvasRenderer, TreemapChart, TooltipComponent])

const option = computed(() => {
  // 按提供商分组
  const providerMap = new Map<string, any[]>()

  for (const row of modelUsage.value) {
    const provider = row.provider || '未知提供商'
    const model = shortModel(row.model)
    const value = row.inputTokens + row.outputTokens + row.cacheRead + row.cacheWrite

    if (!providerMap.has(provider)) {
      providerMap.set(provider, [])
    }
    providerMap.get(provider)!.push({
      name: model,
      value,
      cost: row.cost,
    })
  }

  // 构建树形数据
  const data = Array.from(providerMap.entries()).map(([provider, children]) => ({
    name: provider,
    children: children.sort((a, b) => b.value - a.value),
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
        if (!params.value) return ''
        const cost = params.data.cost
        return `
          <div style="color:#64748b;font-size:11px;margin-bottom:4px">${params.treePathInfo?.slice(1).map((p: any) => p.name).join(' / ') || params.name}</div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">Token 总量</span>
            <span style="font-weight:600">${Number(params.value).toLocaleString()}</span>
          </div>
          ${cost != null ? `
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">费用</span>
            <span style="font-weight:600">$${cost.toFixed(4)}</span>
          </div>` : ''}
        `
      },
    },
    series: [
      {
        type: 'treemap',
        data,
        width: '100%',
        height: '100%',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: true,
          formatter: '{b}',
          color: '#fff',
          fontSize: 11,
          fontWeight: 500,
        },
        upperLabel: {
          show: true,
          height: 22,
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
        },
        itemStyle: {
          borderColor: '#fff',
          borderWidth: 2,
          gapWidth: 2,
        },
        levels: [
          {
            itemStyle: {
              borderColor: '#fff',
              borderWidth: 3,
              gapWidth: 3,
            },
          },
          {
            colorSaturation: [0.35, 0.5],
            itemStyle: {
              borderWidth: 1,
              gapWidth: 1,
              borderColorSaturation: 0.6,
            },
          },
        ],
        visualDimension: 0,
        color: ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444'],
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
