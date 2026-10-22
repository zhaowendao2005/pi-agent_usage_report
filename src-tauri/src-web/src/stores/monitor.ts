import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface SessionSummary {
  id: string
  fileName: string
  filePath: string
  cwd: string
  title: string | null
  createdAt: string | null
  updatedAt: number
  fileSize: number
  entryCount: number
  isLive: boolean
}

export interface WorkspaceItem {
  id: string
  path: string
  sessionCount: number
  lastActiveAt: number
  sessions: SessionSummary[]
}

export interface SessionTreeNode {
  id: string
  parentId: string | null
  depth: number
  isBranchPoint: boolean
  entryType: string
  timestamp: string | null
  role: string | null
  roleLabel: string
  summary: string
  detail: any
  status: string
  durationMs: number | null
  tokens: number | null
  cost: number | null
  isLeaf: boolean
  hasChildren: boolean
  childrenIds: string[]
}

export interface SessionTreeResult {
  sessionId: string
  cwd: string
  rootIds: string[]
  nodes: SessionTreeNode[]
  totalNodes: usize
}

export interface ActiveRequestTelemetry {
  isActive: boolean
  sessionId: string | null
  model: string | null
  provider: string | null
  phase: string // "waiting_ttft" | "thinking" | "text" | "tool_call" | "idle"
  currentDeltaSnippet: string
  totalChars: number
  totalTokensEst: number
  startedAt: number | null
  lastChunkAt: number | null
  silenceDurationMs: number
  activeDurationMs: number
  ttftMs: number | null
  tpsCurrent: number
  healthStatus: 'healthy' | 'waiting' | 'warning' | 'danger'
  diagnosticVerdict: string
}

