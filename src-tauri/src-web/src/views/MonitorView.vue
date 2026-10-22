<template>
  <div class="h-full flex overflow-hidden bg-background">
    <!-- Left: Session List Sidebar (1-2 Level Tree) -->
    <SessionTreeSidebar />

    <!-- Right: Workspace with Sub-Header Tabs and Subviews -->
    <div class="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
      <!-- Tier 1: Session Breadcrumbs & Live Pulse Status Bar -->
      <div class="h-8 shrink-0 border-b border-border bg-card/30 px-3 flex items-center justify-between gap-3 select-none text-xs">
        <!-- Breadcrumb / Session Identity -->
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <TerminalIcon class="w-3.5 h-3.5 text-primary shrink-0" />
          <span class="text-muted-foreground font-mono text-[11px] shrink-0 truncate max-w-[220px]" :title="monitorStore.activeSession?.cwd">
            {{ monitorStore.activeSession?.cwd || '未选择目录' }}
          </span>
          <span class="text-muted-foreground/50 shrink-0">›</span>
          <span class="font-medium text-foreground truncate min-w-0" :title="monitorStore.activeSession?.title || monitorStore.activeSession?.fileName">
            {{ monitorStore.activeSession?.title || monitorStore.activeSession?.fileName || '未选择会话' }}
          </span>
        </div>

        <!-- Right: Telemetry Pill + Refresh -->
        <div class="flex items-center gap-2 shrink-0">
          <button
            @click="monitorStore.activeSubTab = 'live'"
            class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            :class="[
              monitorStore.telemetry.isActive
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-border/60 bg-secondary/50 text-muted-foreground hover:text-foreground'
            ]"
            title="点击直达实时流诊断大盘"
          >
            <span
              class="size-1.5 rounded-full shrink-0"
              :class="monitorStore.telemetry.isActive ? 'bg-emerald-400 animate-ping' : 'bg-muted-foreground/40'"
            />
            <span v-if="monitorStore.telemetry.isActive">
              {{ (monitorStore.telemetry.silenceDurationMs / 1000).toFixed(1) }}s 前 · {{ monitorStore.telemetry.tpsCurrent.toFixed(0) }} tok/s
            </span>
            <span v-else>待命中</span>
          </button>

          <button
            @click="monitorStore.refreshCurrentTreeSilently()"
            title="刷新当前会话节点树"
            class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
          >
            <RotateCcwIcon class="w-3.5 h-3.5" :class="{ 'animate-spin': monitorStore.isLoadingTree }" />
          </button>
        </div>
      </div>

      <!-- Tier 2: Subview Switcher Tabs & View Context Bar -->
      <div class="h-9 shrink-0 border-b border-border bg-card/60 px-3 flex items-center justify-between gap-3 select-none text-xs">
        <!-- Center/Left Tabs -->
        <nav class="flex items-center gap-1 bg-background/80 p-0.5 rounded-lg border border-border/80 shrink-0">
          <button
            v-for="tab in subTabs"
            :key="tab.id"
            @click="monitorStore.activeSubTab = tab.id"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer"
            :class="monitorStore.activeSubTab === tab.id
              ? 'bg-accent text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'"
          >
            <component :is="tab.icon" class="w-3.5 h-3.5 shrink-0" :class="tab.id === 'live' && monitorStore.telemetry.isActive ? 'text-emerald-400' : ''" />
            <span>{{ tab.label }}</span>
            <span
              v-if="tab.id === 'live' && monitorStore.telemetry.isActive"
              class="size-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5"
            />
          </button>
        </nav>

        <!-- Right Context for Active Tab -->
        <div class="flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
          <template v-if="monitorStore.activeSubTab === 'tree'">
            <span class="font-medium text-foreground">
              {{ monitorStore.visibleNodes.length }} 个节点
            </span>
            <span v-if="monitorStore.collapsedNodeIds.size > 0" class="text-primary">
              (已折叠 {{ monitorStore.collapsedNodeIds.size }} 个分支)
            </span>
            <button
              v-if="monitorStore.collapsedNodeIds.size > 0"
              @click="monitorStore.collapsedNodeIds.clear()"
              class="hover:text-foreground text-primary underline cursor-pointer"
            >
              展开全部分支
            </button>
            <span class="text-border">|</span>
            <span class="text-muted-foreground/70 hidden sm:inline">悬停可高亮祖先标定线</span>
          </template>

          <template v-else-if="monitorStore.activeSubTab === 'live'">
            <span :class="monitorStore.telemetry.isActive ? 'text-emerald-400 font-medium' : 'text-muted-foreground'">
              ● {{ monitorStore.telemetry.isActive ? '实时流式监控中' : '会话待命中' }}
            </span>
          </template>

          <template v-else-if="monitorStore.activeSubTab === 'detail'">
            <span v-if="monitorStore.selectedNode" class="font-mono text-foreground/80">
              选中节点: {{ monitorStore.selectedNode.id }} ({{ monitorStore.selectedNode.roleLabel }})
            </span>
            <span v-else class="text-muted-foreground">
              未选中节点 (在执行树中点击节点查看详情)
            </span>
          </template>

          <template v-else-if="monitorStore.activeSubTab === 'summary'">
            <span>全局会话度量透视</span>
          </template>
        </div>
      </div>

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
