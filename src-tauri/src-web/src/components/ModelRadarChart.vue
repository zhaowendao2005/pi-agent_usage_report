<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <!-- Header -->
    <div class="mb-3 flex items-start justify-between">
      <div>
        <h3 class="text-sm font-semibold text-foreground">模型性能雷达</h3>
        <p class="text-xs text-muted-foreground mt-0.5">六维归一化对比 · 点击模型标签叠加显示</p>
      </div>
      <!-- TPS 类型切换 -->
      <div class="flex items-center gap-1 bg-muted/60 rounded-lg p-0.5">
        <button
          @click="useTpsGen = false"
          class="px-2.5 py-1 rounded text-xs font-medium transition-all"
          :class="!useTpsGen 
            ? 'bg-white text-foreground shadow-sm' 
            : 'text-muted-foreground hover:text-foreground'"
        >
          含首字TPS
        </button>
        <button
          @click="useTpsGen = true"
          class="px-2.5 py-1 rounded text-xs font-medium transition-all"
          :class="useTpsGen 
            ? 'bg-white text-foreground shadow-sm' 
            : 'text-muted-foreground hover:text-foreground'"
        >
          生成TPS
        </button>
      </div>
    </div>

    <!-- Model chips -->
    <div class="flex flex-wrap gap-2 mb-3">
      <button
        v-for="model in modelStats"
        :key="model.key"
        @click="toggleModel(model.key)"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
        :class="selectedModels.has(model.key)
          ? 'text-white shadow-md'
          : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'"
        :style="selectedModels.has(model.key) ? {
          background: model.color,
          boxShadow: `0 0 12px ${model.color}40`
        } : {}"
      >
        <span 
          class="w-2 h-2 rounded-full transition-all"
          :style="{ 
            background: model.color,
            boxShadow: selectedModels.has(model.key) ? `0 0 6px ${model.color}` : 'none'
          }"
        />
        <span>{{ model.label }}</span>
        <span class="opacity-60">{{ model.calls }}</span>
      </button>
    </div>

    <!-- Radar Chart -->
    <v-chart :option="option" :style="{ height: '420px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { RadarChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import { computeRobustRadarScores, estimateCostMicroUsd } from '@/lib/utils'

const { series } = storeToRefs(useUsageStore())

use([CanvasRenderer, RadarChart, TooltipComponent, LegendComponent])

const COLORS = [
  '#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#06b6d4',
  '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#84cc16',
]

interface ModelStat {
  key: string
  label: string
  provider: string | null
  model: string
  color: string
  calls: number
  avgTps: number
  avgTtft: number
  avgDuration: number
  hitRate: number
  efficiency: number
  scores: number[]
  rawValues: number[]
}

const selectedModels = ref<Set<string>>(new Set())
const useTpsGen = ref(false) // false: tpsTotal (含首字), true: tpsGen (纯生成)

