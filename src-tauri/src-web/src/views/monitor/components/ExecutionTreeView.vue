<template>
  <div class="h-full flex flex-col overflow-hidden bg-background">
    <!-- Tree Viewport (Strict independent vertical scroll, no horizontal leak) -->
    <div
      ref="treeContainerEl"
      class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2 font-mono text-xs select-none"
      @mouseleave="monitorStore.setHoveredNode(null)"
    >
      <div v-if="monitorStore.isLoadingTree" class="py-12 text-center text-xs text-muted-foreground">
        <Loader2Icon class="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
        正在解析会话树与标定链路...
      </div>

      <div v-else-if="monitorStore.visibleNodes.length === 0" class="py-12 text-center text-xs text-muted-foreground">
        当前会话暂无执行节点
      </div>

      <div v-else class="w-full flex flex-col">
        <div
          v-for="node in monitorStore.visibleNodes"
          :key="node.id"
          @click="onNodeClick(node)"
          @mouseenter="monitorStore.setHoveredNode(node)"
          class="group relative flex items-center h-7 px-3 cursor-pointer transition-colors w-full min-w-0"
          :class="[
            monitorStore.activeNodeId === node.id
              ? 'bg-primary/15 text-foreground'
              : 'hover:bg-accent/40 text-foreground/80 hover:text-foreground',
            node.role === 'user' ? 'border-t border-border/40 mt-1 pt-0.5' : ''
          ]"
          :style="{ paddingLeft: `${node.depth * 22 + 12}px` }"
        >
          <!-- 1. VS Code Indent Guides (Vertical lines) -->
          <div class="absolute inset-y-0 left-0 pointer-events-none flex">
            <div
              v-for="lvl in node.depth"
              :key="lvl"
              class="indent-guide relative h-full border-l transition-colors duration-100"
              :class="[
                monitorStore.activeGuideLevels.includes(lvl - 1)
                  ? 'border-primary/80 opacity-100'
                  : 'border-border/50 group-hover:border-border/80 opacity-40'
              ]"
              :style="{ width: '22px' }"
            >
              <!-- Branch elbow connector |-- or └── if this is a branch line -->
              <span
                v-if="node.isBranchPoint && lvl === node.depth"
                class="absolute top-1/2 left-0 w-3 border-t border-border/80 -translate-y-1/2"
                :class="monitorStore.activeGuideLevels.includes(lvl - 1) ? 'border-primary/80' : ''"
              />
            </div>
          </div>

          <!-- 2. Expand/Collapse Twistie or Branch symbol -->
          <div
            v-if="node.hasChildren"
            @click.stop="monitorStore.toggleNodeCollapse(node.id)"
            class="size-4 shrink-0 flex items-center justify-center mr-1 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded transition-colors"
            :title="isCollapsed(node.id) ? '展开此轮所有步骤' : '折叠此轮执行步骤'"
          >
            <ChevronRightIcon
              class="size-3.5 transition-transform duration-150"
              :class="{ 'rotate-90': !isCollapsed(node.id) }"
            />
          </div>
          <span v-else class="w-4 shrink-0 mr-1 text-center text-muted-foreground/40 text-[10px]">
            {{ node.isBranchPoint ? '└─' : ' ' }}
          </span>

          <!-- 3. Bullet indicator dot -->
          <span
            class="size-1.5 rounded-full shrink-0 mr-1.5"
            :class="[
              node.status === 'error' || node.status === 'aborted'
                ? 'bg-rose-500'
                : node.role === 'user'
                  ? 'bg-purple-400'
                  : node.role === 'assistant'
                    ? 'bg-emerald-400'
                    : 'bg-muted-foreground/60'
            ]"
          />

          <!-- 4. Role Icon -->
          <component
            :is="getNodeIcon(node)"
            class="size-3.5 shrink-0 mr-1.5"
            :class="getIconColorClass(node)"
          />

          <!-- 5. Role Label Tag -->
          <span class="font-semibold shrink-0 mr-1.5" :class="getRoleTextClass(node)">
            {{ getDisplayRole(node) }}
          </span>

          <!-- 5.1 Badge for User Turn step count (Clickable to collapse/expand) -->
          <button
            v-if="node.role === 'user' && node.childrenIds.length > 0"
            @click.stop="monitorStore.toggleNodeCollapse(node.id)"
            class="shrink-0 text-[10px] px-1.5 py-0.2 rounded font-sans transition-colors mr-1.5 hover:ring-1 hover:ring-primary/40 cursor-pointer"
            :class="isCollapsed(node.id) ? 'bg-primary/20 text-primary font-medium' : 'bg-secondary/60 text-muted-foreground'"
            :title="isCollapsed(node.id) ? '点击展开本轮步骤' : '点击折叠本轮步骤'"
          >
            {{ isCollapsed(node.id) ? `+ ${node.childrenIds.length} 步 (已折叠)` : `${node.childrenIds.length} 步` }}
          </button>

          <!-- 6. Message content summary (Strictly truncated, never blows out container) -->
          <span
            class="truncate text-[11px] font-mono flex-1 min-w-0 mr-3"
            :class="node.role === 'user' ? 'text-foreground font-medium' : 'text-foreground/90'"
            :title="node.summary"
          >
            {{ formatSummary(node) }}
          </span>

          <!-- 7. Meta badges (latency / tokens / cost) on the right -->
          <div class="shrink-0 flex items-center gap-1.5 text-[10px] text-muted-foreground/70 font-mono ml-auto">
            <span v-if="node.durationMs" class="px-1.5 py-0.5 rounded bg-secondary/50">
              {{ node.durationMs }}ms
            </span>
            <span v-if="node.tokens" class="px-1.5 py-0.5 rounded bg-secondary/50">
              {{ node.tokens }} tok
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  ChevronRightIcon,
  UserIcon,
  BotIcon,
  SparklesIcon,
  WrenchIcon,
  TerminalIcon,
  FileCodeIcon,
  FileEditIcon,
  FilePlusIcon,
  GlobeIcon,
  BookOpenIcon,
  GitBranchIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  XCircleIcon,
  Loader2Icon,
  BrainIcon,
} from 'lucide-vue-next'
import { useMonitorStore, type SessionTreeNode } from '@/stores/monitor'

