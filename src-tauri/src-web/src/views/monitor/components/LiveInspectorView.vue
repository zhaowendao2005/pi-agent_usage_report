<template>
  <div class="h-full flex flex-col p-4 space-y-4 overflow-y-auto bg-background select-none">
    <!-- Top Status Banner -->
    <div
      class="p-4 rounded-xl border flex items-center justify-between transition-colors shadow-sm"
      :class="getVerdictBannerClass"
    >
      <div class="flex items-center gap-3">
        <div class="p-2 rounded-lg bg-background/60 shadow-inner">
          <component :is="getVerdictIcon" class="w-6 h-6" :class="getVerdictIconColor" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-bold text-foreground">链路健康诊断结论</h3>
            <span class="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase" :class="getPhaseBadgeClass">
              {{ formatPhaseLabel(monitorStore.telemetry.phase) }}
            </span>
          </div>
          <p class="text-xs text-foreground/80 mt-0.5">
            {{ monitorStore.telemetry.diagnosticVerdict }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <span
          class="size-2.5 rounded-full"
          :class="monitorStore.telemetry.isActive ? 'bg-emerald-500 animate-ping' : 'bg-muted-foreground/40'"
        />
        <span class="text-xs font-mono font-medium text-foreground">
          {{ monitorStore.telemetry.isActive ? '实时监控中 (Live)' : '空闲待命中 (Idle)' }}
        </span>
      </div>
    </div>

    <!-- Main Grid: Left Stream & Right Telemetry Metrics -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-[460px]">
      <!-- Left Column (7 cols): (a) 实时收到内容 -->
      <div class="lg:col-span-7 rounded-xl border border-border bg-card/60 flex flex-col overflow-hidden shadow-sm">
        <div class="p-3 border-b border-border flex items-center justify-between bg-card/40">
          <div class="flex items-center gap-2">
            <TerminalIcon class="w-4 h-4 text-primary" />
            <span class="text-xs font-semibold text-foreground">(a) 实时收到内容流 (Delta Content)</span>
          </div>
          <div class="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <span>{{ monitorStore.telemetry.totalChars.toLocaleString() }} 字符</span>
            <span>·</span>
            <span>约 {{ monitorStore.telemetry.totalTokensEst }} tokens</span>
          </div>
        </div>

        <!-- Stream Content Box -->
        <div class="flex-1 p-3 overflow-y-auto font-mono text-xs text-foreground/90 bg-background/50 space-y-2">
          <div v-if="!monitorStore.telemetry.isActive && !monitorStore.telemetry.currentDeltaSnippet" class="h-full flex flex-col items-center justify-center text-muted-foreground py-16">
            <RadioIcon class="w-8 h-8 mb-2 opacity-40 animate-pulse text-primary" />
            <p>等待模型请求启动...</p>
            <p class="text-[11px] text-muted-foreground/60 mt-1">当在 Pi 中发送提问时，实时流式数据将在此呈现</p>
          </div>

          <div v-else class="space-y-3">
            <div class="p-2.5 rounded-lg bg-card/80 border border-border/80 text-[11px] leading-relaxed">
              <div class="flex items-center justify-between text-muted-foreground text-[10px] pb-1 mb-1.5 border-b border-border/40">
                <span class="font-semibold text-foreground/90">最新收包片段 (Latest Chunk):</span>
                <span>实时流式更新</span>
              </div>
              <p class="text-emerald-400 font-mono whitespace-pre-wrap break-all">
                {{ monitorStore.telemetry.currentDeltaSnippet || '(等待新 Chunk 流入...)' }}
              </p>
            </div>

            <div class="text-[11px] text-muted-foreground/80 leading-relaxed font-sans">
              <span class="font-mono text-primary font-medium">阶段说明：</span>
              当前请求处于 <strong class="text-foreground">{{ formatPhaseLabel(monitorStore.telemetry.phase) }}</strong>。
              上游提供商与模型：<span class="font-mono text-foreground">{{ monitorStore.telemetry.provider || '默认' }} / {{ monitorStore.telemetry.model || '未指定' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column (5 cols): (b) 静默心跳 + (c) 持续时间与速率 -->
      <div class="lg:col-span-5 space-y-4 flex flex-col">
        <!-- Panel (b): 距上次收到内容间隔 (Silence Duration) -->
        <div class="rounded-xl border border-border bg-card/60 p-4 shadow-sm space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <ClockIcon class="w-4 h-4 text-amber-500" />
              <span>(b) 距上次收到内容间隔 (Silence Gap)</span>
            </div>
            <span class="text-[10px] text-muted-foreground font-mono">
              警戒线: {{ monitorStore.idleWarningSec }}s
            </span>
          </div>

          <!-- Stopwatch Counter -->
          <div class="flex items-baseline gap-2">
            <span class="text-3xl font-extrabold font-mono" :class="getSilenceColorClass">
              {{ formatSeconds(monitorStore.telemetry.silenceDurationMs) }}
            </span>
            <span class="text-xs text-muted-foreground">秒无新数据</span>
          </div>

          <!-- Progress bar -->
          <div class="space-y-1">
            <div class="w-full h-2 rounded-full bg-secondary overflow-hidden">
              <div
                class="h-full transition-all duration-300 rounded-full"
                :class="getSilenceBarClass"
                :style="{ width: `${Math.min(100, (monitorStore.telemetry.silenceDurationMs / (monitorStore.idleDangerSec * 1000)) * 100)}%` }"
              />
            </div>
            <div class="flex justify-between text-[10px] text-muted-foreground/70 font-mono">
              <span>0s 极佳</span>
              <span>{{ monitorStore.idleWarningSec }}s 延迟</span>
              <span>{{ monitorStore.idleDangerSec }}s 挂死</span>
            </div>
          </div>
        </div>

        <!-- Panel (c): 持续时间与吞吐率 (Active Duration & TPS) -->
        <div class="rounded-xl border border-border bg-card/60 p-4 shadow-sm space-y-3 flex-1">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <GaugeIcon class="w-4 h-4 text-sky-500" />
              <span>(c) 持续时间与时效指标</span>
            </div>
            <span class="text-[10px] text-muted-foreground font-mono">
              {{ monitorStore.telemetry.tpsCurrent.toFixed(1) }} tok/s
            </span>
          </div>

          <div class="grid grid-cols-2 gap-2.5 pt-1">
            <!-- TTFT -->
            <div class="p-2.5 rounded-lg bg-background/70 border border-border">
              <span class="text-[10px] text-muted-foreground block">首字耗时 (TTFT)</span>
              <span class="text-base font-bold font-mono text-foreground mt-0.5 block">
                {{ monitorStore.telemetry.ttftMs ? `${monitorStore.telemetry.ttftMs}ms` : '等待中...' }}
              </span>
            </div>

            <!-- Total Duration -->
            <div class="p-2.5 rounded-lg bg-background/70 border border-border">
              <span class="text-[10px] text-muted-foreground block">累计耗时</span>
              <span class="text-base font-bold font-mono text-foreground mt-0.5 block">
                {{ formatSeconds(monitorStore.telemetry.activeDurationMs) }}s
              </span>
            </div>

            <!-- Realtime TPS -->
            <div class="p-2.5 rounded-lg bg-background/70 border border-border">
              <span class="text-[10px] text-muted-foreground block">实时吞吐率</span>
              <span class="text-base font-bold font-mono text-emerald-400 mt-0.5 block">
                {{ monitorStore.telemetry.tpsCurrent.toFixed(1) }} <span class="text-[10px] font-normal text-muted-foreground">tok/s</span>
              </span>
            </div>

            <!-- Token Counter -->
            <div class="p-2.5 rounded-lg bg-background/70 border border-border">
              <span class="text-[10px] text-muted-foreground block">生成 Token 估算</span>
              <span class="text-base font-bold font-mono text-purple-400 mt-0.5 block">
                {{ monitorStore.telemetry.totalTokensEst }}
              </span>
            </div>
          </div>

          <div class="p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-[11px] text-primary space-y-1">
            <div class="flex items-center gap-1 font-semibold">
              <InfoIcon class="w-3.5 h-3.5" />
              <span>研判参考基准</span>
            </div>
            <p class="text-[10px] text-foreground/80 leading-normal">
              首字延迟 (TTFT) 反映排队与网络握手耗时；静默间隔反映是否出现服务端单次 Chunk 断流挂起。
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  TerminalIcon,
  ClockIcon,
  GaugeIcon,
  RadioIcon,
  InfoIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  AlertOctagonIcon,
  HourglassIcon,
} from 'lucide-vue-next'
import { useMonitorStore } from '@/stores/monitor'

const monitorStore = useMonitorStore()

function formatSeconds(ms: number): string {
  if (!ms || ms <= 0) return '0.0'
  return (ms / 1000).toFixed(1)
}

function formatPhaseLabel(phase: string): string {
  switch (phase) {
    case 'waiting_ttft':
      return '等待首字 (Waiting TTFT)'
    case 'thinking':
      return '思维链推理 (Thinking)'
    case 'text':
      return '正文生成 (Text)'
    case 'tool_call':
      return '工具调用 (Tool Call)'
    default:
      return '就绪 (Idle)'
  }
}

const getPhaseBadgeClass = computed(() => {
  switch (monitorStore.telemetry.phase) {
    case 'thinking':
      return 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
    case 'text':
      return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
    case 'tool_call':
      return 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
    case 'waiting_ttft':
      return 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
    default:
      return 'bg-secondary text-muted-foreground'
  }
})

const getVerdictBannerClass = computed(() => {
  switch (monitorStore.telemetry.healthStatus) {
    case 'danger':
      return 'border-rose-500/50 bg-rose-500/10'
    case 'warning':
      return 'border-amber-500/50 bg-amber-500/10'
    case 'waiting':
      return 'border-purple-500/40 bg-purple-500/10'
    default:
      return 'border-emerald-500/40 bg-emerald-500/10'
  }
})

const getVerdictIcon = computed(() => {
  switch (monitorStore.telemetry.healthStatus) {
    case 'danger':
      return AlertOctagonIcon
    case 'warning':
      return AlertTriangleIcon
    case 'waiting':
      return HourglassIcon
    default:
      return CheckCircle2Icon
  }
})

const getVerdictIconColor = computed(() => {
  switch (monitorStore.telemetry.healthStatus) {
    case 'danger':
      return 'text-rose-500'
    case 'warning':
      return 'text-amber-500'
    case 'waiting':
      return 'text-purple-400'
    default:
      return 'text-emerald-500'
  }
})

const getSilenceColorClass = computed(() => {
  const sec = monitorStore.telemetry.silenceDurationMs / 1000
  if (sec > monitorStore.idleDangerSec) return 'text-rose-500'
  if (sec > monitorStore.idleWarningSec) return 'text-amber-500'
  if (sec > 3) return 'text-purple-400'
  return 'text-emerald-400'
})

const getSilenceBarClass = computed(() => {
  const sec = monitorStore.telemetry.silenceDurationMs / 1000
  if (sec > monitorStore.idleDangerSec) return 'bg-rose-500'
  if (sec > monitorStore.idleWarningSec) return 'bg-amber-500'
  if (sec > 3) return 'bg-purple-500'
  return 'bg-emerald-500'
})
</script>
