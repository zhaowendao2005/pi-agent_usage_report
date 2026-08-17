<template>
  <div class="space-y-4">
    <!-- Stat cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        label="总输入 Token"
        :value="summary.totalInput"
        sub="上游 prompt tokens"
        :icon="ArrowUpCircleIcon"
        accent="blue"
        unit="token"
      />
      <StatCard
        label="总输出 Token"
        :value="summary.totalOutput"
        sub="下游 completion tokens"
        :icon="ArrowDownCircleIcon"
        accent="purple"
        unit="token"
      />
      <StatCard
        label="缓存节省"
        :value="summary.totalCacheRead"
        sub="cache read tokens"
        :icon="DatabaseIcon"
        accent="green"
        unit="token"
      />
      <StatCard
        :label="`总费用`"
        :value="`$${(+summary.totalCost).toFixed(4)}`"
        sub="USD · 本期"
        :icon="DollarSignIcon"
        accent="amber"
      />
    </div>

    <!-- secondary cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        label="缓存命中率"
        :value="`${summary.cacheHitRate}%`"
        sub="cache read / total"
        :icon="ZapIcon"
        accent="cyan"
      />
      <StatCard
        label="调用次数"
        :value="summary.requestCount"
        :sub="summary.errorCount > 0 ? `${summary.errorCount} 失败` : 'LLM 调用数'"
        :icon="ActivityIcon"
        :accent="summary.errorCount > 0 ? 'amber' : 'blue'"
        unit="count"
      />
      <StatCard
        label="缓存写入"
        :value="summary.totalCacheWrite"
        sub="cache write tokens"
        :icon="HardDriveIcon"
        accent="amber"
        unit="token"
      />
      <StatCard
        label="平均延迟"
        :value="fmtLatencySec(summary.avgLatency)"
        sub="avg response latency"
        :icon="TimerIcon"
        accent="purple"
      />
    </div>

    <!-- ===== 用量趋势 Block (Batch 1) ===== -->
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-foreground">用量趋势</h2>
          <p class="text-xs text-muted-foreground mt-0.5">Token · TPS · 延迟 · 单次费用</p>
        </div>
        <div class="flex shrink-0 rounded-md border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            class="px-2.5 py-1 text-[11px] rounded transition-colors"
            :class="tooltipMode === 'all'
              ? 'bg-background text-foreground shadow-sm font-medium'
              : 'text-muted-foreground hover:text-foreground'"
            title="悬浮显示全部指标"
            @click="tooltipMode = 'all'"
          >
            显示全部
          </button>
          <button
            type="button"
            class="px-2.5 py-1 text-[11px] rounded transition-colors"
            :class="tooltipMode === 'local'
              ? 'bg-background text-foreground shadow-sm font-medium'
              : 'text-muted-foreground hover:text-foreground'"
            title="悬浮仅显示当前图指标"
            @click="tooltipMode = 'local'"
          >
            显示局部
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <template v-if="currentRenderedBatch >= 1">
          <TokenUsageTrendChart :tooltip-mode="tooltipMode" />
          <TpsTrendChart :tooltip-mode="tooltipMode" />
          <LatencyTrendChart :tooltip-mode="tooltipMode" />
          <CostPerCallTrendChart :tooltip-mode="tooltipMode" />
        </template>
        <template v-else>
          <div v-for="i in 4" :key="'trend-sk-' + i" class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col justify-between">
            <div class="space-y-2">
              <div class="h-4 bg-muted rounded w-1/4"></div>
              <div class="h-3 bg-muted rounded w-1/3"></div>
            </div>
            <div class="flex-1 flex items-end justify-between gap-3 pt-6">
              <div v-for="j in 10" :key="j" class="bg-muted rounded-sm w-full" :style="{ height: `${[40, 65, 30, 85, 50, 75, 45, 90, 60, 70][j % 10]}%` }"></div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ===== 雷达图 + 关系图 (Batch 2) ===== -->
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-3">
      <template v-if="currentRenderedBatch >= 2">
        <div class="lg:col-span-3">
          <ModelRadarChart />
        </div>
        <div class="lg:col-span-2">
          <ProviderModelChordChart />
        </div>
      </template>
      <template v-else>
        <div class="lg:col-span-3 bg-card border border-border rounded-lg p-4 h-[480px] animate-pulse flex flex-col items-center justify-between">
          <div class="w-full space-y-2">
            <div class="h-4 bg-muted rounded w-1/4"></div>
            <div class="h-3 bg-muted rounded w-1/3"></div>
          </div>
          <div class="flex-1 flex items-center justify-center py-6 w-full">
            <div class="w-48 h-40 rounded-full border-[10px] border-muted flex items-center justify-center">
              <div class="w-28 h-24 rounded-full border-4 border-muted/40"></div>
            </div>
          </div>
        </div>
        <div class="lg:col-span-2 bg-card border border-border rounded-lg p-4 h-[480px] animate-pulse flex flex-col items-center justify-between">
          <div class="w-full space-y-2">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div class="flex-1 flex items-center justify-center py-6 w-full">
            <div class="w-36 h-36 rounded-full border-8 border-muted/50"></div>
          </div>
        </div>
      </template>
    </div>

    <!-- ===== 性能分析区 (Batch 3) ===== -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <template v-if="currentRenderedBatch >= 3">
        <TpsScatterChart />
        <LatencyHeatmap />
        <ModelRankBar />
      </template>
      <template v-else>
        <!-- Scatter Skeleton -->
        <div class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col justify-between">
          <div class="space-y-2">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div class="flex-1 relative pt-6">
            <div v-for="j in 8" :key="j" class="absolute w-2 h-2 rounded-full bg-muted" :style="{ left: `${[15, 30, 45, 60, 25, 75, 50, 85][j % 8]}%`, top: `${[70, 45, 55, 20, 80, 35, 65, 30][j % 8]}%` }"></div>
          </div>
        </div>
        <!-- Heatmap Skeleton -->
        <div class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col justify-between">
          <div class="space-y-2">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div class="flex-1 grid grid-cols-6 grid-rows-5 gap-1.5 pt-6">
            <div v-for="j in 30" :key="j" class="rounded bg-muted" :style="{ opacity: [0.1, 0.3, 0.6, 0.9, 0.4, 0.7, 0.2][j % 7] }"></div>
          </div>
        </div>
        <!-- List/Rank Skeleton -->
        <div class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col justify-between">
          <div class="space-y-2">
            <div class="h-4 bg-muted rounded w-1/4"></div>
            <div class="h-3 bg-muted rounded w-1/3"></div>
          </div>
          <div class="flex-1 space-y-4 pt-6">
            <div v-for="j in 4" :key="j" class="space-y-1">
              <div class="flex justify-between">
                <div class="h-3 bg-muted rounded w-1/4"></div>
                <div class="h-3 bg-muted rounded w-1/12"></div>
              </div>
              <div class="h-2 bg-muted rounded w-full"></div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ===== Token 与费用分布区 (Batch 4) ===== -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
      <template v-if="currentRenderedBatch >= 4">
        <TokenPieChart />
        <CostPieChart />
        <ModelBreakdownChart />
        <div class="grid grid-rows-2 gap-3">
          <CacheRateChart />
          <CostTrendChart />
        </div>
      </template>
      <template v-else>
        <!-- Pie Skeleton 1 -->
        <div class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col items-center justify-between">
          <div class="w-full space-y-2">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div class="flex-1 flex items-center justify-center">
            <div class="w-32 h-36 rounded-full border-[8px] border-muted"></div>
          </div>
        </div>
        <!-- Pie Skeleton 2 -->
        <div class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col items-center justify-between">
          <div class="w-full space-y-2">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div class="flex-1 flex items-center justify-center">
            <div class="w-32 h-36 rounded-full border-[8px] border-muted"></div>
          </div>
        </div>
        <!-- Breakdown Skeleton -->
        <div class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col justify-between">
          <div class="space-y-2">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div class="flex-1 space-y-4 pt-6">
            <div v-for="j in 4" :key="j" class="space-y-1">
              <div class="h-3 bg-muted rounded w-1/4"></div>
              <div class="h-2.5 bg-muted rounded w-full"></div>
            </div>
          </div>
        </div>
        <!-- Nested Skeletons column -->
        <div class="grid grid-rows-2 gap-3 h-[350px]">
          <div class="bg-card border border-border rounded-lg p-3 animate-pulse flex flex-col justify-between h-[168px]">
            <div class="h-3.5 bg-muted rounded w-1/3"></div>
            <div class="h-2 bg-muted rounded w-full mt-2"></div>
            <div class="flex-1 flex items-end gap-1 pt-3">
              <div v-for="j in 8" :key="j" class="bg-muted rounded w-full" :style="{ height: `${[20, 50, 35, 80, 45, 60, 25, 70][j % 8]}%` }"></div>
            </div>
          </div>
          <div class="bg-card border border-border rounded-lg p-3 animate-pulse flex flex-col justify-between h-[168px]">
            <div class="h-3.5 bg-muted rounded w-1/3"></div>
            <div class="h-2 bg-muted rounded w-full mt-2"></div>
            <div class="flex-1 flex items-end gap-1 pt-3">
              <div v-for="j in 8" :key="j" class="bg-muted rounded w-full" :style="{ height: `${[40, 20, 65, 30, 85, 50, 75, 10][j % 8]}%` }"></div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ===== 调用量与错误分析 (Batch 5) ===== -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <template v-if="currentRenderedBatch >= 5">
        <CallVolumeTreemap />
        <PerformanceFunnel />
        <ErrorSunburstChart />
      </template>
      <template v-else>
        <!-- Treemap Skeleton -->
        <div class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col justify-between">
          <div class="space-y-2">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div class="flex-1 grid grid-cols-3 grid-rows-2 gap-1.5 pt-6">
            <div class="bg-muted rounded col-span-2"></div>
            <div class="bg-muted rounded"></div>
            <div class="bg-muted rounded"></div>
            <div class="bg-muted rounded col-span-2"></div>
          </div>
        </div>
        <!-- Funnel Skeleton -->
        <div class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col items-center justify-between">
          <div class="w-full space-y-2">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div class="flex-1 flex flex-col justify-center gap-2 w-full max-w-[200px] pt-4">
            <div class="h-7 bg-muted rounded w-full"></div>
            <div class="h-7 bg-muted rounded w-[85%] mx-auto"></div>
            <div class="h-7 bg-muted rounded w-[70%] mx-auto"></div>
            <div class="h-7 bg-muted rounded w-[50%] mx-auto"></div>
          </div>
        </div>
        <!-- Sunburst Skeleton -->
        <div class="bg-card border border-border rounded-lg p-4 h-[350px] animate-pulse flex flex-col items-center justify-between">
          <div class="w-full space-y-2">
            <div class="h-4 bg-muted rounded w-1/3"></div>
            <div class="h-3 bg-muted rounded w-1/2"></div>
          </div>
          <div class="flex-1 flex items-center justify-center">
            <div class="w-32 h-32 rounded-full border-[12px] border-muted flex items-center justify-center">
              <div class="w-16 h-16 rounded-full border-4 border-muted/30"></div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ===== 时间分布 (Batch 6) ===== -->
    <template v-if="currentRenderedBatch >= 6">
      <TimeDistributionBar />
    </template>
    <template v-else>
      <div class="bg-card border border-border rounded-lg p-4 h-[200px] animate-pulse flex flex-col justify-between">
        <div class="space-y-2">
          <div class="h-4 bg-muted rounded w-1/6"></div>
          <div class="h-3 bg-muted rounded w-1/4"></div>
        </div>
        <div class="flex-1 flex items-end gap-1.5 pt-6">
          <div v-for="j in 24" :key="j" class="bg-muted rounded-t w-full" :style="{ height: `${[10, 15, 8, 5, 12, 25, 45, 60, 50, 40, 55, 65, 80, 75, 70, 85, 90, 60, 45, 35, 30, 25, 20, 15][j % 24]}%` }"></div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowUpCircleIcon, ArrowDownCircleIcon, DatabaseIcon, DollarSignIcon,
  ZapIcon, ActivityIcon, HardDriveIcon, TimerIcon,
} from 'lucide-vue-next'
import StatCard from '@/components/StatCard.vue'
import TokenUsageTrendChart from '@/components/TokenUsageTrendChart.vue'
import TpsTrendChart from '@/components/TpsTrendChart.vue'
import LatencyTrendChart from '@/components/LatencyTrendChart.vue'
import CostPerCallTrendChart from '@/components/CostPerCallTrendChart.vue'
import TokenPieChart from '@/components/TokenPieChart.vue'
import ModelBreakdownChart from '@/components/ModelBreakdownChart.vue'
import CacheRateChart from '@/components/CacheRateChart.vue'
import CostTrendChart from '@/components/CostTrendChart.vue'
import ModelRadarChart from '@/components/ModelRadarChart.vue'
import ProviderModelChordChart from '@/components/ProviderModelChordChart.vue'
import LatencyHeatmap from '@/components/LatencyHeatmap.vue'
import TpsScatterChart from '@/components/TpsScatterChart.vue'
import ModelRankBar from '@/components/ModelRankBar.vue'
import CostPieChart from '@/components/CostPieChart.vue'
import CallVolumeTreemap from '@/components/CallVolumeTreemap.vue'
import PerformanceFunnel from '@/components/PerformanceFunnel.vue'
import ErrorSunburstChart from '@/components/ErrorSunburstChart.vue'
import TimeDistributionBar from '@/components/TimeDistributionBar.vue'
import { ref, watch, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import type { TrendTooltipMode } from '@/lib/utils'

const usageStore = useUsageStore()
const { summary, loading } = storeToRefs(usageStore)
const tooltipMode = ref<TrendTooltipMode>('all')

// Staggered Progressive Rendering to prevent main thread blocking (渐进流式渲染)
const currentRenderedBatch = ref(0)
let renderTimer: ReturnType<typeof setTimeout> | null = null

function runProgressiveRender() {
  if (renderTimer) clearTimeout(renderTimer)
  currentRenderedBatch.value = 0
  
  const totalBatches = 6
  let step = 0
  
  const tick = () => {
    if (step < totalBatches) {
      step++
      currentRenderedBatch.value = step
      // Yield 80ms to the browser main thread between batches to allow layout & paint at 60fps
      renderTimer = setTimeout(tick, 80)
    }
  }
  
  renderTimer = setTimeout(tick, 30)
}

watch(loading, (newLoading) => {
  if (newLoading) {
    if (renderTimer) clearTimeout(renderTimer)
    currentRenderedBatch.value = 0 // Instant fallback to beautiful skeleton screens
  } else {
    runProgressiveRender()
  }
}, { immediate: true })

onUnmounted(() => {
  if (renderTimer) clearTimeout(renderTimer)
})

function fmtLatencySec(ms: number): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  const s = ms / 1000
  if (s < 10) return s.toFixed(2) + 's'
  if (s < 100) return s.toFixed(1) + 's'
  return Math.round(s) + 's'
}
</script>
