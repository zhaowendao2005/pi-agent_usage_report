<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <div class="mb-3">
      <h3 class="text-sm font-semibold text-foreground">错误旭日图</h3>
      <p class="text-xs text-muted-foreground mt-0.5">提供商 → 错误类型层级分布</p>
    </div>
    <v-chart :option="option" :style="{ height: '320px' }" autoresize />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { SunburstChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { useUsageStore } from '@/stores/usage'

const { series } = storeToRefs(useUsageStore())

use([CanvasRenderer, SunburstChart, TooltipComponent])

const option = computed(() => {
  // 按提供商 → 错误类型分组
  const providerMap = new Map<string, Map<string, number>>()

  for (const d of series.value) {
    // 判断是否失败
    const isFailed =
      (d.httpStatus != null && (d.httpStatus < 200 || d.httpStatus >= 300)) ||
      d.stopReason === 'error' ||
      d.stopReason === 'aborted'

    if (!isFailed) continue

    const provider = d.provider || '未知提供商'
    let errorType = '未知错误'

    if (d.httpStatus != null && (d.httpStatus < 200 || d.httpStatus >= 300)) {
      if (d.httpStatus >= 400 && d.httpStatus < 500) errorType = '4xx 客户端错误'
      else if (d.httpStatus >= 500) errorType = '5xx 服务器错误'
      else errorType = `HTTP ${d.httpStatus}`
    } else if (d.stopReason === 'error') {
      errorType = '执行错误'
    } else if (d.stopReason === 'aborted') {
      errorType = '请求中断'
    }

    if (!providerMap.has(provider)) {
      providerMap.set(provider, new Map())
    }
    const errorMap = providerMap.get(provider)!
    errorMap.set(errorType, (errorMap.get(errorType) || 0) + 1)
  }

  // 构建旭日图数据
  const data = Array.from(providerMap.entries()).map(([provider, errorMap]) => ({
    name: provider,
    children: Array.from(errorMap.entries()).map(([errorType, count]) => ({
      name: errorType,
      value: count,
    })),
  }))

  if (data.length === 0) {
    return {
      backgroundColor: 'transparent',
      title: {
        text: '暂无错误数据',
        left: 'center',
        top: 'center',
        textStyle: { color: '#94a3b8', fontSize: 12, fontWeight: 400 },
      },
    }
  }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any) => {
        const path = params.treePathInfo?.slice(1).map((p: any) => p.name).join(' / ') || params.name
        return `
          <div style="color:#64748b;font-size:11px;margin-bottom:4px">${path}</div>
          <div style="display:flex;justify-content:space-between;gap:20px">
            <span style="color:#64748b">错误次数</span>
            <span style="font-weight:600;color:#ef4444">${params.value}</span>
          </div>
        `
      },
    },
    series: [
      {
        type: 'sunburst',
        data,
        radius: ['15%', '85%'],
        itemStyle: {
          borderRadius: 4,
          borderWidth: 2,
          borderColor: '#fff',
        },
        label: {
          fontSize: 10,
          color: '#fff',
          fontWeight: 500,
        },
        levels: [
          {},
          {
            r0: '15%',
            r: '40%',
            itemStyle: {
              borderWidth: 2,
            },
            label: {
              rotate: 'tangential',
              fontSize: 11,
            },
          },
          {
            r0: '40%',
            r: '85%',
            label: {
              position: 'outside',
              padding: 3,
              silent: false,
              fontSize: 10,
            },
            itemStyle: {
              borderWidth: 1,
            },
          },
        ],
        emphasis: {
          focus: 'ancestor',
        },
        color: ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#ec4899', '#a855f7'],
      },
    ],
  }
})
</script>
