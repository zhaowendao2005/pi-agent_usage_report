<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">提供商 · 模型关系图</h3>
      <p class="text-xs text-muted-foreground mt-0.5">弦宽 = Token 流量 · 悬停高亮关联路径</p>
    </div>
    <v-chart :option="option" :style="{ height: '420px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { modelUsage } = storeToRefs(useUsageStore())

use([CanvasRenderer, GraphChart, TooltipComponent, LegendComponent])

const PROVIDER_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444']
const MODEL_COLORS = ['#8b5cf6', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#0ea5e9']

interface Node {
  id: string
  name: string
  category: number
  value: number
  itemStyle: { color: string }
  label: { show: boolean }
}

interface Link {
  source: string
  target: string
  value: number
  lineStyle: { width: number; color: string; opacity: number; curveness: number }
}

const option = computed(() => {
  // 构建节点和连接
  const providerMap = new Map<string, number>()
  const modelMap = new Map<string, number>()
  const links: Link[] = []

  for (const row of modelUsage.value) {
    const provider = row.provider || '未知提供商'
    const model = shortModel(row.model)
    const tokens = row.inputTokens + row.outputTokens + row.cacheRead + row.cacheWrite

    providerMap.set(provider, (providerMap.get(provider) || 0) + tokens)
    modelMap.set(model, (modelMap.get(model) || 0) + tokens)

    const linkKey = `${provider}→${model}`
    const existing = links.find(l => l.source === provider && l.target === model)
    if (existing) {
      existing.value += tokens
    } else {
      links.push({
        source: provider,
        target: model,
        value: tokens,
        lineStyle: { width: 1, color: '', opacity: 0.4, curveness: 0.3 },
      })
    }
  }

  // 创建节点
  const providerNodes: Node[] = Array.from(providerMap.entries()).map(([name, value], idx) => ({
    id: name,
    name,
    category: 0,
    value,
    itemStyle: { color: PROVIDER_COLORS[idx % PROVIDER_COLORS.length] },
    label: { show: true },
  }))

  const modelNodes: Node[] = Array.from(modelMap.entries()).map(([name, value], idx) => ({
    id: name,
    name,
    category: 1,
    value,
    itemStyle: { color: MODEL_COLORS[idx % MODEL_COLORS.length] },
    label: { show: true },
  }))

  const nodes = [...providerNodes, ...modelNodes]

  // 计算连接宽度
  const maxTokens = Math.max(...links.map(l => l.value), 1)
  links.forEach(link => {
    const width = 1 + (Math.sqrt(link.value) / Math.sqrt(maxTokens)) * 12
    link.lineStyle.width = width
    // 连接颜色使用源节点（提供商）颜色
    const sourceNode = providerNodes.find(n => n.id === link.source)
    link.lineStyle.color = sourceNode?.itemStyle.color || '#94a3b8'
  })

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any) => {
        if (params.dataType === 'node') {
          const isProvider = params.data.category === 0
          const type = isProvider ? '提供商' : '模型'
          return `
            <div style="color:#64748b;font-size:11px;margin-bottom:4px">${type}</div>
            <div style="color:${params.color};font-weight:600;margin-bottom:4px">${params.name}</div>
            <div style="display:flex;justify-content:space-between;gap:20px">
              <span style="color:#64748b">总 Token</span>
              <span style="font-weight:600">${Number(params.value).toLocaleString()}</span>
            </div>
          `
        } else if (params.dataType === 'edge') {
          return `
            <div style="color:#64748b;font-size:11px;margin-bottom:4px">Token 流量</div>
            <div style="margin-bottom:4px">
              <span style="color:${params.color};font-weight:600">${params.data.source}</span>
              <span style="color:#64748b"> → </span>
              <span style="font-weight:600">${params.data.target}</span>
            </div>
            <div style="display:flex;justify-content:space-between;gap:20px">
              <span style="color:#64748b">Token 数量</span>
              <span style="font-weight:600">${Number(params.value).toLocaleString()}</span>
            </div>
          `
        }
        return ''
      },
    },
    legend: {
      bottom: 0,
      data: ['提供商', '模型'],
      textStyle: { color: '#64748b', fontSize: 11 },
      itemWidth: 14,
      itemHeight: 10,
    },
    series: [
      {
        type: 'graph',
        layout: 'circular',
        circular: {
          rotateLabel: true,
        },
        roam: true,
        categories: [
          { name: '提供商', itemStyle: { color: '#3b82f6' } },
          { name: '模型', itemStyle: { color: '#8b5cf6' } },
        ],
        data: nodes,
        links,
        label: {
          show: true,
          position: 'right',
          color: '#64748b',
          fontSize: 10,
          formatter: (params: any) => {
            const name = params.name
            return name.length > 15 ? name.slice(0, 13) + '…' : name
          },
        },
        labelLayout: {
          hideOverlap: true,
        },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 6,
        emphasis: {
          focus: 'adjacency',
          lineStyle: {
            width: 4,
            opacity: 0.7,
          },
          itemStyle: {
            shadowBlur: 12,
            shadowColor: 'rgba(0,0,0,0.3)',
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
  return m.length > 20 ? m.slice(0, 18) + '…' : m
}
</script>
