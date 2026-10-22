<template>
  <aside class="w-72 shrink-0 border-r border-border bg-card/60 flex flex-col h-full overflow-hidden select-none">
    <!-- Header: Title & Search -->
    <div class="p-3 border-b border-border space-y-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5 font-semibold text-xs text-foreground">
          <FolderTreeIcon class="w-4 h-4 text-primary" />
          <span>工作空间与会话</span>
        </div>
        <button
          @click="monitorStore.fetchWorkspaces()"
          title="刷新会话列表"
          class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <RotateCcwIcon class="w-3.5 h-3.5" :class="{ 'animate-spin': monitorStore.isLoadingWorkspaces }" />
        </button>
      </div>

      <!-- Search Input -->
      <div class="relative">
        <SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          v-model="monitorStore.searchQuery"
          type="text"
          placeholder="搜索工作目录或会话..."
          class="w-full bg-background border border-border rounded pl-8 pr-7 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all"
        />
        <button
          v-if="monitorStore.searchQuery"
          @click="monitorStore.searchQuery = ''"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <XIcon class="w-3 h-3" />
        </button>
      </div>
    </div>

    <!-- Workspace Tree list -->
    <div class="flex-1 overflow-y-auto px-1.5 py-2 space-y-1">
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
        class="rounded-md border border-transparent hover:border-border/40 transition-colors"
      >
        <!-- Level 1: Workspace Directory Item -->
        <div
          @click="toggleWorkspaceCollapse(ws.id)"
          class="group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer hover:bg-accent/60 transition-colors"
          :title="ws.path"
        >
          <div class="flex items-center gap-1.5 min-w-0">
            <ChevronRightIcon
              class="w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
              :class="{ 'rotate-90': !isWorkspaceCollapsed(ws.id) }"
            />
            <FolderGit2Icon class="w-3.5 h-3.5 shrink-0 text-amber-500/80" />
            <span class="text-xs font-medium text-foreground truncate">
              {{ formatWorkspaceName(ws.path) }}
            </span>
          </div>

          <div class="flex items-center gap-1 shrink-0 ml-1.5 text-[11px] text-muted-foreground">
            <span class="px-1.5 py-0.2 rounded-full bg-secondary/80 text-[10px] font-mono">
              {{ ws.sessionCount }}
            </span>
          </div>
        </div>

        <!-- Level 2: Sessions under this workspace -->
        <div v-if="!isWorkspaceCollapsed(ws.id)" class="ml-3.5 pl-2 border-l border-border/60 my-0.5 space-y-0.5">
          <div
            v-for="s in ws.sessions"
            :key="s.id"
            @click="monitorStore.selectSession(s)"
            class="group flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer transition-colors"
            :class="[
              monitorStore.activeSession?.id === s.id
                ? 'bg-primary/15 text-primary font-medium border border-primary/30'
                : 'hover:bg-accent/40 text-foreground/80 hover:text-foreground'
            ]"
          >
            <div class="min-w-0 flex items-center gap-1.5">
              <!-- Live heartbeat indicator or bullet -->
              <span
                v-if="s.isLive"
                class="size-2 rounded-full bg-emerald-500 animate-pulse shrink-0"
                title="活跃中 (正在发生调用)"
              />
              <span
                v-else
                class="size-1.5 rounded-full shrink-0"
                :class="monitorStore.activeSession?.id === s.id ? 'bg-primary' : 'bg-muted-foreground/40'"
              />

              <span class="truncate text-[11px]">
                {{ s.title || formatSessionDate(s.updatedAt) }}
              </span>
            </div>

            <span class="shrink-0 text-[10px] text-muted-foreground/70 font-mono ml-1">
              {{ formatRelativeTime(s.updatedAt) }}
            </span>
          </div>

          <!-- Load more sessions for this workspace if truncated -->
          <div
            v-if="ws.sessions.length < ws.sessionCount"
            class="pt-1"
          >
            <button
              @click.stop="monitorStore.loadMoreSessionsForWorkspace(ws.id)"
              class="w-full text-center py-1 text-[11px] text-primary hover:underline hover:bg-accent/30 rounded"
            >
              展开该目录下剩余 {{ ws.sessionCount - ws.sessions.length }} 个会话...
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer summary -->
    <div class="p-2.5 border-t border-border bg-card/40 text-[11px] text-muted-foreground flex items-center justify-between">
      <span>{{ monitorStore.workspaces.length }} 个工作目录</span>
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
  if (collapsedWorkspaces.value.has(id)) {
    collapsedWorkspaces.value.delete(id)
  } else {
    collapsedWorkspaces.value.add(id)
  }
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
