<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-[2px] select-none"
      @click="onClose"
      @keydown.esc="onClose"
    >
      <!-- Modal Container (Swiss Modernist Structural Frame) -->
      <div
        class="bg-background border border-border shadow-2xl flex flex-col w-full max-w-4xl h-[80vh] overflow-hidden"
        @click.stop
      >
        <!-- Modal Header -->
        <div class="px-5 py-3.5 border-b border-border bg-background flex items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <FolderTreeIcon class="w-4 h-4 text-primary shrink-0" />
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="text-xs font-semibold uppercase tracking-wider text-foreground">
                  {{ focusedWorkspace ? `目录会话选择器 · ${formatWorkspaceName(focusedWorkspace.path)}` : '全部工作空间与会话拓扑检索' }}
                </h2>
                <span class="text-[11px] font-mono px-1.5 py-0 border border-border bg-secondary/40 text-muted-foreground">
                  {{ focusedWorkspace ? `${focusedWorkspace.sessionCount} 个会话` : `${monitorStore.allWorkspaces.length} 个工作目录` }}
                </span>
                <button
                  v-if="monitorStore.modalFocusedWorkspaceId"
                  @click="monitorStore.modalFocusedWorkspaceId = null"
                  class="text-[11px] text-primary hover:underline cursor-pointer ml-1"
                >
                  显示全部工作目录 ↗
                </button>
              </div>
              <p class="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                {{ focusedWorkspace ? focusedWorkspace.path : '支持按目录路径、项目名称与会话提问全量检索 · 虚拟列表高速渲染' }}
              </p>
            </div>
          </div>

          <!-- Close button -->
          <button
            @click="onClose"
            class="p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="关闭 (Esc)"
          >
            <XIcon class="w-4 h-4" />
          </button>
        </div>

        <!-- Search & Quick Action Toolbar -->
        <div class="px-5 py-2.5 border-b border-border bg-secondary/20 flex items-center justify-between gap-3 shrink-0">
          <div class="relative flex-1">
            <SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              ref="searchInputEl"
              v-model="searchQuery"
              type="text"
              placeholder="检索工作空间路径、文件夹名或会话标题..."
              class="w-full bg-background border border-border pl-8 pr-7 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors font-mono"
            />
            <button
              v-if="searchQuery"
              @click="searchQuery = ''"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <XIcon class="w-3.5 h-3.5" />
            </button>
          </div>

          <div class="flex items-center gap-2 text-[11px] shrink-0 font-mono">
            <span class="text-muted-foreground">共 {{ flatRows.length }} 行</span>
            <span class="text-border">|</span>
            <button
              @click="expandAll"
              class="px-1.5 py-0.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer font-sans"
            >
              全部展开
            </button>
            <span class="text-border">/</span>
            <button
              @click="collapseAll"
              class="px-1.5 py-0.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer font-sans"
            >
              全部收起
            </button>
          </div>
        </div>

        <!-- Virtual Scroll Tree Viewport (VS Code Single 1px Indent Guide) -->
        <div
          ref="viewportEl"
          class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden font-mono text-xs relative"
          @scroll="onScroll"
        >
          <div v-if="monitorStore.isLoadingAllWorkspaces && flatRows.length === 0" class="py-16 text-center text-xs text-muted-foreground font-sans">
            正在加载工作目录与会话索引...
          </div>

          <div v-else-if="flatRows.length === 0" class="py-16 text-center text-xs text-muted-foreground font-sans">
            <FolderSearchIcon class="w-7 h-7 mx-auto mb-2 opacity-40" />
            <p>未找到匹配的工作空间或历史会话</p>
          </div>

          <div
            v-else
            :style="{ height: `${totalHeight}px`, position: 'relative' }"
          >
            <div
              class="absolute left-0 right-0 top-0 flex flex-col"
              :style="{ transform: `translateY(${offsetY}px)` }"
            >
              <template v-for="row in visibleVirtualRows" :key="row.key">
                <!-- Level 1: Workspace Header Row -->
                <div
                  v-if="row.type === 'workspace'"
                  @click="toggleCollapse(row.ws.id)"
                  class="group relative flex items-center justify-between px-4 cursor-pointer hover:bg-accent/50 transition-colors border-b border-border/40 bg-secondary/15"
                  :class="monitorStore.activeWorkspaceId === row.ws.id ? 'text-foreground font-semibold' : 'text-foreground/90'"
                  :style="{ height: `${ROW_HEIGHT}px` }"
                >
                  <span
                    v-if="monitorStore.activeWorkspaceId === row.ws.id"
                    class="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-primary"
                  />
                  <div class="flex items-center min-w-0 flex-1">
                    <!-- VS Code Twistie (16x16 box, center at 16 + 8 = 24px) -->
                    <span class="w-4 h-4 shrink-0 flex items-center justify-center mr-1 text-muted-foreground">
                      <ChevronRightIcon
                        class="w-3.5 h-3.5 transition-transform duration-100"
                        :class="{ 'rotate-90': !collapsedSet.has(row.ws.id) }"
                      />
                    </span>
                    <FolderGit2Icon class="w-3.5 h-3.5 text-amber-500/85 shrink-0 mr-1.5" />
                    <span class="font-semibold text-xs truncate mr-2">
                      {{ formatWorkspaceName(row.ws.path) }}
                    </span>
                    <span class="text-[11px] text-muted-foreground/70 truncate hidden sm:inline" :title="row.ws.path">
                      {{ row.ws.path }}
                    </span>
                  </div>

                  <div class="flex items-center gap-3 shrink-0 ml-2 text-[10px] text-muted-foreground">
                    <span v-if="row.ws.lastOpenedAt" class="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <ClockIcon class="w-3 h-3" />
                      <span>{{ formatRelativeTime(row.ws.lastOpenedAt) }}打开</span>
                    </span>
                    <span>{{ row.ws.sessionCount }} 个会话</span>
                  </div>
                </div>

                <!-- Level 2: Session Row (Single 1px VS Code Vertical Indent Guide) -->
                <div
                  v-else-if="row.type === 'session'"
                  @click="onSelectSession(row.ws, row.session)"
                  class="group relative flex items-center px-4 cursor-pointer transition-colors hover:bg-accent/50 min-w-0 border-b border-border/20"
                  :class="monitorStore.activeSession?.id === row.session.id ? 'bg-primary/12 font-medium' : ''"
                  :style="{ height: `${ROW_HEIGHT}px`, paddingLeft: '36px' }"
                >
                  <!-- Single 1px VS Code Indent Guide aligned to parent Chevron center (23.5px) -->
                  <span
                    class="pointer-events-none absolute inset-y-0 left-[23.5px] w-px transition-colors"
                    :class="monitorStore.activeWorkspaceId === row.ws.id ? 'bg-primary/50' : 'bg-border/80 group-hover:bg-foreground/40'"
                  />

                  <span
                    v-if="monitorStore.activeSession?.id === row.session.id"
                    class="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-primary"
                  />

                  <span
                    v-if="row.session.isLive"
                    class="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0 mr-1.5"
                    title="活跃中"
                  />
                  <span
                    v-else
                    class="size-1.5 rounded-full shrink-0 mr-1.5"
                    :class="monitorStore.activeSession?.id === row.session.id ? 'bg-primary' : 'bg-muted-foreground/40'"
                  />

                  <TerminalIcon class="size-3.5 text-muted-foreground group-hover:text-foreground shrink-0 mr-1.5 transition-colors" />

                  <span
                    class="text-[11px] truncate flex-1 min-w-0 mr-3"
                    :class="monitorStore.activeSession?.id === row.session.id ? 'text-primary font-semibold' : 'text-foreground/90'"
                    :title="row.session.title || row.session.fileName"
                  >
                    {{ row.session.title || row.session.fileName }}
                  </span>

                  <div class="shrink-0 flex items-center gap-3 text-[10px] text-muted-foreground font-mono ml-auto">
                    <span class="text-muted-foreground/60 hidden md:inline">
                      {{ (row.session.fileSize / 1024).toFixed(1) }} KB
                    </span>
                    <span v-if="monitorStore.activeSession?.id === row.session.id" class="text-primary font-sans">
                      当前会话
                    </span>
                    <span class="w-20 text-right">{{ formatRelativeTime(row.session.updatedAt) }}</span>
                  </div>
                </div>

                <!-- Level 2: Load More Row inside Modal if workspace has >200 sessions -->
                <div
                  v-else-if="row.type === 'load_more'"
                  class="relative flex items-center px-4 border-b border-border/20"
                  :style="{ height: `${ROW_HEIGHT}px`, paddingLeft: '36px' }"
                >
                  <span class="pointer-events-none absolute inset-y-0 left-[23.5px] w-px bg-border/80" />
                  <button
                    @click.stop="monitorStore.loadMoreSessionsForWorkspace(row.ws.id)"
                    class="text-[11px] text-primary hover:underline cursor-pointer font-sans"
                  >
                    继续加载该目录下剩余 {{ row.ws.sessionCount - row.ws.sessions.length }} 个历史会话...
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="px-5 py-2.5 border-t border-border bg-background flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <div class="flex items-center gap-2 text-[11px] font-mono">
            <span>ROOT: ~/.pi/agent/sessions</span>
          </div>

          <div class="flex items-center gap-3 text-[11px]">
            <span>按 <kbd class="px-1.5 py-0.5 border border-border bg-secondary/50 text-[10px] font-mono">Esc</kbd> 关闭</span>
            <button
              @click="onClose"
              class="px-3 py-1 border border-border bg-secondary/50 hover:bg-accent text-foreground text-xs transition-colors cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import {
  FolderTreeIcon,
  FolderGit2Icon,
  ChevronRightIcon,
  SearchIcon,
  XIcon,
  TerminalIcon,
  FolderSearchIcon,
  ClockIcon,
} from 'lucide-vue-next'
import { useMonitorStore, type WorkspaceItem, type SessionSummary } from '@/stores/monitor'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const monitorStore = useMonitorStore()
const searchInputEl = ref<HTMLInputElement | null>(null)
const viewportEl = ref<HTMLElement | null>(null)
const searchQuery = ref('')
const collapsedSet = ref<Set<string>>(new Set())

