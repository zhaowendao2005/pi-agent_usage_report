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
      />
      <StatCard
        label="总输出 Token"
        :value="summary.totalOutput"
        sub="下游 completion tokens"
        :icon="ArrowDownCircleIcon"
        accent="purple"
      />
      <StatCard
        label="缓存节省"
        :value="summary.totalCacheRead"
        sub="cache read tokens"
        :icon="DatabaseIcon"
        accent="green"
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
        label="数据点数"
        :value="summary.requestCount"
        sub="采样区间数"
        :icon="ActivityIcon"
        accent="blue"
      />
      <StatCard
        label="缓存写入"
        :value="summary.totalCacheWrite"
        sub="cache write tokens"
        :icon="HardDriveIcon"
        accent="amber"
      />
      <StatCard
        label="平均延迟"
        :value="`${summary.avgLatency}ms`"
        sub="avg response latency"
        :icon="TimerIcon"
        accent="purple"
      />
    </div>

    <!-- Token trend chart (full width) -->
    <TokenTrendChart />

    <!-- Bottom row: 3 charts -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <TokenPieChart />
      <ModelBreakdownChart />
      <div class="grid grid-rows-2 gap-3">
        <CacheRateChart />
        <CostTrendChart />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowUpCircleIcon, ArrowDownCircleIcon, DatabaseIcon, DollarSignIcon,
  ZapIcon, ActivityIcon, HardDriveIcon, TimerIcon,
} from 'lucide-vue-next'
import StatCard from '@/components/StatCard.vue'
import TokenTrendChart from '@/components/TokenTrendChart.vue'
import TokenPieChart from '@/components/TokenPieChart.vue'
import ModelBreakdownChart from '@/components/ModelBreakdownChart.vue'
import CacheRateChart from '@/components/CacheRateChart.vue'
import CostTrendChart from '@/components/CostTrendChart.vue'
import { summary } from '@/composables/useTokenData'
</script>
