<template>
  <div class="bg-card border border-border rounded-lg p-4">
    <!-- 顶栏：标题 + 分组切换 + 筛选开关 -->
    <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-foreground">模型用量分布</h3>
        <p class="text-xs text-muted-foreground mt-0.5">
          堆叠条形 · Token 构成 · 计费单位 M
          <span class="text-muted-foreground/70">
            · 已选 {{ selectedModelCount }}/{{ totalModelCount }} 模型
          </span>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors"
          :class="
            showFilter
              ? 'border-primary/50 bg-primary/5 text-primary'
              : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
          "
          :title="showFilter ? '收起提供商/模型筛选树' : '展开提供商/模型筛选树'"
          @click="showFilter = !showFilter"
        >
          <ListFilterIcon class="w-3 h-3" />
          <span>筛选树</span>
          <span v-if="excludedCount > 0" class="font-mono">(-{{ excludedCount }})</span>
        </button>
        <div class="flex shrink-0 rounded-md border border-border bg-muted/40 p-0.5">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="px-2 py-1 text-[11px] rounded transition-colors"
            :class="
              groupMode === tab.key
                ? 'bg-background text-foreground shadow-sm font-medium'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="groupMode = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="flex flex-col lg:flex-row gap-4 min-w-0">
      <!-- 左：提供商 → 模型 筛选树 -->
      <aside
        v-if="showFilter"
        class="w-full lg:w-64 shrink-0 border border-border/70 rounded-md bg-secondary/10 flex flex-col max-h-[380px]"
      >
        <div class="px-2 py-1.5 border-b border-border/60 flex items-center justify-between gap-2">
          <span class="text-[11px] font-medium text-foreground">提供商 / 模型</span>
          <div class="flex items-center gap-1.5 text-[10px]">
            <button
              type="button"
              class="text-primary hover:underline cursor-pointer"
              @click="includeAllModels"
            >
              全选
            </button>
            <span class="text-border">/</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
              @click="excludeAllModels"
            >
              全不选
            </button>
          </div>
        </div>

        <div class="p-2 border-b border-border/60">
          <div class="relative">
            <SearchIcon class="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            <input
              v-model="filterQuery"
              type="text"
              placeholder="搜索提供商或模型..."
              class="w-full bg-background border border-border pl-7 pr-6 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
            <button
              v-if="filterQuery"
              type="button"
              class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              @click="filterQuery = ''"
            >
              <XIcon class="w-3 h-3" />
            </button>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto py-1">
          <p v-if="visibleTree.length === 0" class="px-3 py-6 text-center text-[11px] text-muted-foreground">
            无匹配的提供商或模型
          </p>

          <div v-for="provider in visibleTree" :key="provider.key" class="select-none">
            <!-- 提供商行：勾选整组 / 展开收起 -->
            <div
              class="group flex items-center gap-1 h-6 pl-1 pr-2 cursor-pointer hover:bg-accent/50 transition-colors"
              :title="`${provider.label} · ${provider.models.length} 个模型 · ${formatTokensM(provider.total)} tokens`"
              @click="toggleProvider(provider)"
            >
              <button
                type="button"
                class="w-4 h-4 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
                :aria-label="isProviderCollapsed(provider.key) ? '展开' : '收起'"
                @click.stop="toggleProviderCollapsed(provider.key)"
              >
                <ChevronRightIcon
                  class="w-3 h-3 transition-transform duration-100"
                  :class="{ 'rotate-90': !isProviderCollapsed(provider.key) }"
                />
              </button>
              <input
                type="checkbox"
                class="w-3 h-3 shrink-0 accent-primary cursor-pointer"
                :checked="providerState(provider) === 'all'"
                :indeterminate.prop="providerState(provider) === 'partial'"
                @click.stop
                @change="toggleProvider(provider)"
              />
              <span
                class="text-[11px] font-medium truncate"
                :class="providerState(provider) === 'none' ? 'text-muted-foreground/60 line-through' : 'text-foreground'"
              >
                {{ provider.label }}
              </span>
              <span class="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                {{ provider.models.length }}
              </span>
            </div>

            <!-- 模型行 -->
            <div v-if="!isProviderCollapsed(provider.key)" class="relative">
              <span class="pointer-events-none absolute inset-y-0 left-[15.5px] w-px bg-border/70" />
              <div
                v-for="model in provider.models"
                :key="model.key"
                class="group/model flex items-center gap-1.5 h-6 pl-[26px] pr-2 cursor-pointer hover:bg-accent/40 transition-colors"
                :title="`${model.label} · ${formatTokensM(model.total)} tokens · $${model.cost.toFixed(4)}\n双击 = 仅看该模型`"
                @click="toggleModel(model.key)"
                @dblclick.stop="includeOnlyModel(model.key)"
              >
                <input
                  type="checkbox"
                  class="w-3 h-3 shrink-0 accent-primary cursor-pointer"
                  :checked="!excludedKeys.has(model.key)"
                  @click.stop
                  @change="toggleModel(model.key)"
                />
                <span
                  class="text-[11px] truncate"
                  :class="excludedKeys.has(model.key) ? 'text-muted-foreground/60 line-through' : 'text-foreground/90'"
                >
                  {{ model.label }}
                </span>
                <span class="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {{ formatTokensM(model.total, 1) }}
                </span>
                <button
                  type="button"
                  class="opacity-0 group-hover/model:opacity-100 shrink-0 text-[10px] text-primary hover:underline cursor-pointer"
                  title="仅看该模型"
                  @click.stop="includeOnlyModel(model.key)"
                >
                  仅此
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="excludedCount > 0" class="px-2 py-1.5 border-t border-border/60 flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted-foreground font-mono">已筛除 {{ excludedCount }} 项</span>
          <button
            type="button"
            class="text-[10px] text-primary hover:underline cursor-pointer"
            @click="includeAllModels"
          >
            重置
          </button>
        </div>
      </aside>

      <!-- 右：摘要 + 图表 -->
      <div class="flex-1 min-w-0">
        <!-- 顶部摘要 -->
        <div class="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div
            v-for="chip in typeChips"
            :key="chip.name"
            class="rounded-lg border border-border/60 px-2 py-1.5"
          >
            <div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span class="h-1.5 w-1.5 rounded-full" :style="{ background: chip.color }" />
              {{ chip.name }}
            </div>
            <div class="mt-0.5 text-sm font-semibold tabular-nums" :style="{ color: chip.color }">
              {{ formatTokensM(chip.value) }}
            </div>
            <div class="text-[10px] text-muted-foreground">{{ chip.pct }}%</div>
          </div>
        </div>

        <div
          v-if="groups.length === 0"
          class="flex flex-col items-center justify-center py-16 gap-2 text-xs text-muted-foreground"
        >
          <p>当前筛选条件下没有可展示的模型</p>
          <button
            type="button"
            class="px-3 py-1.5 border border-border bg-secondary/30 text-xs text-primary hover:bg-accent cursor-pointer"
            @click="includeAllModels"
          >
            重置筛选
          </button>
        </div>
        <v-chart
          v-else
          :option="option"
          :style="{ height: `${chartHeight}px` }"
          autoresize
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components'
import { storeToRefs } from 'pinia'
import { ChevronRightIcon, ListFilterIcon, SearchIcon, XIcon } from 'lucide-vue-next'
import { useUsageStore } from '@/stores/usage'
import type { ModelUsage } from '@/stores/usage'
import { formatTokensM } from '@/lib/utils'

