<template>
  <div class="h-full flex overflow-hidden bg-background">
    <!-- Left: Session List Sidebar (VS Code Explorer Tree) -->
    <SessionTreeSidebar />

    <!-- Right: Workspace with Swiss Modernist Structural Grid -->
    <div class="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
      <!-- Tier 1: Session Breadcrumbs & Strictly Isolated Live Status Bar -->
      <div class="h-8 shrink-0 border-b border-border bg-background px-4 flex items-center justify-between gap-3 select-none text-xs">
        <!-- Breadcrumb / Session Identity -->
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <TerminalIcon class="w-3.5 h-3.5 text-primary shrink-0" />
          <span
            class="text-muted-foreground font-mono text-[11px] shrink-0 truncate max-w-[240px]"
            :title="monitorStore.activeSession?.cwd"
          >
            {{ monitorStore.activeSession?.cwd || '未选择目录' }}
          </span>
          <span class="text-border shrink-0">/</span>
          <span
            class="font-medium text-foreground truncate min-w-0"
            :title="monitorStore.activeSession?.title || monitorStore.activeSession?.fileName"
          >
            {{ monitorStore.activeSession?.title || monitorStore.activeSession?.fileName || '未选择会话' }}
          </span>
          <span
            v-if="monitorStore.activeSession"
            class="text-[10px] font-mono text-muted-foreground/60 shrink-0 hidden md:inline"
          >
            #{{ monitorStore.activeSession.id.slice(0, 8) }}
          </span>
        </div>

        <!-- Right: Strictly Isolated Telemetry Pill + Refresh -->
        <div class="flex items-center gap-2 shrink-0">
          <button
            @click="monitorStore.activeSubTab = 'live'"
            class="flex items-center gap-1.5 px-2.5 py-0.5 border text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            :class="[
              curTel.isActive
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15'
                : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground'
            ]"
            title="点击查看本会话实时流与传入数据明细"
          >
            <span
              class="size-1.5 rounded-full shrink-0"
              :class="curTel.isActive ? 'bg-emerald-500 animate-ping' : 'bg-muted-foreground/40'"
            />
            <span v-if="curTel.isActive">
              LIVE · {{ curTel.totalTokensEst.toLocaleString() }} tok · {{ curTel.tpsCurrent.toFixed(0) }} tok/s
            </span>
            <span v-else>
              IDLE<template v-if="curTel.totalTokensEst > 0"> · {{ curTel.totalTokensEst.toLocaleString() }} tok</template>
            </span>
          </button>

          <button
            @click="monitorStore.refreshCurrentTreeSilently()"
            title="刷新当前会话节点树"
            class="p-1 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
          >
            <RotateCcwIcon class="w-3.5 h-3.5" :class="{ 'animate-spin': monitorStore.isLoadingTree }" />
          </button>
        </div>
      </div>

      <!-- Tier 2: Subview Switcher Tabs & View Context Bar -->
      <div class="h-9 shrink-0 border-b border-border bg-background px-4 flex items-center justify-between gap-3 select-none text-xs">
        <!-- Left Swiss Grid Tabs -->
        <nav class="flex items-center h-full -mb-px shrink-0 gap-1">
          <button
            v-for="tab in subTabs"
            :key="tab.id"
            @click="monitorStore.activeSubTab = tab.id"
            class="relative h-full flex items-center gap-1.5 px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2"
            :class="monitorStore.activeSubTab === tab.id
              ? 'border-primary text-foreground font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'"
          >
            <component
              :is="tab.icon"
              class="w-3.5 h-3.5 shrink-0"
              :class="tab.id === 'live' && curTel.isActive ? 'text-emerald-500' : ''"
            />
            <span>{{ tab.label }}</span>
            <span
              v-if="tab.id === 'live' && curTel.isActive"
              class="size-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5"
            />
          </button>
        </nav>

        <!-- Right Context for Active Tab -->
        <div class="flex items-center gap-3 text-[11px] text-muted-foreground shrink-0 font-mono">
          <template v-if="monitorStore.activeSubTab === 'tree'">
            <span class="text-foreground">
              可见 {{ monitorStore.visibleNodes.length }} / 总计 {{ monitorStore.sessionTree?.totalNodes ?? 0 }} 节点
            </span>
            <span v-if="monitorStore.collapsedNodeIds.size > 0" class="text-primary font-sans">
              已收起 {{ monitorStore.collapsedNodeIds.size }} 个分支
            </span>
            <div class="flex items-center gap-1.5 font-sans">
              <button
                @click="monitorStore.expandAllNodes()"
                class="hover:text-foreground text-primary hover:underline cursor-pointer"
              >
                全部展开
              </button>
              <span class="text-border">/</span>
              <button
                @click="monitorStore.collapseAllNodes()"
                class="hover:text-foreground text-muted-foreground hover:underline cursor-pointer"
              >
                全部收起
              </button>
            </div>
          </template>

          <template v-else-if="monitorStore.activeSubTab === 'detail'">
            <span v-if="monitorStore.selectedNode" class="text-foreground/80">
              NODE: {{ monitorStore.selectedNode.id }} [{{ monitorStore.selectedNode.roleLabel }}]
            </span>
            <span v-else class="text-muted-foreground font-sans">
              未选中节点（在执行节点树中点击任一节点按需加载详情）
            </span>
          </template>

          <template v-else-if="monitorStore.activeSubTab === 'summary'">
            <span class="font-sans">会话级指标与调用结构矩阵</span>
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

    <!-- Global All Workspaces & Session Selector Modal -->
    <AllWorkspacesModal v-if="monitorStore.isAllWorkspacesModalOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
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
import AllWorkspacesModal from './monitor/components/AllWorkspacesModal.vue'

const monitorStore = useMonitorStore()
const curTel = computed(() => monitorStore.currentSessionTelemetry)

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
