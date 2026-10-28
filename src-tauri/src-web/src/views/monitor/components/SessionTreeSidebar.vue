<template>
  <aside class="w-72 shrink-0 border-r border-border bg-background flex flex-col h-full overflow-hidden select-none">
    <!-- Header: Title & Search (Swiss Modernist Open Grid Header) -->
    <div class="px-3 py-2.5 border-b border-border space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-wider text-foreground">
          <FolderTreeIcon class="w-3.5 h-3.5 text-primary" />
          <span>资源管理器 / 会话</span>
        </div>
        <div class="flex items-center gap-0.5">
          <button
            @click="monitorStore.openAllWorkspacesModal()"
            title="打开全量工作空间与会话检索弹窗"
            class="p-1 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <FolderTreeIcon class="w-3.5 h-3.5 text-primary/80 hover:text-primary" />
          </button>
          <button
            @click="monitorStore.fetchWorkspaces()"
            title="刷新会话列表"
            class="p-1 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <RotateCcwIcon class="w-3.5 h-3.5" :class="{ 'animate-spin': monitorStore.isLoadingWorkspaces }" />
          </button>
        </div>
      </div>

      <!-- Search Input (Sharp Minimal Line Input) -->
      <div class="relative">
        <SearchIcon class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          v-model="monitorStore.searchQuery"
          type="text"
          placeholder="筛选工作目录或会话..."
          class="w-full bg-secondary/40 border border-border pl-7 pr-6 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
        <button
          v-if="monitorStore.searchQuery"
          @click="monitorStore.searchQuery = ''"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <XIcon class="w-3 h-3" />
        </button>
      </div>
    </div>

    <!-- VS Code Explorer Style Tree List -->
    <div class="flex-1 overflow-y-auto py-1">
      <div v-if="monitorStore.isLoadingWorkspaces && monitorStore.workspaces.length === 0" class="py-8 text-center text-xs text-muted-foreground">
        <Loader2Icon class="w-4 h-4 animate-spin mx-auto mb-1.5 text-primary" />
        正在扫描会话目录...
      </div>

      <div v-else-if="monitorStore.filteredWorkspaces.length === 0" class="py-8 text-center text-xs text-muted-foreground">
        未找到匹配的工作空间
      </div>

      <div
        v-for="ws in monitorStore.filteredWorkspaces"
        :key="ws.id"
        class="group/ws"
      >
        <!-- Level 1: Workspace Directory Row (VS Code Explorer Header Row) -->
        <div
          @click="onWorkspaceHeaderClick(ws)"
          class="relative flex items-center justify-between h-[24px] px-2 cursor-pointer hover:bg-accent/60 transition-colors"
          :class="monitorStore.activeWorkspaceId === ws.id ? 'bg-accent/40 text-foreground' : 'text-foreground/90'"
          :title="ws.path"
        >
          <div class="flex items-center min-w-0 flex-1">
            <!-- Twistie (16x16 box, center at x = 8 + 8 = 16px) -->
            <span class="w-4 h-4 shrink-0 flex items-center justify-center mr-1 text-muted-foreground">
              <ChevronRightIcon
                class="w-3.5 h-3.5 transition-transform duration-100"
                :class="{ 'rotate-90': !isWorkspaceCollapsed(ws.id) }"
              />
            </span>
            <FolderGit2Icon class="w-3.5 h-3.5 shrink-0 text-amber-500/80 mr-1.5" />
            <span class="text-xs font-medium truncate">
              {{ formatWorkspaceName(ws.path) }}
            </span>
          </div>

          <div class="flex items-center gap-1.5 shrink-0 ml-1.5 text-[10px] text-muted-foreground font-mono">
            <span
              v-if="ws.lastOpenedAt"
              class="size-1.5 rounded-full bg-emerald-500 shrink-0"
              :title="`最近打开: ${formatRelativeTime(ws.lastOpenedAt)}`"
            />
            <span>{{ ws.sessionCount }}</span>
          </div>
        </div>

        <!-- Level 2: Sessions under this workspace (Single 1px VS Code Vertical Indent Guide) -->
        <div v-if="!isWorkspaceCollapsed(ws.id)" class="relative">
          <div
            v-for="s in ws.sessions"
            :key="s.id"
            @click="monitorStore.selectSession(s, ws.id)"
            class="group/row relative flex items-center justify-between h-[24px] pr-2 pl-[26px] text-xs cursor-pointer transition-colors"
            :class="[
              monitorStore.activeSession?.id === s.id
                ? 'bg-primary/12 text-primary font-medium'
                : 'hover:bg-accent/50 text-foreground/80 hover:text-foreground'
            ]"
          >
            <!-- Single 1px VS Code Vertical Indent Guide aligned to Chevron center (16px) -->
            <span
              class="pointer-events-none absolute inset-y-0 left-[15.5px] w-px transition-colors duration-100"
              :class="[
                monitorStore.activeWorkspaceId === ws.id
                  ? 'bg-foreground/25 group-hover/ws:bg-foreground/35'
                  : 'bg-border/70 group-hover/ws:bg-foreground/25'
              ]"
            />

            <!-- Active Selection Left Indicator Bar (2px) -->
            <span
              v-if="monitorStore.activeSession?.id === s.id"
              class="pointer-events-none absolute inset-y-0 left-0 w-[2px] bg-primary"
            />

            <div class="min-w-0 flex items-center gap-1.5 flex-1">
              <!-- Live heartbeat indicator or bullet -->
              <span
                v-if="s.isLive"
                class="size-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0"
                title="活跃中 (正在发生调用)"
              />
              <span
                v-else
                class="size-1.5 rounded-full shrink-0"
                :class="monitorStore.activeSession?.id === s.id ? 'bg-primary' : 'bg-muted-foreground/35'"
              />

              <span class="truncate text-[11px]" :title="s.title || s.fileName">
                {{ s.title || formatSessionDate(s.updatedAt) }}
              </span>
            </div>

            <span class="shrink-0 text-[10px] text-muted-foreground/70 font-mono ml-1.5">
              {{ formatRelativeTime(s.updatedAt) }}
            </span>
          </div>

          <!-- Open large modal selector for remaining N sessions instead of cluttering sidebar -->
          <div
            v-if="ws.sessions.length < ws.sessionCount"
            class="relative flex items-center h-[24px] pr-2 pl-[26px]"
          >
            <!-- Continuous 1px VS Code Indent Guide -->
            <span
              class="pointer-events-none absolute inset-y-0 left-[15.5px] w-px transition-colors duration-100"
              :class="[
                monitorStore.activeWorkspaceId === ws.id
                  ? 'bg-foreground/25 group-hover/ws:bg-foreground/35'
                  : 'bg-border/70 group-hover/ws:bg-foreground/25'
              ]"
            />
            <button
              @click.stop="monitorStore.openAllWorkspacesModal(ws.id)"
              class="w-full text-left text-[11px] text-primary/90 hover:text-primary hover:underline truncate cursor-pointer flex items-center justify-between"
              :title="`在弹窗中浏览并选择该目录下全部 ${ws.sessionCount} 个会话`"
            >
              <span>展开该目录剩余 {{ ws.sessionCount - ws.sessions.length }} 个会话...</span>
              <span class="font-mono text-[10px] text-muted-foreground">弹窗选择 ↗</span>
            </button>
          </div>
        </div>
      </div>

      <!-- View all workspaces modal entry -->
      <div class="mt-2 px-3 pt-2 border-t border-border/60">
        <button
          @click="monitorStore.openAllWorkspacesModal()"
          class="w-full flex items-center justify-between py-1.5 px-2.5 bg-secondary/40 hover:bg-accent text-foreground/80 hover:text-foreground border border-border transition-colors text-[11px] cursor-pointer group"
        >
          <span class="flex items-center gap-1.5">
            <FolderTreeIcon class="w-3.5 h-3.5 text-primary" />
            <span>浏览全部工作空间与会话</span>
          </span>
          <span class="font-mono text-[10px] text-muted-foreground group-hover:text-foreground">
            {{ monitorStore.allWorkspaces.length }} 目录 ↗
          </span>
        </button>
      </div>
    </div>

    <!-- Footer summary -->
    <div class="px-3 py-2 border-t border-border bg-background text-[11px] text-muted-foreground flex items-center justify-between">
      <button
        @click="monitorStore.openAllWorkspacesModal()"
        class="hover:text-foreground text-left cursor-pointer flex items-center gap-1 group"
        title="点击弹窗查看所有工作空间与历史会话"
      >
        <span>常驻最近 {{ monitorStore.workspaces.length }} 个</span>
        <span class="text-primary underline group-hover:text-primary/80">全部</span>
      </button>
      <span class="font-mono text-[10px]">~/.pi/agent/sessions</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  FolderTreeIcon,
  FolderGit2Icon,
  ChevronRightIcon,
  SearchIcon,
  RotateCcwIcon,
  XIcon,
  Loader2Icon,
} from 'lucide-vue-next'
import { useMonitorStore, type WorkspaceItem } from '@/stores/monitor'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

const monitorStore = useMonitorStore()
const collapsedWorkspaces = ref<Set<string>>(new Set())

function isWorkspaceCollapsed(id: string): boolean {
  return collapsedWorkspaces.value.has(id)
}

function toggleWorkspaceCollapse(id: string) {
  const next = new Set(collapsedWorkspaces.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  collapsedWorkspaces.value = next
}

function onWorkspaceHeaderClick(ws: WorkspaceItem) {
  toggleWorkspaceCollapse(ws.id)
  monitorStore.touchWorkspace(ws.id)
}

function formatWorkspaceName(path: string): string {
  if (!path) return '未知工作目录'
  const parts = path.split(/[/\\]/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  }
  return parts[parts.length - 1] || path
}

function formatSessionDate(ts: number): string {
  const d = new Date(ts)
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const h = d.getHours().toString().padStart(2, '0')
  const min = d.getMinutes().toString().padStart(2, '0')
  return `${m}-${day} ${h}:${min}`
}

function formatRelativeTime(ts: number): string {
  try {
    return formatDistanceToNow(ts, { addSuffix: true, locale: zhCN })
  } catch {
    return ''
  }
}
</script>