const { modelUsage } = storeToRefs(useUsageStore())

use([CanvasRenderer, BarChart, TooltipComponent, GridComponent, LegendComponent])

type GroupMode = 'provider' | 'model' | 'provider_model'

const tabs: { key: GroupMode; label: string }[] = [
  { key: 'provider', label: '提供商' },
  { key: 'model', label: '模型' },
  { key: 'provider_model', label: '提供商+模型' },
]

const groupMode = ref<GroupMode>('model')

const TOKEN_TYPES = [
  { key: 'cacheRead' as const, name: '缓存命中', color: '#22c55e' },
  { key: 'cacheWrite' as const, name: '缓存写入', color: '#f59e0b' },
  { key: 'input' as const, name: '输入', color: '#3b82f6' },
  { key: 'output' as const, name: '输出', color: '#a855f7' },
]

interface GroupSlice {
  name: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  total: number
}

function shortModel(name: string): string {
  let m = name.split('/').pop() ?? name
  m = m.replace(/^claude-/, '')
  m = m.replace(/-\d{6,8}$/, '')
  return m
}

function groupLabel(m: ModelUsage, mode: GroupMode): string {
  const model = shortModel(m.model || 'unknown')
  switch (mode) {
    case 'provider':
      return m.provider ?? '(未知提供商)'
    case 'model':
      return model
    case 'provider_model':
      return m.provider ? `${m.provider} / ${model}` : model
  }
}