type usize = number

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export const useMonitorStore = defineStore('monitor', () => {
  // --- State ---
  const workspaces = ref<WorkspaceItem[]>([])
  const activeWorkspaceId = ref<string | null>(null)
  const activeSession = ref<SessionSummary | null>(null)
  const sessionTree = ref<SessionTreeResult | null>(null)
  const activeNodeId = ref<string | null>(null)
  const hoveredNodeId = ref<string | null>(null)
  const activeGuideLevels = ref<number[]>([])
  const activeSubTab = ref<'tree' | 'live' | 'detail' | 'summary'>('tree')

  const collapsedNodeIds = ref<Set<string>>(new Set())
  const searchQuery = ref('')
  const isLoadingWorkspaces = ref(false)
  const isLoadingTree = ref(false)

  // Config settings
  const maxWorkspaces = ref(5)
  const maxSessionsPerDir = ref(5)
  const updateIntervalMs = ref(500)
  const idleWarningSec = ref(15)
  const idleDangerSec = ref(45)

  // Telemetry
  const telemetry = ref<ActiveRequestTelemetry>({
    isActive: false,
    sessionId: null,
    model: null,
    provider: null,
    phase: 'idle',
    currentDeltaSnippet: '',
    totalChars: 0,
    totalTokensEst: 0,
    startedAt: null,
    lastChunkAt: null,
    silenceDurationMs: 0,
    activeDurationMs: 0,
    ttftMs: null,
    tpsCurrent: 0,
    healthStatus: 'healthy',
    diagnosticVerdict: '当前无活跃请求，系统处于就绪状态。',
  })

  let telemetryTimer: any = null
  let treeLiveTimer: any = null

  // --- Getters ---
  const filteredWorkspaces = computed(() => {
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return workspaces.value

    return workspaces.value
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

  const selectedNode = computed<SessionTreeNode | null>(() => {
    if (!sessionTree.value || !activeNodeId.value) return null
    return sessionTree.value.nodes.find((n) => n.id === activeNodeId.value) ?? null
  })

  // Visible flattened nodes accounting for collapsed parent nodes
  const visibleNodes = computed(() => {
    if (!sessionTree.value) return []
    const collapsed = collapsedNodeIds.value
    const nodes = sessionTree.value.nodes

    // Set of IDs whose children should be hidden
    const hiddenDescendantIds = new Set<string>()

    for (const node of nodes) {
      if (node.parentId && hiddenDescendantIds.has(node.parentId)) {
        hiddenDescendantIds.add(node.id)
      } else if (collapsed.has(node.id)) {
        hiddenDescendantIds.add(node.id)
      }
    }

    return nodes.filter((n) => !hiddenDescendantIds.has(n.id))
  })

  // --- Actions ---
  async function fetchWorkspaces() {
    isLoadingWorkspaces.value = true
    try {
      if (isTauri()) {
        const res = await tauriInvoke<WorkspaceItem[]>('get_session_workspaces', {
          limitWorkspaces: maxWorkspaces.value,
          limitSessions: maxSessionsPerDir.value,
        })
        workspaces.value = res
        // Auto select first session if none active
        if (!activeSession.value && res.length > 0 && res[0].sessions.length > 0) {
          activeWorkspaceId.value = res[0].id
          await selectSession(res[0].sessions[0])
        }
      }
    } catch (err) {
      console.error('Failed to fetch workspaces:', err)
    } finally {
      isLoadingWorkspaces.value = false
    }
  }

  async function loadMoreSessionsForWorkspace(workspaceId: string) {
    const ws = workspaces.value.find((w) => w.id === workspaceId)
    if (!ws) return

    try {
      if (isTauri()) {
        const more = await tauriInvoke<SessionSummary[]>('fetch_more_sessions', {
          workspaceId,
          offset: ws.sessions.length,
          limit: 10,
        })
        if (more.length > 0) {
          ws.sessions.push(...more)
        }
      }
    } catch (err) {
      console.error('Failed to load more sessions:', err)
    }
  }

  async function selectSession(session: SessionSummary) {
    activeSession.value = session
    isLoadingTree.value = true
    collapsedNodeIds.value.clear()
    activeNodeId.value = null

    try {
      if (isTauri()) {
        const tree = await tauriInvoke<SessionTreeResult>('get_session_tree', {
          filePath: session.filePath,
        })
        sessionTree.value = tree
        if (tree.nodes.length > 0) {
          activeNodeId.value = tree.nodes[tree.nodes.length - 1].id
        }
      }
    } catch (err) {
      console.error('Failed to parse session tree:', err)
    } finally {
      isLoadingTree.value = false
    }
  }

  async function refreshCurrentTreeSilently() {
    if (!activeSession.value) return
    try {
      if (isTauri()) {
        const tree = await tauriInvoke<SessionTreeResult>('get_session_tree', {
          filePath: activeSession.value.filePath,
        })
        sessionTree.value = tree
      }
    } catch {
      // silent
    }
  }

  async function pollTelemetryOnce() {
    try {
      if (isTauri()) {
        const tel = await tauriInvoke<ActiveRequestTelemetry>('get_active_telemetry')
        telemetry.value = tel

        // If telemetry is active and matches current session, refresh tree
        if (tel.isActive) {
          await refreshCurrentTreeSilently()
        }
      }
    } catch {
      // silent
    }
  }

  function startLivePolling() {
    stopLivePolling()
    pollTelemetryOnce()
    telemetryTimer = setInterval(pollTelemetryOnce, 500)
  }

  function stopLivePolling() {
    if (telemetryTimer) {
      clearInterval(telemetryTimer)
      telemetryTimer = null
    }
    if (treeLiveTimer) {
      clearInterval(treeLiveTimer)
      treeLiveTimer = null
    }
  }

  function toggleNodeCollapse(nodeId: string) {
    if (collapsedNodeIds.value.has(nodeId)) {
      collapsedNodeIds.value.delete(nodeId)
    } else {
      collapsedNodeIds.value.add(nodeId)
    }
  }

  function setHoveredNode(node: SessionTreeNode | null) {
    hoveredNodeId.value = node ? node.id : null
    if (!node || !sessionTree.value) {
      activeGuideLevels.value = []
      return
    }

    // Build ancestor levels list
    const levels: number[] = []
    let curr: SessionTreeNode | undefined = node
    while (curr) {
      levels.push(curr.depth)
      if (curr.parentId) {
        curr = sessionTree.value.nodes.find((n) => n.id === curr?.parentId)
      } else {
        break
      }
    }
    activeGuideLevels.value = levels
  }

  return {
    // state
    workspaces,
    activeWorkspaceId,
    activeSession,
    sessionTree,
    activeNodeId,
    hoveredNodeId,
    activeGuideLevels,
    activeSubTab,
    collapsedNodeIds,
    searchQuery,
    isLoadingWorkspaces,
    isLoadingTree,
    maxWorkspaces,
    maxSessionsPerDir,
    updateIntervalMs,
    idleWarningSec,
    idleDangerSec,
    telemetry,

    // getters
    filteredWorkspaces,
    selectedNode,
    visibleNodes,

    // actions
    fetchWorkspaces,
    loadMoreSessionsForWorkspace,
    selectSession,
    refreshCurrentTreeSilently,
    pollTelemetryOnce,
    startLivePolling,
    stopLivePolling,
    toggleNodeCollapse,
    setHoveredNode,
  }
})
