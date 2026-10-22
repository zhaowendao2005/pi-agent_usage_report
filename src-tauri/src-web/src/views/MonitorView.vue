<template>
  <div class="h-full flex overflow-hidden bg-background">
    <!-- Left: Session List Sidebar (1-2 Level Tree) -->
    <SessionTreeSidebar />

    <!-- Right: Workspace with Sub-Header Tabs and Subviews -->
    <div class="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
      <!-- Sub-Header -->
      <header class="h-12 shrink-0 border-b border-border bg-card/50 backdrop-blur-sm px-4 flex items-center justify-between gap-3 select-none">
        <!-- Session Identity Meta -->
        <div class="flex items-center gap-2 min-w-0">
          <TerminalIcon class="w-4 h-4 text-primary shrink-0" />
          <div class="min-w-0">
            <h2 class="text-xs font-semibold text-foreground truncate">
              {{ monitorStore.activeSession?.title || monitorStore.activeSession?.cwd || '未选择会话' }}
            </h2>
            <p class="text-[10px] text-muted-foreground truncate font-mono">
              {{ monitorStore.activeSession?.cwd }}
            </p>
          </div>
        </div>

        <!-- Center: Subview Switcher Tabs -->
        <nav class="flex items-center gap-1 bg-background/80 p-0.5 rounded-lg border border-border/80">
          <button
            v-for="tab in subTabs"
            :key="tab.id"
            @click="monitorStore.activeSubTab = tab.id"
            class="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all"
            :class="monitorStore.activeSubTab === tab.id
              ? 'bg-accent text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'"
          >
            <component :is="tab.icon" class="w-3.5 h-3.5" :class="tab.id === 'live' && monitorStore.telemetry.isActive ? 'text-emerald-400' : ''" />
            <span>{{ tab.label }}</span>

            <!-- Pulsing dot for live tab -->
            <span
              v-if="tab.id === 'live' && monitorStore.telemetry.isActive"
              class="size-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5"
            />
          </button>
        </nav>

        <!-- Right: Real-time Live Capsule (Zero height impact) -->
        <div class="flex items-center gap-2">
          <button
            @click="monitorStore.activeSubTab = 'live'"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono transition-colors"
            :class="[
              monitorStore.telemetry.isActive
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-border/60 bg-secondary/50 text-muted-foreground hover:text-foreground'
            ]"
            title="点击切换到实时流诊断大盘"
          >
            <span
              class="size-1.5 rounded-full"
              :class="monitorStore.telemetry.isActive ? 'bg-emerald-400 animate-ping' : 'bg-muted-foreground/40'"
            />
            <span v-if="monitorStore.telemetry.isActive">
              {{ (monitorStore.telemetry.silenceDurationMs / 1000).toFixed(1) }}s 前 · {{ monitorStore.telemetry.tpsCurrent.toFixed(0) }} tok/s
            </span>
            <span v-else>待命中</span>
          </button>

          <!-- Refresh button -->
          <button
            @click="monitorStore.refreshCurrentTreeSilently()"
            title="刷新当前会话节点树"
            class="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcwIcon class="w-3.5 h-3.5" :class="{ 'animate-spin': monitorStore.isLoadingTree }" />
          </button>
        </div>
      </header>

      <!-- Viewport Content Area -->
      <main class="flex-1 min-h-0 overflow-hidden relative">
        <Transition name="fade" mode="out-in">
          <ExecutionTreeView v-if="monitorStore.activeSubTab === 'tree'" />
          <LiveInspectorView v-else-if="monitorStore.activeSubTab === 'live'" />
          <NodeDetailDrawer v-else-if="monitorStore.activeSubTab === 'detail'" />
          <SessionOverviewView v-else-if="monitorStore.activeSubTab === 'summary'" />
        </Transition>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import {
  GitForkIcon,
  ActivityIcon,
  FileSearchIcon,
  BarChart3Icon,
  TerminalIcon,
  RotateCcwIcon,
} from 'lucide-vue-next'
import { useMonitorStore } from '@/stores/monitor'
import SessionTreeSidebar from './monitor/components/SessionTreeSidebar.vue'
import ExecutionTreeView from './monitor/components/ExecutionTreeView.vue'
import LiveInspectorView from './monitor/components/LiveInspectorView.vue'
import NodeDetailDrawer from './monitor/components/NodeDetailDrawer.vue'
import SessionOverviewView from './monitor/components/SessionOverviewView.vue'

const monitorStore = useMonitorStore()

const subTabs = [
  { id: 'tree' as const, label: '执行节点树', icon: GitForkIcon },
  { id: 'live' as const, label: '实时流诊断', icon: ActivityIcon },
  { id: 'detail' as const, label: '节点调用透视', icon: FileSearchIcon },
  { id: 'summary' as const, label: '会话概览', icon: BarChart3Icon },
]

onMounted(() => {
  monitorStore.fetchWorkspaces()
  monitorStore.startLivePolling()
})

onUnmounted(() => {
  monitorStore.stopLivePolling()
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.1s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