/* ------------------------------------------------------------------ *
 * 筛选树（提供商 → 模型）
 * 采用「排除集合」语义：默认空集合 = 全部选中；只记录被取消勾选的叶子。
 * ------------------------------------------------------------------ */

const showFilter = ref(true)
const filterQuery = ref('')
const excludedKeys = ref<Set<string>>(new Set())
const collapsedProviders = ref<Set<string>>(new Set())

function leafKey(provider: string | null, model: string): string {
  return `${provider ?? '\u0000'}::${model}`
}

const totalModelCount = computed(() => modelUsage.value.length)

const allLeafKeys = computed(() => new Set(modelUsage.value.map((r) => leafKey(r.provider, r.model))))

/** 只统计当前数据里真实存在的被排除项，避免时间窗切换后残留计数 */
const excludedCount = computed(() => {
  let n = 0
  for (const key of excludedKeys.value) if (allLeafKeys.value.has(key)) n += 1
  return n
})

const selectedModelCount = computed(() => totalModelCount.value - excludedCount.value)

interface ModelFilterNode {
  key: string
  label: string
  total: number
  cost: number
}

interface ProviderFilterNode {
  key: string
  label: string
  total: number
  cost: number
  models: ModelFilterNode[]
}

const allModelNodes = computed<ProviderFilterNode[]>(() => {
  interface Acc {
    key: string
    label: string
    total: number
    cost: number
    models: Map<string, ModelFilterNode>
  }
  const map = new Map<string, Acc>()
  for (const row of modelUsage.value) {
    const providerLabel = row.provider ?? '(未知提供商)'
    const providerKey = row.provider ?? '\u0000'
    let acc = map.get(providerKey)
    if (!acc) {
      acc = { key: providerKey, label: providerLabel, total: 0, cost: 0, models: new Map() }
      map.set(providerKey, acc)
    }
    const key = leafKey(row.provider, row.model)
    const total = row.inputTokens + row.outputTokens + row.cacheRead + row.cacheWrite
    const modelNode = acc.models.get(key) ?? {
      key,
      label: shortModel(row.model || 'unknown'),
      total: 0,
      cost: 0,
    }
    modelNode.total += total
    modelNode.cost += row.cost
    acc.models.set(key, modelNode)
    acc.total += total
    acc.cost += row.cost
  }
  return [...map.values()]
    .map((acc) => ({
      key: acc.key,
      label: acc.label,
      total: acc.total,
      cost: acc.cost,
      models: [...acc.models.values()].sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total)
})

const visibleTree = computed(() => {
  const q = filterQuery.value.trim().toLowerCase()
  if (!q) return allModelNodes.value
  const result: ProviderFilterNode[] = []
  for (const provider of allModelNodes.value) {
    const providerHit = provider.label.toLowerCase().includes(q)
    const models = provider.models.filter((m) => m.label.toLowerCase().includes(q))
    if (providerHit) result.push(provider)
    else if (models.length > 0) result.push({ ...provider, models })
  }
  return result
})

function providerState(provider: ProviderFilterNode): 'all' | 'none' | 'partial' {
  const excluded = provider.models.filter((m) => excludedKeys.value.has(m.key)).length
  if (excluded === 0) return 'all'
  if (excluded === provider.models.length) return 'none'
  return 'partial'
}

function isProviderCollapsed(key: string): boolean {
  if (filterQuery.value.trim()) return false
  return collapsedProviders.value.has(key)
}

function toggleProviderCollapsed(key: string): void {
  const next = new Set(collapsedProviders.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedProviders.value = next
}

function toggleModel(key: string): void {
  const next = new Set(excludedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  excludedKeys.value = next
}

function toggleProvider(provider: ProviderFilterNode): void {
  const next = new Set(excludedKeys.value)
  if (providerState(provider) === 'all') {
    for (const m of provider.models) next.add(m.key)
  } else {
    for (const m of provider.models) next.delete(m.key)
  }
  excludedKeys.value = next
}

function includeAllModels(): void {
  excludedKeys.value = new Set()
}

function excludeAllModels(): void {
  excludedKeys.value = new Set(allLeafKeys.value)
}

function includeOnlyModel(key: string): void {
  const next = new Set<string>()
  for (const k of allLeafKeys.value) if (k !== key) next.add(k)
  excludedKeys.value = next
}

const visibleRows = computed(() => modelUsage.value.filter((row) => !excludedKeys.value.has(leafKey(row.provider, row.model))))

const groups = computed<GroupSlice[]>(() => {
  const map = new Map<string, GroupSlice>()
  for (const row of visibleRows.value) {
    const name = groupLabel(row, groupMode.value)
    const prev = map.get(name) ?? {
      name,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      total: 0,
    }
    prev.input += row.inputTokens
    prev.output += row.outputTokens
    prev.cacheRead += row.cacheRead
    prev.cacheWrite += row.cacheWrite
    prev.cost += row.cost
    prev.total = prev.input + prev.output + prev.cacheRead + prev.cacheWrite
    map.set(name, prev)
  }
  return [...map.values()]
    .filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 14)
})

const chartHeight = computed(() => {
  const rows = Math.max(groups.value.length, 1)
  return Math.min(520, Math.max(240, rows * 36 + 96))
})

const totals = computed(() => {
  const g = groups.value
  return {
    input: g.reduce((a, x) => a + x.input, 0),
    output: g.reduce((a, x) => a + x.output, 0),
    cacheRead: g.reduce((a, x) => a + x.cacheRead, 0),
    cacheWrite: g.reduce((a, x) => a + x.cacheWrite, 0),
  }
})

const typeChips = computed(() => {
  const t = totals.value
  const sum = t.input + t.output + t.cacheRead + t.cacheWrite || 1
  return TOKEN_TYPES.map(tt => {
    const value =
      tt.key === 'cacheRead'
        ? t.cacheRead
        : tt.key === 'cacheWrite'
          ? t.cacheWrite
          : tt.key === 'input'
            ? t.input
            : t.output
    return {
      name: tt.name,
      color: tt.color,
      value,
      pct: ((value / sum) * 100).toFixed(1),
    }
  })
})

const option = computed(() => {
  const gs = groups.value
  const names = gs.map(g => g.name).reverse()
  const series = TOKEN_TYPES.map(tt => ({
    name: tt.name,
    type: 'bar' as const,
    stack: 'tok',
    barMaxWidth: 20,
    itemStyle: {
      color: tt.color,
      borderRadius: tt.key === 'output' ? [0, 4, 4, 0] : 0,
    },
    emphasis: { focus: 'series' as const },
    data: gs
      .map(g =>
        tt.key === 'cacheRead'
          ? g.cacheRead
          : tt.key === 'cacheWrite'
            ? g.cacheWrite
            : tt.key === 'input'
              ? g.input
              : g.output,
      )
      .reverse(),
  }))

  const costByName = new Map(gs.map(g => [g.name, g.cost]))

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#334155', fontSize: 12 },
      formatter: (params: any[]) => {
        if (!params?.length) return ''
        const name = params[0].axisValue as string
        const cost = costByName.get(name) ?? 0
        const sum = params.reduce((a, p) => a + (Number(p.value) || 0), 0)
        const rows = params
          .filter(p => Number(p.value) > 0)
          .map(
            p =>
              `<div style="display:flex;justify-content:space-between;gap:18px">
                <span style="color:${p.color}">● ${p.seriesName}</span>
                <span style="font-weight:600">${formatTokensM(Number(p.value))}</span>
              </div>`,
          )
          .join('')
        return (
          `<div style="font-weight:600;margin-bottom:4px">${name}</div>` +
          `<div style="color:#64748b;font-size:11px;margin-bottom:6px">合计 ${formatTokensM(sum)} · $${cost.toFixed(4)}</div>` +
          rows
        )
      },
    },
    legend: {
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#64748b', fontSize: 11 },
      data: TOKEN_TYPES.map(t => t.name),
    },
    grid: {
      top: 8,
      right: 16,
      bottom: 36,
      left: 8,
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        formatter: (v: number) => formatTokensM(v, 2),
      },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)', type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
      axisLabel: {
        color: '#64748b',
        fontSize: 10,
        width: 160,
        overflow: 'truncate',
      },
    },
    series,
  }
})
</script>