// 计算每个模型的统计数据（采用 RMT-TPS Token 加权与鲁棒聚合）
const modelStats = computed<ModelStat[]>(() => {
  const map = new Map<string, {
    provider: string | null
    model: string
    calls: number
    sumOutputTokens: number
    sumDurationSec: number
    sumGenOutputTokens: number
    sumGenDurationSec: number
    sumTtft: number
    ttftCount: number
    sumDuration: number
    durationCount: number
    totalTokens: number
    cacheRead: number
    inputTokens: number
    cost: number
  }>()

  // 从 series 聚合
  for (const d of series.value) {
    const key = `${d.provider ?? ''}::${d.model}`
    const stat = map.get(key) ?? {
      provider: d.provider,
      model: d.model,
      calls: 0,
      sumOutputTokens: 0,
      sumDurationSec: 0,
      sumGenOutputTokens: 0,
      sumGenDurationSec: 0,
      sumTtft: 0,
      ttftCount: 0,
      sumDuration: 0,
      durationCount: 0,
      totalTokens: 0,
      cacheRead: 0,
      inputTokens: 0,
      cost: 0,
    }

    stat.calls++
    const out = d.outputTokens || 0
    let dur = d.durationMs || 0
    let ttft = d.ttftMs || 0

    // 防御性校准：极小耗时与缺失 TTFT 修复
    if (out > 0 && dur < 100) {
      dur = Math.max(200, Math.round((out / 45) * 1000))
    }
    if (ttft <= 0 && dur > 300) {
      ttft = Math.round(dur * 0.3)
    }

    if (dur > 0 && out > 0) {
      stat.sumOutputTokens += out
      stat.sumDurationSec += dur / 1000

      const genMs = dur - ttft
      // 门控：输出 >= 3 tokens 且生成时长 >= 150ms 才纳入纯生成统计
      if (out >= 3 && genMs >= 150) {
        stat.sumGenOutputTokens += out
        stat.sumGenDurationSec += genMs / 1000
      }
    }

    if (ttft > 0) {
      stat.sumTtft += ttft
      stat.ttftCount++
    }
    if (dur > 0) {
      stat.sumDuration += dur
      stat.durationCount++
    }
    stat.totalTokens += d.inputTokens + d.outputTokens + d.cacheRead + d.cacheWrite
    stat.cacheRead += d.cacheRead
    stat.inputTokens += d.inputTokens

    let cost = d.totalCost
    if (cost <= 0 && (d.inputTokens > 0 || out > 0)) {
      cost = estimateCostMicroUsd(d.provider, d.model, d.inputTokens, out, d.cacheRead, d.cacheWrite) / 1_000_000
    }
    stat.cost += cost

    map.set(key, stat)
  }

  // 转换为 ModelStat（使用 Token 加权吞吐）
  const stats: ModelStat[] = Array.from(map.entries()).map(([key, stat], idx) => {
    const weightedTpsTotal = stat.sumDurationSec > 0 ? Math.min(stat.sumOutputTokens / stat.sumDurationSec, 800) : 0
    const weightedTpsGen = stat.sumGenDurationSec > 0 
      ? Math.min(stat.sumGenOutputTokens / stat.sumGenDurationSec, 800) 
      : weightedTpsTotal
    
    const avgTps = useTpsGen.value ? weightedTpsGen : weightedTpsTotal
    const avgTtft = stat.ttftCount > 0 ? stat.sumTtft / stat.ttftCount : 0
    const avgDuration = stat.durationCount > 0 ? stat.sumDuration / stat.durationCount : 0
    const hitRate = stat.inputTokens + stat.cacheRead > 0
      ? (stat.cacheRead / (stat.inputTokens + stat.cacheRead)) * 100
      : 0
    const efficiency = stat.cost > 0 ? stat.totalTokens / stat.cost : 0

    const label = stat.provider
      ? `${stat.provider}/${shortModel(stat.model)}`
      : shortModel(stat.model)

    return {
      key,
      label,
      provider: stat.provider,
      model: stat.model,
      color: COLORS[idx % COLORS.length],
      calls: stat.calls,
      avgTps,
      avgTtft,
      avgDuration,
      hitRate,
      efficiency,
      scores: [],
      rawValues: [avgTps, avgTtft, avgDuration, hitRate, efficiency, stat.calls],
    }
  }).sort((a, b) => b.calls - a.calls)

  // 鲁棒归一化计算六维分数（贝叶斯收缩 + 鲁棒分位数打分）
  if (stats.length > 0) {
    const callsList = stats.map(s => s.calls)
    const dimensions: Array<{ values: number[]; good: 'high' | 'low' }> = [
      { values: stats.map(s => s.avgTps), good: 'high' },
      { values: stats.map(s => s.avgTtft), good: 'low' },
      { values: stats.map(s => s.avgDuration), good: 'low' },
      { values: stats.map(s => s.hitRate), good: 'high' },
      { values: stats.map(s => s.efficiency), good: 'high' },
      { values: stats.map(s => s.calls), good: 'high' },
    ]

    dimensions.forEach((dim, dimIdx) => {
      const dimScores = computeRobustRadarScores(dim.values, callsList, dim.good)
      stats.forEach((s, i) => {
        s.scores[dimIdx] = dimScores[i]
      })
    })
  }

  return stats
})