// Virtual Scroll state
const ROW_HEIGHT = 28
const OVERSCAN = 12
const scrollTop = ref(0)
const viewportHeight = ref(520)
let resizeObserver: ResizeObserver | null = null

function updateViewportHeight() {
  if (viewportEl.value) {
    viewportHeight.value = viewportEl.value.clientHeight || 520
  }
}

function onScroll(e: Event) {
  const target = e.target as HTMLElement
  scrollTop.value = target.scrollTop
}

onMounted(async () => {
  updateViewportHeight()
  if (typeof ResizeObserver !== 'undefined' && viewportEl.value) {
    resizeObserver = new ResizeObserver(() => updateViewportHeight())
    resizeObserver.observe(viewportEl.value)
  }
  await monitorStore.fetchAllWorkspaces()
  if (monitorStore.modalFocusedWorkspaceId) {
    await monitorStore.loadMoreSessionsForWorkspace(monitorStore.modalFocusedWorkspaceId)
  }
  nextTick(() => {
    searchInputEl.value?.focus()
  })
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

const focusedWorkspace = computed(() => {
  if (!monitorStore.modalFocusedWorkspaceId) return null
  return monitorStore.allWorkspaces.find((w) => w.id === monitorStore.modalFocusedWorkspaceId) ?? null
})

function onClose() {
  monitorStore.closeAllWorkspacesModal()
}

function toggleCollapse(wsId: string) {
  const next = new Set(collapsedSet.value)
  if (next.has(wsId)) {
    next.delete(wsId)
  } else {
    next.add(wsId)
  }
  collapsedSet.value = next
}

function expandAll() {
  collapsedSet.value = new Set()
}

function collapseAll() {
  const next = new Set<string>()
  for (const ws of monitorStore.allWorkspaces) {
    next.add(ws.id)
  }
  collapsedSet.value = next
}

function onSelectSession(ws: WorkspaceItem, session: SessionSummary) {
  monitorStore.touchWorkspace(ws.id)
  monitorStore.selectSession(session, ws.id)
  monitorStore.closeAllWorkspacesModal()
}

const filteredAllWorkspaces = computed(() => {
  const baseList = monitorStore.modalFocusedWorkspaceId
    ? monitorStore.allWorkspaces.filter((w) => w.id === monitorStore.modalFocusedWorkspaceId)
    : monitorStore.allWorkspaces

  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return baseList

  return baseList
    .map((ws) => {
      const matchWs = ws.path.toLowerCase().includes(q) || ws.id.toLowerCase().includes(q)
      const matchedSessions = ws.sessions.filter(
        (s) =>
          s.title?.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.fileName.toLowerCase().includes(q)
      )

      if (matchWs || matchedSessions.length > 0) {
        return {
          ...ws,
          sessions: matchWs ? ws.sessions : matchedSessions,
        }
      }
      return null
    })
    .filter((ws): ws is WorkspaceItem => ws !== null)
})

type FlatModalRow =
  | { key: string; type: 'workspace'; ws: WorkspaceItem }
  | { key: string; type: 'session'; ws: WorkspaceItem; session: SessionSummary }
  | { key: string; type: 'load_more'; ws: WorkspaceItem }

const flatRows = computed<FlatModalRow[]>(() => {
  const rows: FlatModalRow[] = []
  for (const ws of filteredAllWorkspaces.value) {
    rows.push({ key: `ws_${ws.id}`, type: 'workspace', ws })
    if (!collapsedSet.value.has(ws.id)) {
      for (const s of ws.sessions) {
        rows.push({ key: `s_${ws.id}_${s.id}`, type: 'session', ws, session: s })
      }
      if (!searchQuery.value.trim() && ws.sessions.length < ws.sessionCount) {
        rows.push({ key: `more_${ws.id}`, type: 'load_more', ws })
      }
    }
  }
  return rows
})

const totalHeight = computed(() => flatRows.value.length * ROW_HEIGHT)

const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN))

const endIndex = computed(() => {
  const count = Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2
  return Math.min(flatRows.value.length, startIndex.value + count)
})

const offsetY = computed(() => startIndex.value * ROW_HEIGHT)

const visibleVirtualRows = computed(() => flatRows.value.slice(startIndex.value, endIndex.value))

function formatWorkspaceName(p: string): string {
  if (!p) return '未命名目录'
  const normalized = p.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2) {
    return parts.slice(-2).join('/')
  }
  return parts[parts.length - 1] || p
}

function formatRelativeTime(ts: number): string {
  if (!ts) return ''
  try {
    return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: zhCN })
  } catch {
    return ''
  }
}
</script>
