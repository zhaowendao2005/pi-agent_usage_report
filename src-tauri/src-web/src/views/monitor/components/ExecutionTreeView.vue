<template>
  <div class="h-full flex flex-col overflow-hidden bg-background">
    <!-- Swiss Grid Column Header Bar -->
    <div class="h-7 shrink-0 border-b border-border bg-secondary/20 px-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-mono select-none">
      <div class="flex items-center gap-2">
        <span>TOPOLOGY / 节点层级与执行链路</span>
      </div>
      <div class="flex items-center gap-6 pr-1">
        <span>CHARS / TOKENS</span>
        <span class="w-14 text-right">LATENCY</span>
      </div>
    </div>

    <!-- Virtual Scroll Tree Viewport -->
    <div
      ref="treeContainerEl"
      class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden font-mono text-xs select-none relative"
      @scroll="onScroll"
      @mouseleave="monitorStore.setHoveredNode(null)"
    >
      <div v-if="monitorStore.isLoadingTree" class="py-12 text-center text-xs text-muted-foreground font-sans">
        <Loader2Icon class="w-4 h-4 animate-spin mx-auto mb-2 text-primary" />
        正在冷加载会话拓扑树...
      </div>

      <div v-else-if="allVisibleNodes.length === 0" class="py-12 text-center text-xs text-muted-foreground font-sans">
        当前会话暂无执行节点
      </div>

      <div
        v-else
        :style="{ height: `${totalHeight}px`, position: 'relative' }"
      >
        <div
          class="absolute left-0 right-0 top-0 flex flex-col"
          :style="{ transform: `translateY(${offsetY}px)` }"
        >
          <div
            v-for="item in virtualRows"
            :key="item.node.id"
            @click="onNodeClick(item.node)"
            @dblclick="onNodeDblClick(item.node)"
            @mouseenter="monitorStore.setHoveredNode(item.node)"
            class="group relative flex items-center px-3 cursor-pointer transition-colors w-full min-w-0 border-b border-border/25"
            :class="[
              monitorStore.activeNodeId === item.node.id
                ? 'bg-primary/12 text-foreground'
                : 'hover:bg-accent/50 text-foreground/85 hover:text-foreground',
              item.node.role === 'user' ? 'bg-secondary/15' : '',
              item.node.isRewind && monitorStore.activeNodeId !== item.node.id ? 'bg-amber-500/[0.04]' : ''
            ]"
            :style="{
              height: `${ROW_HEIGHT}px`,
              paddingLeft: `${item.node.depth * INDENT_STEP + BASE_PADDING_LEFT}px`
            }"
          >
            <!-- Left 2px Key Branch / Selection Marker -->
            <span
              v-if="monitorStore.activeNodeId === item.node.id"
              class="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-primary"
            />
            <span
              v-else-if="item.node.isRewind"
              class="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
              :class="item.node.isOnActivePath ? 'bg-amber-500/70' : 'bg-amber-500/30'"
            />
            <span
              v-else-if="item.node.role === 'user'"
              class="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
              :class="isTurnActiveOrHovered(item.node.id) ? 'bg-primary/60' : 'bg-foreground/20'"
            />

            <!-- 1. VS Code Single 1px Vertical Indent Guides (Aligned to parent Chevron center) -->
            <template v-if="item.node.depth > 0">
              <span
                v-for="lvl in item.node.depth"
                :key="lvl"
                class="pointer-events-none absolute inset-y-0 w-px transition-colors duration-100"
                :class="getGuideLineClass(item.node, lvl)"
                :style="{ left: `${(lvl - 1) * INDENT_STEP + BASE_PADDING_LEFT + 7.5}px` }"
              />
            </template>

            <!-- 2. VS Code Expand/Collapse Twistie (16x16 box) -->
            <span
              v-if="item.node.hasChildren"
              @click.stop="monitorStore.toggleNodeCollapse(item.node.id)"
              class="w-4 h-4 shrink-0 flex items-center justify-center mr-1 text-muted-foreground hover:text-foreground transition-colors"
              :title="isCollapsed(item.node.id) ? '展开此分支步骤' : '收起此分支步骤'"
            >
              <ChevronRightIcon
                class="w-3.5 h-3.5 transition-transform duration-100"
                :class="{ 'rotate-90': !isCollapsed(item.node.id) }"
              />
            </span>
            <span
              v-else
              class="w-4 h-4 shrink-0 mr-1 flex items-center justify-center"
            >
              <!-- Subtle key-node dot only for leaf steps -->
              <span
                class="size-1 rounded-full"
                :class="getKeyLeafDotClass(item.node)"
              />
            </span>

            <!-- 3. Turn Index Badge for User Turn Roots -->
            <span
              v-if="item.turnNumber !== null"
              class="shrink-0 text-[10px] font-mono px-1 mr-1.5 border border-border/80 bg-background text-muted-foreground"
            >
              T{{ item.turnNumber }}
            </span>

            <!-- 3.1 Rewind / alternative branch badge -->
            <button
              v-if="item.node.isRewind"
              @click.stop="jumpToOrigin(item.node)"
              class="shrink-0 text-[9px] px-1 py-0 mr-1.5 border font-mono leading-tight cursor-pointer transition-colors border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
              :title="rewindTitle(item.node)"
            >
              ⟲ {{ rewindLabel(item.node) }}
            </button>

            <!-- 4. Original Role Icon (Preserved as requested) -->
            <component
              :is="getNodeIcon(item.node)"
              class="size-3.5 shrink-0 mr-1.5"
              :class="getIconColorClass(item.node)"
            />

            <!-- 5. Role Label / Key Node Marker -->
            <span
              v-if="getDisplayRole(item.node)"
              class="font-semibold shrink-0 mr-1.5 text-[11px]"
              :class="getRoleTextClass(item.node)"
            >
              {{ getDisplayRole(item.node) }}
            </span>

            <!-- 5.1 Key Node Micro-Tag for clear branch step distinction -->
            <span
              v-if="getKeyNodeBadge(item.node)"
              class="shrink-0 text-[9px] px-1 py-0 mr-1.5 border font-sans leading-tight"
              :class="getKeyNodeBadgeClass(item.node)"
            >
              {{ getKeyNodeBadge(item.node) }}
            </span>

            <!-- 5.2 Collapsible Step Count Badge for User Turn -->
            <button
              v-if="item.node.childrenIds.length > 0 && (item.node.role === 'user' || item.node.isRewind)"
              @click.stop="monitorStore.toggleNodeCollapse(item.node.id)"
              class="shrink-0 text-[10px] px-1.5 py-0 border font-mono transition-colors mr-2 cursor-pointer"
              :class="isCollapsed(item.node.id)
                ? 'border-primary/40 bg-primary/10 text-primary font-medium hover:bg-primary/20'
                : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'"
              :title="isCollapsed(item.node.id) ? '点击展开本轮执行分支' : '点击收起本轮执行分支'"
            >
              {{ isCollapsed(item.node.id) ? `+${item.node.childrenIds.length} 步` : `${item.node.childrenIds.length} 步` }}
            </button>

            <!-- 6. Message content summary -->
            <span
              class="truncate text-[11px] font-mono flex-1 min-w-0 mr-3"
              :class="item.node.role === 'user' ? 'text-foreground font-medium' : 'text-foreground/85'"
              :title="item.node.summary"
            >
              {{ formatSummary(item.node) }}
            </span>

            <!-- 7. Right Meta Grid Columns (Tokens / Latency / Inspect) -->
            <div class="shrink-0 flex items-center gap-2 text-[10px] text-muted-foreground font-mono ml-auto">
              <span v-if="item.node.tokens" class="text-foreground/70">
                {{ item.node.tokens }} tok
              </span>
              <span v-else-if="item.node.charCount" class="text-muted-foreground/60">
                {{ item.node.charCount }} 字
              </span>
              <span class="w-14 text-right" :class="item.node.durationMs && item.node.durationMs > 3000 ? 'text-amber-500' : ''">
                {{ item.node.durationMs ? `${item.node.durationMs}ms` : '—' }}
              </span>
              <button
                @click.stop="onInspectNode(item.node)"
                class="opacity-0 group-hover:opacity-100 focus:opacity-100 px-1 text-[10px] text-primary hover:underline font-sans transition-opacity cursor-pointer"
                title="查看该节点完整调用报文"
              >
                透视 ↗
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
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
  XCircleIcon,
  Loader2Icon,
  BrainIcon,
} from 'lucide-vue-next'
import { useMonitorStore, type SessionTreeNode } from '@/stores/monitor'

