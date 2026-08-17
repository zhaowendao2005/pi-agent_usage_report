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

    <!-- 趋势拆分：共享「全部 / 局部」悬浮模式 -->
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
        <TokenUsageTrendChart :tooltip-mode="tooltipMode" />
        <TpsTrendChart :tooltip-mode="tooltipMode" />
        <LatencyTrendChart :tooltip-mode="tooltipMode" />
        <CostPerCallTrendChart :tooltip-mode="tooltipMode" />
      </div>
    </div>

    <!-- 雷达图 + 关系图 -->
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-3">
      <div class="lg:col-span-3">
        <ModelRadarChart />
      </div>
      <div class="lg:col-span-2">
        <ProviderModelChordChart />
      </div>
    </div>

    <!-- TPS 对比散点图 -->
    <TpsComparisonScatter />

    <!-- 性能分析区 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <LatencyHeatmap />
      <ModelRankBar />
    </div>

    <!-- Token 与费用分布区 -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
      <TokenPieChart />
      <CostPieChart />
      <ModelBreakdownChart />
      <div class="grid grid-rows-2 gap-3">
        <CacheRateChart />
        <CostTrendChart />
      </div>
    </div>

    <!-- 调用量与错误分析 -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <CallVolumeTreemap />
      <PerformanceFunnel />
      <ErrorSunburstChart />
    </div>

    <!-- 时间分布 -->
    <TimeDistributionBar />
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
import TpsComparisonScatter from '@/components/TpsComparisonScatter.vue'
import ModelRankBar from '@/components/ModelRankBar.vue'
import CostPieChart from '@/components/CostPieChart.vue'
import CallVolumeTreemap from '@/components/CallVolumeTreemap.vue'
import PerformanceFunnel from '@/components/PerformanceFunnel.vue'
import ErrorSunburstChart from '@/components/ErrorSunburstChart.vue'
import TimeDistributionBar from '@/components/TimeDistributionBar.vue'
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'
import type { TrendTooltipMode } from '@/lib/utils'

const { summary } = storeToRefs(useUsageStore())
const tooltipMode = ref<TrendTooltipMode>('all')

function fmtLatencySec(ms: number): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  const s = ms / 1000
  if (s < 10) return s.toFixed(2) + 's'
  if (s < 100) return s.toFixed(1) + 's'
  return Math.round(s) + 's'
}
</script>