// 数据就绪后默认选中调用量最高的两个模型（仅首次）
const didInitSelection = ref(false)
watch(
  modelStats,
  list => {
    if (didInitSelection.value || list.length === 0) return
    selectedModels.value = new Set(list.slice(0, Math.min(2, list.length)).map(m => m.key))
    didInitSelection.value = true
  },
  { immediate: true },
)

function toggleModel(key: string) {
  const next = new Set(selectedModels.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  selectedModels.value = next
}

function shortModel(name: string): string {
  let m = name.split('/').pop() ?? name
  m = m.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return m.length > 20 ? m.slice(0, 18) + '…' : m
}

function fmtSec(ms: number): string {
  const s = ms / 1000
  if (s < 10) return s.toFixed(2) + 's'
  if (s < 100) return s.toFixed(1) + 's'
  return Math.round(s) + 's'
}

const option = computed(() => {
  const selected = modelStats.value.filter(m => selectedModels.value.has(m.key))

  const tpsLabel = useTpsGen.value ? '生成速度' : '总体速度'
  const dimensions = [
    { name: tpsLabel, unit: 'TPS' },
    { name: '首字响应', unit: 's' },
    { name: '完成速度', unit: 's' },
    { name: '缓存命中', unit: '%' },
    { name: '性价比', unit: 'tok/$' },
    { name: '调用规模', unit: '次' },
  ]

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any) => {
        const model = params.data.raw as ModelStat
        const tpsLabel = useTpsGen.value ? '生成速度' : '总体速度(含首字)'
        const rows = [
          [tpsLabel, model.avgTps > 0 ? `${model.avgTps.toFixed(1)} TPS` : '—'],
          ['首字延迟', model.avgTtft > 0 ? fmtSec(model.avgTtft) : '—'],
          ['平均耗时', model.avgDuration > 0 ? fmtSec(model.avgDuration) : '—'],
          ['缓存命中率', `${model.hitRate.toFixed(1)}%`],
          ['性价比', `${(model.efficiency / 1_000_000).toFixed(2)}M tok/$`],
          ['调用次数', `${model.calls.toLocaleString()}`],
        ]
        const header = `<div style="color:${model.color};font-weight:600;margin-bottom:6px">${model.label}</div>`
        const content = rows
          .map(([label, value]) =>
            `<div style="display:flex;justify-content:space-between;gap:20px">
              <span style="color:#64748b">${label}</span>
              <span style="font-weight:600">${value}</span>
            </div>`
          )
          .join('')
        return header + content
      },
    },
    radar: {
      indicator: dimensions.map(d => ({
        name: d.name,
        max: 100,
      })),
      radius: '68%',
      center: ['50%', '52%'],
      splitNumber: 5,
      axisName: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: 500,
      },
      splitLine: {
        lineStyle: { color: 'rgba(0,0,0,0.08)' },
      },
      splitArea: {
        areaStyle: {
          color: [
            'rgba(59,130,246,0.02)',
            'rgba(59,130,246,0.04)',
            'rgba(59,130,246,0.06)',
            'rgba(59,130,246,0.08)',
            'rgba(59,130,246,0.10)',
          ],
        },
      },
      axisLine: {
        lineStyle: { color: 'rgba(0,0,0,0.12)' },
      },
    },
    series: [
      {
        type: 'radar',
        data: selected.map(model => ({
          name: model.label,
          value: model.scores,
          raw: model,
          lineStyle: {
            color: model.color,
            width: 2,
            shadowColor: model.color,
            shadowBlur: 8,
          },
          itemStyle: {
            color: model.color,
            borderColor: '#fff',
            borderWidth: 2,
          },
          areaStyle: {
            color: model.color,
            opacity: 0.15,
          },
          symbol: 'circle',
          symbolSize: 6,
          emphasis: {
            lineStyle: { width: 3 },
            itemStyle: { shadowBlur: 10 },
            areaStyle: { opacity: 0.25 },
          },
        })),
      },
    ],
  }
})
</script>
