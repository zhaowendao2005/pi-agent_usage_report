<template>
  <div
    class="relative bg-card border border-border rounded-lg p-4 overflow-hidden transition-all hover:border-border/80"
    :class="glowClass"
  >
    <!-- background accent -->
    <div
      class="absolute inset-0 opacity-5 rounded-lg"
      :style="{ background: `radial-gradient(ellipse at top right, ${accentColor}, transparent 70%)` }"
    />

    <div class="relative flex items-start justify-between gap-3">
      <div class="flex-1 min-w-0">
        <p class="text-xs text-muted-foreground mb-1 truncate">{{ label }}</p>
        <p class="text-2xl font-bold tracking-tight text-foreground">
          {{ displayValue }}
        </p>
        <p v-if="sub" class="text-xs text-muted-foreground mt-1">{{ sub }}</p>
      </div>
      <div
        class="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
        :style="{ background: `${accentColor}1a`, color: accentColor }"
      >
        <component :is="icon" class="w-4.5 h-4.5" />
      </div>
    </div>

    <!-- trend badge -->
    <div v-if="trend !== undefined" class="relative mt-3 flex items-center gap-1">
      <span
        class="text-xs font-medium"
        :class="trend >= 0 ? 'text-green-600' : 'text-red-600'"
      >
        {{ trend >= 0 ? '↑' : '↓' }}{{ Math.abs(trend) }}%
      </span>
      <span class="text-xs text-muted-foreground">vs 上期</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label: string
  value: string | number
  sub?: string
  icon: object
  accent?: 'blue' | 'green' | 'purple' | 'amber' | 'red' | 'cyan'
  trend?: number
}>()

const accentMap: Record<string, string> = {
  blue:   '#3b82f6',
  green:  '#22c55e',
  purple: '#a855f7',
  amber:  '#f59e0b',
  red:    '#ef4444',
  cyan:   '#06b6d4',
}

const accentColor = computed(() => accentMap[props.accent ?? 'blue'])

const glowClass = computed(() => ({
  'glow-blue':   props.accent === 'blue',
  'glow-green':  props.accent === 'green',
  'glow-purple': props.accent === 'purple',
  'glow-amber':  props.accent === 'amber',
}))

const displayValue = computed(() => {
  const v = props.value
  if (typeof v === 'number') {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M'
    if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K'
    return v.toString()
  }
  return v
})
</script>
