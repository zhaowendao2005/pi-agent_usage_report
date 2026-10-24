<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm select-none animate-in fade-in duration-200"
      @keydown.esc="onClose"
    >
      <!-- Modal Container -->
      <div
        class="bg-card border border-border rounded-xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[85vh] overflow-hidden transition-all duration-200"
        @click.stop
      >
        <!-- Modal Header -->
        <div class="px-5 py-4 border-b border-border bg-card/60 flex items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-2.5">
            <div class="p-2 rounded-lg bg-primary/10 text-primary">
              <FolderTreeIcon class="w-5 h-5" />
            </div>
            <div>
              <h2 class="text-sm font-semibold text-foreground flex items-center gap-2">
                <span>全部工作空间与会话树</span>
                <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-normal">
                  {{ monitorStore.allWorkspaces.length }} 个工作目录
                </span>
              </h2>
              <p class="text-xs text-muted-foreground mt-0.5">
                同款 VS Code 标定线拓扑树 · 支持按目录路径、项目名称与会话提问全量检索
              </p>
            </div>
          </div>

          <!-- Close button -->
          <button
            @click="onClose"
            class="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="关闭 (Esc)"
          >
            <XIcon class="w-4 h-4" />
          </button>
        </div>

        <!-- Search & Quick Action Toolbar -->
        <div class="px-5 py-3 border-b border-border/80 bg-background/50 flex items-center justify-between gap-3 shrink-0">
          <!-- Search input -->
          <div class="relative flex-1">
            <SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              ref="searchInputEl"
              v-model="searchQuery"
              type="text"
              placeholder="全量检索工作空间路径、文件夹名或会话标题..."
              class="w-full bg-background border border-border rounded-lg pl-9 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all font-mono"
            />
            <button
              v-if="searchQuery"
              @click="searchQuery = ''"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon class="w-3.5 h-3.5" />
            </button>
          </div>

          <!-- Expand / Collapse All -->
          <div class="flex items-center gap-1.5 text-xs shrink-0">
            <button
              @click="expandAll"
              class="px-2 py-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              全部展开
            </button>
            <span class="text-border">|</span>
            <button
              @click="collapseAll"
              class="px-2 py-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              全部折叠
            </button>
          </div>
        </div>

        <!-- Tree Viewport (Strict internal vertical scroll) -->
        <div class="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-2 font-mono text-xs">
          <div v-if="filteredAllWorkspaces.length === 0" class="py-16 text-center text-xs text-muted-foreground">
            <FolderSearchIcon class="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>未找到匹配的工作空间或历史会话</p>
            <p v-if="searchQuery" class="text-[11px] text-muted-foreground/70 mt-1">
              可尝试清空搜索条件查看全部工作目录
            </p>
          </div>

          <!-- Workspace Node (Level 1) -->
          <div
            v-for="ws in filteredAllWorkspaces"
            :key="ws.id"
            class="rounded-lg border border-border/50 bg-card/30 overflow-hidden transition-colors hover:border-border"
          >
            <!-- Level 1 Directory Header Row -->
            <div
              @click="toggleCollapse(ws.id)"
              class="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent/40 transition-colors group"
              :class="monitorStore.activeWorkspaceId === ws.id ? 'bg-primary/5' : ''"
            >
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <ChevronRightIcon
                  class="size-3.5 text-muted-foreground transition-transform duration-150 shrink-0"
                  :class="{ 'rotate-90': !collapsedSet.has(ws.id) }"
                />
                <FolderGit2Icon class="size-4 text-amber-500/80 shrink-0" />
                <span class="font-semibold text-xs text-foreground truncate">
                  {{ formatWorkspaceName(ws.path) }}
                </span>
                <span class="text-[11px] text-muted-foreground/70 truncate hidden sm:inline" :title="ws.path">
                  {{ ws.path }}
                </span>
                <span
                  v-if="monitorStore.activeWorkspaceId === ws.id"
                  class="px-1.5 py-0.2 rounded bg-primary/20 text-primary text-[10px] shrink-0 font-sans"
                >
                  当前工作区
                </span>
              </div>

              <div class="flex items-center gap-2 shrink-0 ml-2 text-[11px] text-muted-foreground">
                <span
                  v-if="ws.lastOpenedAt"
                  class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-sans flex items-center gap-1"
                  :title="`最近打开时间: ${formatRelativeTime(ws.lastOpenedAt)}`"
                >
                  <ClockIcon class="w-3 h-3" />
                  <span>{{ formatRelativeTime(ws.lastOpenedAt) }} 打开</span>
                </span>
                <span v-else class="text-[10px] text-muted-foreground/60 hidden sm:inline">
                  {{ formatRelativeTime(ws.lastActiveAt) }}
                </span>
                <span class="px-2 py-0.5 rounded-full bg-secondary/80 text-[10px] font-mono">
                  {{ ws.sessionCount }} 个会话
                </span>
              </div>
            </div>

            <!-- Level 2: Sessions under this workspace (VS Code Indent Guide Style) -->
            <div
              v-if="!collapsedSet.has(ws.id)"
              class="border-t border-border/40 bg-background/40 py-1"
            >
              <div
                v-for="(session, sIdx) in ws.sessions"
                :key="session.id"
                @click="onSelectSession(ws, session)"
                class="group relative flex items-center h-7 px-3 cursor-pointer transition-colors hover:bg-accent/50 min-w-0"
                :class="monitorStore.activeSession?.id === session.id ? 'bg-primary/15 font-medium' : ''"
                :style="{ paddingLeft: '32px' }"
              >
                <!-- Indent Guide & Branch Elbow -->
                <div class="absolute inset-y-0 left-4 pointer-events-none flex">
                  <div class="indent-guide relative h-full border-l border-border/60 group-hover:border-primary/60 transition-colors w-4">
                    <span
                      class="absolute top-1/2 left-0 w-3 border-t border-border/60 group-hover:border-primary/60 -translate-y-1/2"
                    />
                  </div>
                </div>

                <!-- Session Icon & Live heartbeat -->
                <span
                  v-if="session.isLive"
                  class="size-2 rounded-full bg-emerald-500 animate-pulse shrink-0 mr-1.5"
                  title="活跃中 (正在发生调用)"
                />
                <span
                  v-else
                  class="size-1.5 rounded-full shrink-0 mr-1.5"
                  :class="monitorStore.activeSession?.id === session.id ? 'bg-primary' : 'bg-muted-foreground/50'"
                />

                <TerminalIcon class="size-3.5 text-muted-foreground group-hover:text-foreground shrink-0 mr-1.5 transition-colors" />

                <!-- Session title -->
                <span
                  class="text-[11px] text-foreground/90 truncate flex-1 min-w-0 mr-3"
                  :class="monitorStore.activeSession?.id === session.id ? 'text-primary font-medium' : ''"
                  :title="session.title || session.fileName"
                >
                  {{ session.title || session.fileName }}
                </span>

                <!-- Meta info on right -->
                <div class="shrink-0 flex items-center gap-2 text-[10px] text-muted-foreground/70 font-mono ml-auto">
                  <span v-if="monitorStore.activeSession?.id === session.id" class="text-primary font-sans">
                    已打开
                  </span>
                  <span>{{ formatRelativeTime(session.updatedAt) }}</span>
                </div>
              </div>

              <!-- Pagination / Fetch more in this workspace -->
              <div
                v-if="ws.sessions.length < ws.sessionCount"
                class="px-8 py-1.5 text-center"
              >
                <button
                  @click.stop="monitorStore.loadMoreSessionsForWorkspace(ws.id)"
                  class="text-[11px] text-primary hover:underline cursor-pointer"
                >
                  加载该目录下剩余 {{ ws.sessionCount - ws.sessions.length }} 个会话...
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="px-5 py-2.5 border-t border-border bg-card/60 flex items-center justify-between text-xs text-muted-foreground shrink-0">
          <div class="flex items-center gap-2 text-[11px]">
            <span>存储路径:</span>
            <code class="px-1.5 py-0.5 rounded bg-secondary font-mono text-[10px] text-foreground/80">
              ~/.pi/agent/sessions
            </code>
          </div>

          <div class="flex items-center gap-2 text-[11px]">
            <span>按 <kbd class="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono">Esc</kbd> 退出</span>
            <button
              @click="onClose"
              class="px-3 py-1 rounded bg-secondary hover:bg-accent text-foreground text-xs transition-colors cursor-pointer"
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
import { ref, computed, onMounted, nextTick } from 'vue'
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
const searchQuery = ref('')
const collapsedSet = ref<Set<string>>(new Set())

onMounted(async () => {
  await monitorStore.fetchAllWorkspaces()
  nextTick(() => {
    searchInputEl.value?.focus()
  })
})

function onClose() {
  monitorStore.closeAllWorkspacesModal()
}

function toggleCollapse(wsId: string) {
  if (collapsedSet.value.has(wsId)) {
    collapsedSet.value.delete(wsId)
  } else {
    collapsedSet.value.add(wsId)
  }
}

function expandAll() {
  collapsedSet.value.clear()
}

function collapseAll() {
  for (const ws of monitorStore.allWorkspaces) {
    collapsedSet.value.add(ws.id)
  }
}

function onSelectSession(ws: WorkspaceItem, session: SessionSummary) {
  monitorStore.touchWorkspace(ws.id)
  monitorStore.selectSession(session, ws.id)
  monitorStore.closeAllWorkspacesModal()
}

const filteredAllWorkspaces = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return monitorStore.allWorkspaces

  return monitorStore.allWorkspaces
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

<style scoped>
.indent-guide {
  box-sizing: border-box;
}
</style>