const monitorStore = useMonitorStore()
const treeContainerEl = ref<HTMLElement | null>(null)

function isCollapsed(id: string): boolean {
  return monitorStore.collapsedNodeIds.has(id)
}

function onNodeClick(node: SessionTreeNode) {
  monitorStore.activeNodeId = node.id
}

function getNodeIcon(node: SessionTreeNode) {
  if (node.role === 'user') return UserIcon
  if (node.role === 'assistant') {
    if (node.status === 'aborted' || node.status === 'error') return XCircleIcon
    return SparklesIcon
  }
  if (node.role === 'toolResult') {
    const s = node.summary.toLowerCase()
    if (s.includes('read:')) return FileCodeIcon
    if (s.includes('write:')) return FilePlusIcon
    if (s.includes('edit:')) return FileEditIcon
    if (s.includes('bash:')) return TerminalIcon
    if (s.includes('search:')) return GlobeIcon
    return WrenchIcon
  }
  if (node.role === 'bashExecution') return TerminalIcon
  if (node.entryType === 'compaction' || node.entryType === 'branch_summary') return GitBranchIcon
  if (node.entryType === 'system') return BookOpenIcon
  if (node.summary.includes('[thinking')) return BrainIcon
  return BotIcon
}

function getIconColorClass(node: SessionTreeNode): string {
  if (node.status === 'error' || node.status === 'aborted') return 'text-rose-400'
  if (node.role === 'user') return 'text-purple-400'
  if (node.role === 'assistant') return 'text-emerald-400'
  if (node.role === 'toolResult') {
    const s = node.summary.toLowerCase()
    if (s.includes('read:')) return 'text-sky-400'
    if (s.includes('edit:')) return 'text-cyan-400'
    if (s.includes('write:')) return 'text-teal-400'
    if (s.includes('bash:')) return 'text-amber-400'
    return 'text-blue-400'
  }
  if (node.role === 'bashExecution') return 'text-amber-400'
  if (node.summary.includes('[thinking')) return 'text-violet-400'
  return 'text-muted-foreground'
}

function getRoleTextClass(node: SessionTreeNode): string {
  if (node.status === 'error' || node.status === 'aborted') return 'text-rose-400 font-bold'
  if (node.role === 'user') return 'text-purple-400'
  if (node.role === 'assistant') return 'text-emerald-400'
  if (node.role === 'toolResult') {
    const s = node.summary.toLowerCase()
    if (s.includes('read:')) return 'text-sky-400'
    if (s.includes('edit:')) return 'text-cyan-400'
    if (s.includes('write:')) return 'text-teal-400'
    if (s.includes('bash:')) return 'text-amber-400'
    return 'text-blue-400'
  }
  if (node.role === 'bashExecution') return 'text-amber-400'
  if (node.summary.includes('[thinking')) return 'text-violet-400'
  return 'text-slate-400'
}

function getDisplayRole(node: SessionTreeNode): string {
  if (node.role === 'user') return 'user:'
  if (node.role === 'assistant') {
    if (node.status === 'aborted') return 'assistant: (aborted)'
    if (node.status === 'error') return 'assistant: (error)'
    return 'assistant:'
  }
  return ''
}

function formatSummary(node: SessionTreeNode): string {
  if (node.role === 'user') {
    return node.summary.replace(/^user:\s*/i, '')
  }
  if (node.role === 'assistant') {
    return node.summary.replace(/^assistant:\s*/i, '')
  }
  return node.summary
}
</script>

<style scoped>
/* Indent guide styles following VS Code */
.indent-guide {
  box-sizing: border-box;
}
</style>
