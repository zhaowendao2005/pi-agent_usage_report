<template>
  <div class="min-h-screen bg-background text-foreground flex flex-col">
    <!-- ===== Top Header ===== -->
    <header class="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div class="px-4 h-12 flex items-center justify-between">
        <!-- Brand -->
        <div class="flex items-center gap-2.5">
          <img
            src="/logo.svg"
            alt="Usage Report"
            class="w-7 h-7 rounded-[7px] shadow-sm border border-border/60 bg-white object-cover"
            width="28"
            height="28"
          />
          <span class="text-sm font-semibold text-foreground">Pi Agent</span>
          <span class="text-muted-foreground text-sm">/</span>
          <span class="text-sm text-muted-foreground">Token Monitor</span>
        </div>

        <!-- Tab nav -->
        <nav class="flex items-center gap-1">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all"
            :class="activeTab === tab.id
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'"
          >
            <component :is="tab.icon" class="w-3.5 h-3.5" />
            {{ tab.label }}
          </button>
        </nav>

        <!-- Right info -->
        <div class="flex items-center gap-3 text-xs text-muted-foreground">
          <span class="flex items-center gap-1">
            <span
              class="w-1.5 h-1.5 rounded-full"
              :class="isLive ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'"
            />
            {{ isLive ? 'Live' : 'Static' }}
          </span>
          <span class="font-mono">{{ currentTime }}</span>
        </div>
      </div>
    </header>

    <!-- ===== Control Bar (sub-header) ===== -->
    <div class="border-b border-border bg-background/80 px-4 py-2 sticky top-12 z-40">
      <ControlBar />
    </div>

    <!-- ===== Main Content ===== -->
    <main class="flex-1 p-4 overflow-auto">
      <Transition name="fade" mode="out-in">
        <StatsView  v-if="activeTab === 'stats'" />
        <DetailView v-else-if="activeTab === 'detail'" />
        <PriceCalibrationView v-else-if="activeTab === 'price'" />
        <ConfigView v-else-if="activeTab === 'config'" />
      </Transition>
    </main>

    <!-- ===== Footer ===== -->
    <footer class="border-t border-border px-4 py-2 text-xs text-muted-foreground flex items-center justify-between">
      <span>Pi Agent Token Monitor</span>
      <span>刷新间隔 {{ refreshInterval }}s · {{ series.length }} 次调用</span>
    </footer>

    <!-- ===== Global Message (toast + confirm) ===== -->
    <AppMessage />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { ActivityIcon, BarChart2Icon, ListIcon, SettingsIcon } from 'lucide-vue-next'
import CalibrationIcon from '@/components/icons/CalibrationIcon.vue'
import AppMessage   from '@/components/AppMessage.vue'
import ControlBar   from '@/components/ControlBar.vue'
import StatsView    from '@/views/StatsView.vue'
import DetailView   from '@/views/DetailView.vue'
import PriceCalibrationView from '@/views/PriceCalibrationView.vue'
import ConfigView   from '@/views/ConfigView.vue'
import { useUsageStore } from '@/stores/usage'

const store = useUsageStore()
const { isLive, refreshInterval, series } = storeToRefs(store)

const tabs = [
  { id: 'stats',  label: '统计',  icon: BarChart2Icon },
  { id: 'detail', label: '明细',  icon: ListIcon      },
  { id: 'price',  label: '价格校准', icon: CalibrationIcon },
  { id: 'config', label: '配置',  icon: SettingsIcon  },
]

const activeTab  = ref('stats')
const currentTime = ref('')

function updateTime() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  currentTime.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

let clockTimer: ReturnType<typeof setInterval>
onMounted(() => { updateTime(); clockTimer = setInterval(updateTime, 1000) })
onUnmounted(() => clearInterval(clockTimer))
</script>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