const monitorStore = useMonitorStore()
const treeContainerEl = ref<HTMLElement | null>(null)

// Virtual Scroll Constants (VS Code compact row geometry)
const ROW_HEIGHT = 26
const INDENT_STEP = 18
const BASE_PADDING_LEFT = 12
const OVERSCAN = 12

const scrollTop = ref(0)
const viewportHeight = ref(600)
let resizeObserver: ResizeObserver | null = null

function updateViewportHeight() {
  if (treeContainerEl.value) {
    viewportHeight.value = treeContainerEl.value.clientHeight || 600
  }
}

function onScroll(e: Event) {
  const target = e.target as HTMLElement
  scrollTop.value = target.scrollTop
}

onMounted(() => {
  updateViewportHeight()
  if (typeof ResizeObserver !== 'undefined' && treeContainerEl.value) {
    resizeObserver = new ResizeObserver(() => {
      updateViewportHeight()
    })
    resizeObserver.observe(treeContainerEl.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

watch(
  () => monitorStore.activeSession?.id,
  () => {
    scrollTop.value = 0
    if (treeContainerEl.value) {
      treeContainerEl.value.scrollTop = 0
    }
  }
)

// Map every user prompt to a 1-based turn index in display order. Rewound
// branches keep their own T number and are additionally marked with the ⟲ badge.
const turnIndexMap = computed(() => {
  const map = new Map<string, number>()
  const nodes = monitorStore.sessionTree?.nodes ?? []
  let tIdx = 0
  for (const n of nodes) {
    if (n.role === 'user') {
      tIdx += 1
      map.set(n.id, tIdx)
    }
  }
  return map
})

const allVisibleNodes = computed(() => monitorStore.visibleNodes)

const totalHeight = computed(() => allVisibleNodes.value.length * ROW_HEIGHT)

const startIndex = computed(() => {
  return Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN)
})

const endIndex = computed(() => {
  const visibleCount = Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2
  return Math.min(allVisibleNodes.value.length, startIndex.value + visibleCount)
})

const offsetY = computed(() => startIndex.value * ROW_HEIGHT)

const virtualRows = computed(() => {
  const slice = allVisibleNodes.value.slice(startIndex.value, endIndex.value)
  const tMap = turnIndexMap.value
  return slice.map((node) => ({
    node,
    turnNumber: tMap.get(node.id) ?? null,
  }))
})

function isCollapsed(id: string): boolean {
  return monitorStore.collapsedNodeIds.has(id)
}

function onNodeClick(node: SessionTreeNode) {
  monitorStore.activeNodeId = node.id
  if (node.hasChildren && (node.role === 'user' || node.isRewind)) {
    monitorStore.toggleNodeCollapse(node.id)
  }
}

function onNodeDblClick(node: SessionTreeNode) {
  monitorStore.activeNodeId = node.id
  monitorStore.activeSubTab = 'detail'
}

function onInspectNode(node: SessionTreeNode) {
  monitorStore.activeNodeId = node.id
  monitorStore.activeSubTab = 'detail'
}

// Check if a parent turn ID is currently active or hovered
function isTurnActiveOrHovered(turnId: string): boolean {
  const activeNode = monitorStore.selectedNode
  if (activeNode && (activeNode.id === turnId || activeNode.parentId === turnId)) {
    return true
  }
  const hoveredId = monitorStore.hoveredNodeId
  if (!hoveredId) return false
  if (hoveredId === turnId) return true
  const hoveredNode = monitorStore.sessionTree?.nodes.find((n) => n.id === hoveredId)
  return hoveredNode?.parentId === turnId
}

// Subtle branch-aware VS Code indent guide coloring
function getGuideLineClass(node: SessionTreeNode, lvl: number): string {
  if (node.status === 'error' || node.status === 'aborted') {
    return 'bg-rose-500/70'
  }
  if (node.parentId && isTurnActiveOrHovered(node.parentId)) {
    return 'bg-primary/70'
  }
  if (monitorStore.activeGuideLevels.includes(lvl - 1)) {
    return 'bg-primary/65'
  }
  if (node.isRewind) {
    return 'bg-amber-500/40 group-hover:bg-amber-500/60'
  }
  return 'bg-border/80 group-hover:bg-foreground/35'
}

function rewindLabel(node: SessionTreeNode): string {
  if (node.branchCount && node.branchCount > 1) {
    return `${node.branchIndex ?? '?'}/${node.branchCount}`
  }
  return 'RW'
}

function rewindTitle(node: SessionTreeNode): string {
  const from = node.rewindFromId ? node.rewindFromId.slice(0, 8) : '?'
  const idx =
    node.branchCount && node.branchCount > 1 ? ` · 分支 ${node.branchIndex ?? '?'}/${node.branchCount}` : ''
  return `Rewind · 从 #${from} 重新分支${idx}（点击跳转到分支点）`
}

function jumpToOrigin(node: SessionTreeNode) {
  if (!node.rewindFromId) return
  monitorStore.expandToNode(node.rewindFromId)
  monitorStore.activeNodeId = node.rewindFromId
}

function getKeyLeafDotClass(node: SessionTreeNode): string {
  if (node.status === 'error' || node.status === 'aborted') return 'bg-rose-500'
  if (node.role === 'assistant' && !node.summary.includes('[thinking]')) return 'bg-emerald-500'
  if (node.summary.includes('[thinking]')) return 'bg-violet-400/70'
  return 'bg-muted-foreground/35'
}

function getKeyNodeBadge(node: SessionTreeNode): string {
  if (node.status === 'error') return 'ERROR'
  if (node.status === 'aborted') return 'ABORT'
  if (node.role === 'assistant' && !node.summary.includes('[thinking]')) return '输出'
  if (node.summary.includes('[thinking]')) return '推理'
  if (node.entryType === 'compaction' || node.entryType === 'branch_summary') return '分支压缩'
  return ''
}

function getKeyNodeBadgeClass(node: SessionTreeNode): string {
  if (node.status === 'error' || node.status === 'aborted') {
    return 'border-rose-500/40 bg-rose-500/10 text-rose-500'
  }
  if (node.role === 'assistant' && !node.summary.includes('[thinking]')) {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  }
  if (node.summary.includes('[thinking]')) {
    return 'border-violet-500/30 bg-violet-500/10 text-violet-500'
  }
  return 'border-border bg-secondary text-muted-foreground'
}

function getNodeIcon(node: SessionTreeNode) {
  if (node.role === 'user') return UserIcon
  if (node.role === 'assistant') {
    if (node.status === 'aborted' || node.status === 'error') return XCircleIcon
    if (node.summary.includes('[thinking]')) return BrainIcon
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
  if (node.status === 'error' || node.status === 'aborted') return 'text-rose-500'
  if (node.role === 'user') return 'text-purple-500 dark:text-purple-400'
  if (node.role === 'assistant') {
    if (node.summary.includes('[thinking]')) return 'text-violet-500 dark:text-violet-400'
    return 'text-emerald-500 dark:text-emerald-400'
  }
  if (node.role === 'toolResult') {
    const s = node.summary.toLowerCase()
    if (s.includes('read:')) return 'text-sky-500'
    if (s.includes('edit:')) return 'text-cyan-500'
    if (s.includes('write:')) return 'text-teal-500'
    if (s.includes('bash:')) return 'text-amber-500'
    return 'text-blue-500'
  }
  if (node.role === 'bashExecution') return 'text-amber-500'
  if (node.summary.includes('[thinking')) return 'text-violet-500'
  return 'text-muted-foreground'
}

function getRoleTextClass(node: SessionTreeNode): string {
  if (node.status === 'error' || node.status === 'aborted') return 'text-rose-500 font-bold'
  if (node.role === 'user') return 'text-purple-600 dark:text-purple-400'
  if (node.role === 'assistant') return 'text-emerald-600 dark:text-emerald-400'
  return 'text-muted-foreground'
}

function getDisplayRole(node: SessionTreeNode): string {
  if (node.role === 'user') return 'user:'
  if (node.role === 'assistant' && !node.summary.includes('[thinking]')) {
    if (node.status === 'aborted') return 'assistant (aborted):'
    if (node.status === 'error') return 'assistant (error):'
    return 'assistant:'
  }
  return ''
}

function formatSummary(node: SessionTreeNode): string {
  if (node.role === 'user') {
    return node.summary.replace(/^user:\s*/i, '')
  }
  if (node.role === 'assistant') {
    return node.summary.replace(/^assistant:\s*/i, '').replace(/^\[thinking\]\s*/i, '')
  }
  return node.summary
}
</script>
