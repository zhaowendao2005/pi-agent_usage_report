<template>
  <div class="h-full flex flex-col p-4 space-y-4 overflow-y-auto bg-background text-xs select-none">
    <div v-if="!monitorStore.activeSession" class="py-20 text-center text-muted-foreground">
      未选择会话
    </div>

    <div v-else class="space-y-4">
      <!-- Session Meta Header -->
      <div class="p-4 rounded-xl border border-border bg-card/60 shadow-sm space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-foreground">会话全景画像</span>
            <span v-if="monitorStore.activeSession.isLive" class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono text-[10px] animate-pulse">
              ● Live 活跃中
            </span>
          </div>
          <span class="text-xs text-muted-foreground font-mono">{{ monitorStore.activeSession.id }}</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div class="p-3 rounded-lg bg-background/70 border border-border">
            <span class="text-[10px] text-muted-foreground block">总节点数</span>
            <span class="text-lg font-bold font-mono text-foreground mt-0.5 block">
              {{ totalNodes }}
            </span>
          </div>

          <div class="p-3 rounded-lg bg-background/70 border border-border">
            <span class="text-[10px] text-muted-foreground block">总 Token 消耗</span>
            <span class="text-lg font-bold font-mono text-primary mt-0.5 block">
              {{ totalTokens.toLocaleString() }}
            </span>
          </div>

          <div class="p-3 rounded-lg bg-background/70 border border-border">
            <span class="text-[10px] text-muted-foreground block">累计调用耗时</span>
            <span class="text-lg font-bold font-mono text-emerald-400 mt-0.5 block">
              {{ (totalDurationMs / 1000).toFixed(1) }}s
            </span>
          </div>

          <div class="p-3 rounded-lg bg-background/70 border border-border">
            <span class="text-[10px] text-muted-foreground block">估算总花费</span>
            <span class="text-lg font-bold font-mono text-amber-400 mt-0.5 block">
              ${{ totalCostUsd.toFixed(4) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Two Column: Models & Tools distribution -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Models used -->
        <div class="rounded-xl border border-border bg-card/60 p-4 shadow-sm space-y-3">
          <h4 class="text-xs font-semibold text-foreground flex items-center justify-between">
            <span>使用模型分布</span>
            <span class="text-[10px] text-muted-foreground font-normal">{{ modelsUsed.length }} 种模型</span>
          </h4>
          <div v-if="modelsUsed.length === 0" class="py-6 text-center text-muted-foreground text-[11px]">
            暂无模型记录
          </div>
          <div v-else class="space-y-1.5">
            <div
              v-for="m in modelsUsed"
              :key="m.name"
              class="flex items-center justify-between p-2 rounded bg-background/50 border border-border/60 text-[11px]"
            >
              <span class="font-mono font-medium text-foreground">{{ m.name }}</span>
              <span class="text-muted-foreground font-mono">{{ m.count }} 次回复</span>
            </div>
          </div>
        </div>

        <!-- Tool breakdown -->
        <div class="rounded-xl border border-border bg-card/60 p-4 shadow-sm space-y-3">
          <h4 class="text-xs font-semibold text-foreground flex items-center justify-between">
            <span>工具调用分布 (Tool Mix)</span>
            <span class="text-[10px] text-muted-foreground font-normal">{{ totalToolCalls }} 次调用</span>
          </h4>
          <div v-if="toolCallsBreakdown.length === 0" class="py-6 text-center text-muted-foreground text-[11px]">
            暂无工具调用记录
          </div>
          <div v-else class="space-y-1.5">
            <div
              v-for="t in toolCallsBreakdown"
              :key="t.name"
              class="flex items-center justify-between p-2 rounded bg-background/50 border border-border/60 text-[11px]"
            >
              <div class="flex items-center gap-1.5">
                <span class="size-1.5 rounded-full bg-sky-400" />
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
      const modelId = n.detail.modelId || 'unknown'
      map.set(modelId, (map.get(modelId) || 0) + 1)
    } else if (n.role === 'assistant' && n.detail.message?.model) {
      const m = n.detail.message.model
      map.set(m, (map.get(m) || 0) + 1)
    }
  }
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
})

const toolCallsBreakdown = computed(() => {
  const map = new Map<string, number>()
  for (const n of nodes.value) {
    if (n.role === 'toolResult') {
      const name = n.detail.message?.toolName || 'tool'
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
