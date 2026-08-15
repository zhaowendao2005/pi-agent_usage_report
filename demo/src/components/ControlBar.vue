<template>
  <div class="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg">
    <!-- Time presets -->
    <div class="flex items-center gap-1">
      <button
        v-for="p in presets"
        :key="p.value"
        @click="applyTimePreset(p.value)"
        class="px-2 py-1 text-xs rounded transition-colors"
        :class="activePreset === p.value
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
      >{{ p.label }}</button>
    </div>

    <div class="w-px h-5 bg-border mx-1" />

    <!-- Time range inputs -->
    <div class="flex items-center gap-1.5 text-xs">
      <CalendarIcon class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <input
        v-model="startTime"
        type="text"
        placeholder="YYYY-MM-DD HH:mm:ss"
        class="w-40 bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
        @change="onRangeChange"
      />
      <span class="text-muted-foreground">→</span>
      <input
        v-model="endTime"
        type="text"
        placeholder="YYYY-MM-DD HH:mm:ss"
        class="w-40 bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
        @change="onRangeChange"
      />
    </div>

    <div class="w-px h-5 bg-border mx-1" />

    <!-- Refresh interval -->
    <div class="flex items-center gap-1.5 text-xs">
      <RefreshCwIcon class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span class="text-muted-foreground whitespace-nowrap">刷新间隔</span>
      <div class="flex items-center gap-1">
        <button
          v-for="iv in intervalPresets"
          :key="iv.value"
          @click="setRefreshInterval(iv.value)"
          class="px-2 py-1 rounded transition-colors whitespace-nowrap"
          :class="refreshInterval === iv.value
            ? 'bg-secondary text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
        >{{ iv.label }}</button>
      </div>
      <input
        v-model.number="customInterval"
        type="number"
        min="1"
        placeholder="自定义(s)"
        class="w-20 bg-background border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        @keydown.enter="applyCustomInterval"
        @blur="applyCustomInterval"
      />
    </div>

    <div class="w-px h-5 bg-border mx-1" />

    <!-- Live toggle -->
    <button
      @click="toggleLive"
      class="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all"
      :class="isLive
        ? 'bg-green-500/15 text-green-600 border border-green-500/30'
        : 'bg-secondary text-muted-foreground border border-border hover:text-foreground'"
    >
      <span
        class="w-1.5 h-1.5 rounded-full"
        :class="isLive ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'"
      />
      {{ isLive ? 'LIVE' : '手动' }}
    </button>

    <!-- Manual refresh -->
    <button
      @click="refreshData"
      class="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="立即刷新"
    >
      <RefreshCwIcon class="w-3.5 h-3.5" :class="{ 'animate-spin': spinning }" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { CalendarIcon, RefreshCwIcon } from 'lucide-vue-next'
import {
  startTime,
  endTime,
  refreshInterval,
  isLive,
  refreshData as doRefresh,
  setLive,
  setRefreshInterval,
  applyTimePreset as doPreset,
} from '@/composables/useTokenData'

const presets = [
  { label: '15m', value: '15m' },
  { label: '1h',  value: '1h'  },
  { label: '6h',  value: '6h'  },
  { label: '24h', value: '24h' },
  { label: '7d',  value: '7d'  },
]

const intervalPresets = [
  { label: '5s',  value: 5   },
  { label: '15s', value: 15  },
  { label: '30s', value: 30  },
  { label: '1m',  value: 60  },
  { label: '5m',  value: 300 },
]

const activePreset = ref('6h')
const customInterval = ref<number | ''>('')
const spinning = ref(false)

function applyTimePreset(preset: string) {
  activePreset.value = preset
  doPreset(preset)
}

function onRangeChange() {
  activePreset.value = ''
  doRefresh()
}

function applyCustomInterval() {
  if (customInterval.value && Number(customInterval.value) >= 1) {
    setRefreshInterval(Number(customInterval.value))
    customInterval.value = ''
  }
}

function toggleLive() {
  setLive(!isLive.value)
}

async function refreshData() {
  spinning.value = true
  doRefresh()
  setTimeout(() => (spinning.value = false), 600)
}
</script>
