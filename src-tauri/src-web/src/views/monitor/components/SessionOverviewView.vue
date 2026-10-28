<template>
  <div class="h-full flex flex-col overflow-y-auto bg-background text-xs select-none">
    <div v-if="!monitorStore.activeSession" class="py-20 text-center text-muted-foreground">
      未选择会话
    </div>

    <div v-else class="flex-1 flex flex-col divide-y divide-border">
      <!-- Top Session Identity Bar -->
      <div class="px-5 py-3 flex items-center justify-between bg-secondary/15">
        <div class="flex items-center gap-2.5">
          <span class="text-xs font-bold uppercase tracking-wider text-foreground">
            SESSION OVERVIEW / 会话全局度量矩阵
          </span>
          <span
            v-if="monitorStore.currentSessionTelemetry.isActive"
            class="px-1.5 py-0 border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-[10px]"
          >
            ● LIVE
          </span>
        </div>
        <span class="text-[11px] text-muted-foreground font-mono">
          ID: {{ monitorStore.activeSession.id }}
        </span>
      </div>

      <!-- 4-Column Open Structural Metric Grid (No Enclosed Cards) -->
      <div class="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
        <div class="p-5">
          <span class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block">
            TOTAL NODES / 总节点数
          </span>
          <span class="text-2xl font-bold font-mono text-foreground mt-1.5 block">
            {{ totalNodes }}
          </span>
        </div>

        <div class="p-5">
          <span class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block">
            TOTAL TOKENS / 总 Token 消耗
          </span>
          <span class="text-2xl font-bold font-mono text-primary mt-1.5 block">
            {{ totalTokens.toLocaleString() }}
          </span>
        </div>

        <div class="p-5">
          <span class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block">
            ACTIVE TIME / 累计调用耗时
          </span>
          <span class="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1.5 block">
            {{ (totalDurationMs / 1000).toFixed(1) }}s
          </span>
        </div>

        <div class="p-5">
          <span class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block">
            EST. COST / 估算总花费
          </span>
          <span class="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1.5 block">
            ${{ totalCostUsd.toFixed(4) }}
          </span>
        </div>
      </div>

      <!-- Two-Column Open Grid: Models & Tools Breakdown -->
      <div class="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        <!-- Left Column: Models Used -->
        <div class="flex flex-col">
          <div class="h-8 px-5 border-b border-border flex items-center justify-between bg-secondary/10 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span class="font-semibold text-foreground">MODEL DISTRIBUTION / 使用模型分布</span>
            <span>{{ modelsUsed.length }} MODELS</span>
          </div>
          <div v-if="modelsUsed.length === 0" class="py-12 text-center text-muted-foreground text-[11px]">
            暂无模型记录
          </div>
          <div v-else class="divide-y divide-border/50">
            <div
              v-for="m in modelsUsed"
              :key="m.name"
              class="flex items-center justify-between px-5 py-2.5 text-xs hover:bg-accent/40 transition-colors"
            >
              <span class="font-mono font-medium text-foreground">{{ m.name }}</span>
              <span class="text-muted-foreground font-mono">{{ m.count }} 次调用</span>
            </div>
          </div>
        </div>

        <!-- Right Column: Tool Breakdown -->
        <div class="flex flex-col">
          <div class="h-8 px-5 border-b border-border flex items-center justify-between bg-secondary/10 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span class="font-semibold text-foreground">TOOL MIX / 工具调用分布</span>
            <span>{{ totalToolCalls }} CALLS</span>
          </div>
          <div v-if="toolCallsBreakdown.length === 0" class="py-12 text-center text-muted-foreground text-[11px]">
            暂无工具调用记录
          </div>
          <div v-else class="divide-y divide-border/50">
            <div
              v-for="t in toolCallsBreakdown"
              :key="t.name"
              class="flex items-center justify-between px-5 py-2.5 text-xs hover:bg-accent/40 transition-colors"
            >
              <div class="flex items-center gap-2">
                <span class="size-1.5 rounded-full bg-sky-500" />
                <span class="font-mono text-foreground font-medium">{{ t.name }}</span>
              </div>
              <span class="text-muted-foreground font-mono">{{ t.count }} 次</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useMonitorStore } from '@/stores/monitor'

const monitorStore = useMonitorStore()

const nodes = computed(() => monitorStore.sessionTree?.nodes ?? [])
const totalNodes = computed(() => nodes.value.length)

const totalTokens = computed(() => {
  return nodes.value.reduce((acc, n) => acc + (n.tokens ?? 0), 0)
})

const totalDurationMs = computed(() => {
  return nodes.value.reduce((acc, n) => acc + (n.durationMs ?? 0), 0)
})

const totalCostUsd = computed(() => {
  return nodes.value.reduce((acc, n) => acc + (n.cost ?? 0), 0)
})

const modelsUsed = computed(() => {
  const map = new Map<string, number>()
  for (const n of nodes.value) {
    if (n.entryType === 'model_change') {
      const modelId = n.model || n.detail?.modelId || 'unknown'
      map.set(modelId, (map.get(modelId) || 0) + 1)
    } else if (n.role === 'assistant') {
      const m = n.model || n.detail?.message?.model
      if (m) {
        map.set(m, (map.get(m) || 0) + 1)
      }
    }
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
})

const toolCallsBreakdown = computed(() => {
  const map = new Map<string, number>()
  for (const n of nodes.value) {
    if (n.role === 'toolResult') {
      const name = n.toolName || n.detail?.message?.toolName || 'tool'
      map.set(name, (map.get(name) || 0) + 1)
    } else if (n.role === 'bashExecution') {
      map.set('bash', (map.get('bash') || 0) + 1)
    }
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
})

const totalToolCalls = computed(() => {
  return toolCallsBreakdown.value.reduce((acc, t) => acc + t.count, 0)
})
</script>
