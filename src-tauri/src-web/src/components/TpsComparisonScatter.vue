<script setup lang="ts">
import { computed } from 'vue'
import { use } from 'echarts/core'
import { ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '../stores/usage'
import { recomputeTps } from '../lib/utils'

use([
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
])

const usageStore = useUsageStore()
const { series } = storeToRefs(usageStore)

const COLORS = [
  '#38bdf8',
  '#f97316',
  '#4fd1c5',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f43f5e',
]

interface ModelScatterData {
  key: string
  label: string
  provider: string | null
  model: string
  color: string
  avgTpsTotal: number
  avgTpsGen: number
  calls: number
  value: [number, number, number] // [tpsTotal, tpsGen, calls]
}

// 计算每个模型的加权平均TPS（采用 RMT-TPS 鲁棒模型）
const modelData = computed<ModelScatterData[]>(() => {
  const map = new Map<
    string,
    {
      provider: string | null
      model: string
      sumOutput: number
      sumDurationSec: number
      sumGenOutput: number
      sumGenDurationSec: number
      calls: number
    }
  >()

  for (const d of series.value) {
    const out = d.outputTokens || 0
    const dur = d.durationMs || 0
    const ttft = d.ttftMs || 0
    if (out <= 0 || dur <= 0) continue

    const key = `${d.provider ?? ''}::${d.model}`
    const stat = map.get(key) ?? {
      provider: d.provider,
      model: d.model,
      sumOutput: 0,
      sumDurationSec: 0,
      sumGenOutput: 0,
      sumGenDurationSec: 0,
      calls: 0,
    }

    stat.calls++
    stat.sumOutput += out
    stat.sumDurationSec += dur / 1000

    const genMs = dur - ttft
    if (out >= 3 && genMs >= 150) {
      stat.sumGenOutput += out
      stat.sumGenDurationSec += genMs / 1000
    }

    map.set(key, stat)
  }

  return Array.from(map.entries())
    .map(([key, stat], idx) => {
      if (stat.calls === 0 || stat.sumDurationSec === 0) return null
      const avgTpsTotal = Math.min(stat.sumOutput / stat.sumDurationSec, 800)
      const avgTpsGen =
        stat.sumGenDurationSec > 0
          ? Math.min(stat.sumGenOutput / stat.sumGenDurationSec, 800)
          : avgTpsTotal

      const label = stat.provider
        ? `${stat.provider}/${shortModel(stat.model)}`
        : shortModel(stat.model)

      return {
        key,
        label,
        provider: stat.provider,
        model: stat.model,
        color: COLORS[idx % COLORS.length],
        avgTpsTotal,
        avgTpsGen,
        calls: stat.calls,
        value: [avgTpsTotal, avgTpsGen, stat.calls],
      }
    })
    .filter((d): d is ModelScatterData => d !== null)
    .sort((a, b) => b.calls - a.calls)
})

function shortModel(name: string): string {
  let m = name.split('/').pop() ?? name
  m = m.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return m.length > 24 ? m.slice(0, 22) + '…' : m
}

const option = computed(() => {
  const data = modelData.value
  if (data.length === 0) {
    return {
      backgroundColor: 'transparent',
      title: {
        text: '暂无数据',
        left: 'center',
        top: 'center',
        textStyle: { color: '#94a3b8', fontSize: 14 },
      },
    }
  }

  // 计算坐标轴范围
  const allTpsTotal = data.map(d => d.avgTpsTotal)
  const allTpsGen = data.map(d => d.avgTpsGen)
  const maxTpsTotal = Math.max(...allTpsTotal, 10)
  const maxTpsGen = Math.max(...allTpsGen, 10)
  const maxValue = Math.max(maxTpsTotal, maxTpsGen)
  const axisMax = Math.ceil(maxValue * 1.15)

  // 气泡大小范围
  const minCalls = Math.min(...data.map(d => d.calls))
  const maxCalls = Math.max(...data.map(d => d.calls))
  const sizeMin = 8
  const sizeMax = 40

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any) => {
        const item = params.data.raw as ModelScatterData
        const diff = item.avgTpsGen - item.avgTpsTotal
        const diffPercent = item.avgTpsTotal > 0 
          ? ((diff / item.avgTpsTotal) * 100).toFixed(1) 
          : '0.0'
        
        const header = `<div style="color:${item.color};font-weight:600;margin-bottom:6px">${item.label}</div>`
        const rows = [
          ['含首字加权TPS', `${item.avgTpsTotal.toFixed(1)}`],
          ['生成加权TPS', `${item.avgTpsGen.toFixed(1)}`],
          ['解码提速', `+${diff.toFixed(1)} (+${diffPercent}%)`],
          ['调用次数', `${item.calls.toLocaleString()}`],
        ]
        const content = rows
          .map(
            ([label, value]) =>
              `<div style="display:flex;justify-content:space-between;gap:20px">
              <span style="color:#64748b">${label}</span>
              <span style="font-weight:600">${value}</span>
            </div>`
          )
          .join('')
        return header + content
      },
    },
    grid: {
      left: 60,
      right: 40,
      top: 40,
      bottom: 60,
      containLabel: false,
    },
    xAxis: {
      type: 'value',
      name: '含首字TPS',
      nameLocation: 'middle',
      nameGap: 35,
      nameTextStyle: {
        color: '#64748b',
        fontSize: 12,
        fontWeight: 500,
      },
      min: 0,
      max: axisMax,
      splitLine: {
        lineStyle: { color: 'rgba(148,163,184,0.15)' },
      },
      axisLine: {
        show: true,
        lineStyle: { color: 'rgba(148,163,184,0.3)' },
      },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
      },
    },
    yAxis: {
      type: 'value',
      name: '生成TPS',
      nameLocation: 'middle',
      nameGap: 45,
      nameTextStyle: {
        color: '#64748b',
        fontSize: 12,
        fontWeight: 500,
      },
      min: 0,
      max: axisMax,
      splitLine: {
        lineStyle: { color: 'rgba(148,163,184,0.15)' },
      },
      axisLine: {
        show: true,
        lineStyle: { color: 'rgba(148,163,184,0.3)' },
      },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 11,
      },
    },
    series: [
      // 对角线参考线
      {
        type: 'line',
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: {
            color: 'rgba(148,163,184,0.3)',
            type: 'dashed',
            width: 1,
          },
          label: { show: false },
          data: [
            [
              { coord: [0, 0], symbol: 'none' },
              { coord: [axisMax, axisMax], symbol: 'none' },
            ],
          ],
        },
      },
      // 散点数据
      ...data.map(item => ({
        type: 'scatter',
        name: item.label,
        symbolSize: (val: number[]) => {
          const calls = val[2]
          if (minCalls === maxCalls) return 20
          const normalized = (calls - minCalls) / (maxCalls - minCalls)
          return sizeMin + normalized * (sizeMax - sizeMin)
        },
        itemStyle: {
          color: item.color,
          opacity: 0.75,
        },
        emphasis: {
          itemStyle: {
            opacity: 1,
            borderColor: item.color,
            borderWidth: 2,
          },
        },
        data: [
          {
            value: item.value,
            raw: item,
          },
        ],
      })),
    ],
  }
})
</script>

<template>
  <div class="tps-scatter">
    <div class="header">
      <h3>TPS 对比分析</h3>
      <p class="subtitle">含首字 vs 生成速度（点大小=调用量）</p>
    </div>
    <VChart :option="option" autoresize style="height: 460px" />
  </div>
</template>

<style scoped>
.tps-scatter {
  background: #fff;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  padding: 20px;
}

.header {
  margin-bottom: 16px;
}

.header h3 {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.subtitle {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}
</style>
