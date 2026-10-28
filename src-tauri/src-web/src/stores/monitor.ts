import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

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
  lastOpenedAt?: number
  sessions: SessionSummary[]
}

export interface SessionTreeNode {
  id: string
  parentId: string | null
  depth: number
  isBranchPoint: boolean
  branchKind?: 'user' | 'thinking' | 'tool' | 'assistant' | 'error' | 'system' | string
  entryType: string
  timestamp: string | null
  role: string | null
  roleLabel: string
  summary: string
  model?: string | null
  toolName?: string | null
  charCount?: number
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

export interface TelemetryChunk {
  seq: number
  timestamp: number
  phase: string
  chars: number
  totalChars: number
  text: string
}

export interface ActiveRequestTelemetry {
  isActive: boolean
  sessionId: string | null
  model: string | null
  provider: string | null
  phase: string // "waiting_ttft" | "thinking" | "text" | "tool_call" | "idle"
  currentDeltaSnippet: string
  accumulatedText: string
  thinkingText: string
  chunks: TelemetryChunk[]
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

// === Workspace Recent Open Persistence & Ordering ===
const STORAGE_KEY_LAST_OPENED = 'pi_monitor_workspaces_last_opened'

export function getWorkspaceLastOpenedMap(): Record<string, number> {
  try {
    const data = localStorage.getItem(STORAGE_KEY_LAST_OPENED)
    return data ? JSON.parse(data) : {}
  } catch {
    return {}
  }
}

export function saveWorkspaceLastOpenedMap(map: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY_LAST_OPENED, JSON.stringify(map))
  } catch {
    // silent fallback
  }
}

export function recordWorkspaceOpened(workspaceId: string): number {
  const map = getWorkspaceLastOpenedMap()
  const now = Date.now()
  map[workspaceId] = now
  saveWorkspaceLastOpenedMap(map)
  return now
}

export function getWorkspaceEffectiveTime(ws: WorkspaceItem): number {
  return ws.lastOpenedAt ?? ws.lastActiveAt ?? 0
}

export function sortWorkspacesByRecentOpened(list: WorkspaceItem[]): WorkspaceItem[] {
  return [...list].sort((a, b) => getWorkspaceEffectiveTime(b) - getWorkspaceEffectiveTime(a))
}

function createEmptyTelemetry(sessionId: string | null = null): ActiveRequestTelemetry {
  return {
    isActive: false,
    sessionId,
    model: null,
    provider: null,
    phase: 'idle',
    currentDeltaSnippet: '',
    accumulatedText: '',
    thinkingText: '',
    chunks: [],
    totalChars: 0,
    totalTokensEst: 0,
    startedAt: null,
    lastChunkAt: null,
    silenceDurationMs: 0,
    activeDurationMs: 0,
    ttftMs: null,
    tpsCurrent: 0,
    healthStatus: 'healthy',
    diagnosticVerdict: '当前会话无活跃请求，系统处于待命状态。',
  }
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

  // Cold-loaded Node Detail State
  const selectedNodeDetail = ref<any>(null)
  const isLoadingNodeDetail = ref(false)
  const nodeDetailCache = new Map<string, any>()

  // Workspace Modal State
  const isAllWorkspacesModalOpen = ref(false)
  const modalFocusedWorkspaceId = ref<string | null>(null)
  const allWorkspaces = ref<WorkspaceItem[]>([])
  const isLoadingAllWorkspaces = ref(false)

  // Config settings
  const maxWorkspaces = ref(5)
  const maxSessionsPerDir = ref(5)
  const updateIntervalMs = ref(500)
  const idleWarningSec = ref(15)
  const idleDangerSec = ref(45)

  // Raw Telemetry from backend / mock
  const telemetry = ref<ActiveRequestTelemetry>(createEmptyTelemetry(null))

  let telemetryTimer: any = null
  let treeLiveTimer: any = null

  // --- Getters ---
  // Strictly isolated telemetry for the currently active session!
  const currentSessionTelemetry = computed<ActiveRequestTelemetry>(() => {
    const curSid = activeSession.value?.id ?? null
    if (!curSid) {
      return createEmptyTelemetry(null)
    }
    if (telemetry.value.sessionId && telemetry.value.sessionId !== curSid) {
      return createEmptyTelemetry(curSid)
    }
    return telemetry.value
  })

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

    const hiddenAncestorIds = new Set<string>(collapsed)
    const hiddenNodeIds = new Set<string>()

    for (const node of nodes) {
      if (node.parentId && (hiddenAncestorIds.has(node.parentId) || hiddenNodeIds.has(node.parentId))) {
        hiddenNodeIds.add(node.id)
      }
    }

    return nodes.filter((n) => !hiddenNodeIds.has(n.id))
  })

  // --- Actions ---
  async function fetchWorkspaces() {
    isLoadingWorkspaces.value = true
    try {
      const openedMap = getWorkspaceLastOpenedMap()

      if (isTauri()) {
        const res = await tauriInvoke<WorkspaceItem[]>('get_session_workspaces', {
          limitWorkspaces: null,
          limitSessions: maxSessionsPerDir.value,
        })
        for (const ws of res) {
          if (openedMap[ws.id]) {
            ws.lastOpenedAt = openedMap[ws.id]
          }
        }
        const sorted = sortWorkspacesByRecentOpened(res)
        allWorkspaces.value = sorted
        workspaces.value = sorted.slice(0, maxWorkspaces.value)

        if (!activeSession.value && workspaces.value.length > 0 && workspaces.value[0].sessions.length > 0) {
          activeWorkspaceId.value = workspaces.value[0].id
          await selectSession(workspaces.value[0].sessions[0], workspaces.value[0].id)
        }
      } else {
        const mockWs = createMockWorkspaces()
        for (const ws of mockWs) {
          if (openedMap[ws.id]) {
            ws.lastOpenedAt = openedMap[ws.id]
          }
        }
        const sorted = sortWorkspacesByRecentOpened(mockWs)
        allWorkspaces.value = sorted
        workspaces.value = sorted.slice(0, maxWorkspaces.value)

        if (!activeSession.value && workspaces.value.length > 0 && workspaces.value[0].sessions.length > 0) {
          activeWorkspaceId.value = workspaces.value[0].id
          await selectSession(workspaces.value[0].sessions[0], workspaces.value[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch workspaces:', err)
    } finally {
      isLoadingWorkspaces.value = false
    }
  }

  async function fetchAllWorkspaces() {
    isLoadingAllWorkspaces.value = true
    try {
      const openedMap = getWorkspaceLastOpenedMap()
      if (isTauri()) {
        const res = await tauriInvoke<WorkspaceItem[]>('get_session_workspaces', {
          limitWorkspaces: null,
          limitSessions: 200,
        })
        for (const ws of res) {
          if (openedMap[ws.id]) {
            ws.lastOpenedAt = openedMap[ws.id]
          }
        }
        allWorkspaces.value = sortWorkspacesByRecentOpened(res)
      } else {
        const mockWs = createMockWorkspaces(true)
        for (const ws of mockWs) {
          if (openedMap[ws.id]) {
            ws.lastOpenedAt = openedMap[ws.id]
          }
        }
        allWorkspaces.value = sortWorkspacesByRecentOpened(mockWs)
      }
    } catch (err) {
      console.error('Failed to fetch all workspaces:', err)
    } finally {
      isLoadingAllWorkspaces.value = false
    }
  }

  function touchWorkspace(workspaceId: string) {
    const now = recordWorkspaceOpened(workspaceId)
    activeWorkspaceId.value = workspaceId

    let targetWs = allWorkspaces.value.find((w) => w.id === workspaceId)
    if (!targetWs) {
      targetWs = workspaces.value.find((w) => w.id === workspaceId)
    }

    if (targetWs) {
      targetWs.lastOpenedAt = now
    }

    allWorkspaces.value = sortWorkspacesByRecentOpened(allWorkspaces.value)

    if (targetWs) {
      const idx = workspaces.value.findIndex((w) => w.id === workspaceId)
      if (idx !== -1) {
        workspaces.value.splice(idx, 1)
      }
      workspaces.value.unshift(targetWs)
      if (workspaces.value.length > maxWorkspaces.value) {
        workspaces.value = workspaces.value.slice(0, maxWorkspaces.value)
      }
    }
  }

  function openAllWorkspacesModal(focusWorkspaceId?: string) {
    modalFocusedWorkspaceId.value = focusWorkspaceId ?? null
    isAllWorkspacesModalOpen.value = true
  }

  function closeAllWorkspacesModal() {
    isAllWorkspacesModalOpen.value = false
    modalFocusedWorkspaceId.value = null
  }

  async function loadMoreSessionsForWorkspace(workspaceId: string) {
    const ws =
      allWorkspaces.value.find((w) => w.id === workspaceId) ||
      workspaces.value.find((w) => w.id === workspaceId)
    if (!ws) return

    try {
      if (isTauri()) {
        const more = await tauriInvoke<SessionSummary[]>('fetch_more_sessions', {
          workspaceId,
          offset: ws.sessions.length,
          limit: 50,
        })
        if (more.length > 0) {
          const existingIds = new Set(ws.sessions.map((s) => s.id))
          for (const item of more) {
            if (!existingIds.has(item.id)) {
              ws.sessions.push(item)
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load more sessions:', err)
    }
  }

  function applyDefaultCollapse(tree: SessionTreeResult) {
    const set = new Set<string>()
    for (const node of tree.nodes) {
      if (node.hasChildren) {
        set.add(node.id)
      }
    }
    collapsedNodeIds.value = set
  }

  function collapseAllNodes() {
    if (!sessionTree.value) return
    const set = new Set<string>()
    for (const node of sessionTree.value.nodes) {
      if (node.hasChildren) {
        set.add(node.id)
      }
    }
    collapsedNodeIds.value = set
  }

  function expandAllNodes() {
    collapsedNodeIds.value = new Set()
  }

  async function fetchNodeDetailOnDemand(node: SessionTreeNode | null) {
    if (!node || !activeSession.value) {
      selectedNodeDetail.value = null
      return
    }
    // If detail is already populated in memory
    if (node.detail && typeof node.detail === 'object' && Object.keys(node.detail).length > 0) {
      selectedNodeDetail.value = node.detail
      return
    }
    const cacheKey = `${activeSession.value.filePath}::${node.id}`
    if (nodeDetailCache.has(cacheKey)) {
      selectedNodeDetail.value = nodeDetailCache.get(cacheKey)
      return
    }

    isLoadingNodeDetail.value = true
    try {
      if (isTauri()) {
        const detail = await tauriInvoke<any>('get_session_node_detail', {
          filePath: activeSession.value.filePath,
          nodeId: node.id,
        })
        if (nodeDetailCache.size > 200) {
          const firstKey = nodeDetailCache.keys().next().value
          if (firstKey) nodeDetailCache.delete(firstKey)
        }
        nodeDetailCache.set(cacheKey, detail)
        if (activeNodeId.value === node.id) {
          selectedNodeDetail.value = detail
        }
      } else {
        selectedNodeDetail.value = node.detail ?? { id: node.id, summary: node.summary }
      }
    } catch (err) {
      console.error('Failed to cold-load node detail:', err)
      selectedNodeDetail.value = { id: node.id, summary: node.summary }
    } finally {
      isLoadingNodeDetail.value = false
    }
  }

  watch(selectedNode, (newNode) => {
    fetchNodeDetailOnDemand(newNode)
  })

  async function selectSession(session: SessionSummary, workspaceId?: string) {
    if (!workspaceId) {
      const found =
        workspaces.value.find((w) => w.sessions.some((s) => s.id === session.id)) ||
        allWorkspaces.value.find((w) => w.sessions.some((s) => s.id === session.id))
      if (found) {
        workspaceId = found.id
      }
    }

    if (workspaceId) {
      touchWorkspace(workspaceId)
      // Ensure selected session is visible in sidebar's top sessions without expanding all N sessions
      const sidebarWs = workspaces.value.find((w) => w.id === workspaceId)
      if (sidebarWs && !sidebarWs.sessions.some((s) => s.id === session.id)) {
        sidebarWs.sessions.unshift(session)
        if (sidebarWs.sessions.length > maxSessionsPerDir.value) {
          sidebarWs.sessions = sidebarWs.sessions.slice(0, maxSessionsPerDir.value)
        }
      }
    }

    activeSession.value = session
    // Immediately reset telemetry to current session to prevent any cross-session flash
    telemetry.value = createEmptyTelemetry(session.id)
    isLoadingTree.value = true
    activeNodeId.value = null
    selectedNodeDetail.value = null

    try {
      if (isTauri()) {
        const tree = await tauriInvoke<SessionTreeResult>('get_session_tree', {
          filePath: session.filePath,
        })
        sessionTree.value = tree
        // Default collapse all execution branches as requested
        applyDefaultCollapse(tree)
        // Select last top-level turn node by default
        const roots = tree.nodes.filter((n) => n.depth === 0)
        if (roots.length > 0) {
          activeNodeId.value = roots[roots.length - 1].id
        } else if (tree.nodes.length > 0) {
          activeNodeId.value = tree.nodes[tree.nodes.length - 1].id
        }
      } else {
        const mockTree = createMockSessionTree(session.id)
        sessionTree.value = mockTree
        applyDefaultCollapse(mockTree)
        const roots = mockTree.nodes.filter((n) => n.depth === 0)
        if (roots.length > 0) {
          activeNodeId.value = roots[roots.length - 1].id
        }
      }
      // Poll telemetry immediately for the newly selected session
      await pollTelemetryOnce()
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
        const prevNodeIds = new Set(sessionTree.value?.nodes.map((n) => n.id) ?? [])
        const tree = await tauriInvoke<SessionTreeResult>('get_session_tree', {
          filePath: activeSession.value.filePath,
        })
        // Auto-collapse any newly added parent turns while preserving user's manual expand/collapse state
        for (const n of tree.nodes) {
          if (n.hasChildren && !prevNodeIds.has(n.id)) {
            collapsedNodeIds.value.add(n.id)
          }
        }
        sessionTree.value = tree
      }
    } catch {
      // silent
    }
  }

  let lastTreeRefreshAt = 0

  async function pollTelemetryOnce() {
    const curSession = activeSession.value
    if (!curSession) {
      telemetry.value = createEmptyTelemetry(null)
      return
    }

    const wasActive = telemetry.value.isActive && telemetry.value.sessionId === curSession.id

    try {
      if (isTauri()) {
        const tel = await tauriInvoke<ActiveRequestTelemetry>('get_active_telemetry', {
          sessionId: curSession.id,
          filePath: curSession.filePath,
        })
        // Guard against race condition if user switched session while invoke was in-flight
        if (activeSession.value?.id !== curSession.id) {
          return
        }
        // Strict session isolation: never accept telemetry from another session
        if (tel.sessionId && tel.sessionId !== curSession.id) {
          telemetry.value = createEmptyTelemetry(curSession.id)
          return
        }
        telemetry.value = {
          ...createEmptyTelemetry(curSession.id),
          ...tel,
          sessionId: curSession.id,
        }

        const now = Date.now()
        // Refresh current session tree throttled (every 2s) while streaming, and once immediately when streaming finishes
        if (tel.isActive && tel.sessionId === curSession.id) {
          if (now - lastTreeRefreshAt >= 2000) {
            lastTreeRefreshAt = now
            await refreshCurrentTreeSilently()
          }
        } else if (wasActive && !tel.isActive) {
          lastTreeRefreshAt = now
          await refreshCurrentTreeSilently()
        }
      } else {
        // Pure Web Dev Mode mock telemetry: strictly isolated by curSession.isLive!
        telemetry.value = createMockTelemetryForSession(curSession)
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
    const next = new Set(collapsedNodeIds.value)
    if (next.has(nodeId)) {
      next.delete(nodeId)
    } else {
      next.add(nodeId)
    }
    collapsedNodeIds.value = next
  }

  function setHoveredNode(node: SessionTreeNode | null) {
    hoveredNodeId.value = node ? node.id : null
    if (!node || !sessionTree.value) {
      activeGuideLevels.value = []
      return
    }

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
    selectedNodeDetail,
    isLoadingNodeDetail,
    isAllWorkspacesModalOpen,
    modalFocusedWorkspaceId,
    allWorkspaces,
    isLoadingAllWorkspaces,
    maxWorkspaces,
    maxSessionsPerDir,
    updateIntervalMs,
    idleWarningSec,
    idleDangerSec,
    telemetry,

    // getters
    currentSessionTelemetry,
    filteredWorkspaces,
    selectedNode,
    visibleNodes,

    // actions
    fetchWorkspaces,
    fetchAllWorkspaces,
    openAllWorkspacesModal,
    closeAllWorkspacesModal,
    touchWorkspace,
    loadMoreSessionsForWorkspace,
    selectSession,
    collapseAllNodes,
    expandAllNodes,
    fetchNodeDetailOnDemand,
    refreshCurrentTreeSilently,
    pollTelemetryOnce,
    startLivePolling,
    stopLivePolling,
    toggleNodeCollapse,
    setHoveredNode,
  }
})

// === Mock Data for Browser Dev Mode ===

function createMockTelemetryForSession(session: SessionSummary): ActiveRequestTelemetry {
  const now = Date.now()
  if (session.isLive) {
    const chunks: TelemetryChunk[] = [
      {
        seq: 1,
        timestamp: now - 14200,
        phase: 'thinking',
        chars: 68,
        totalChars: 68,
        text: '正在分析监控视图中 Session 1 与 Session 2 的实时数据追踪隔离边界问题...',
      },
      {
        seq: 2,
        timestamp: now - 11800,
        phase: 'thinking',
        chars: 94,
        totalChars: 162,
        text: '确认原因：pollTelemetryOnce 直接复用了全局 active_turn.json，需要按 sessionId 严格隔离。',
      },
      {
        seq: 3,
        timestamp: now - 8500,
        phase: 'text',
        chars: 120,
        totalChars: 282,
        text: '已完成 1px VS Code 垂直标定线与旋转角标（Chevron）对齐计算，移除了冗余的双重标定线与横向折线。',
      },
      {
        seq: 4,
        timestamp: now - 4200,
        phase: 'text',
        chars: 136,
        totalChars: 418,
        text: '正在构建虚拟滚动列表（Virtual Scroll）与按需冷加载通道，确保上千个节点与高频流式数据包下保持 60fps 渲染...',
      },
      {
        seq: 5,
        timestamp: now - 600,
        phase: 'text',
        chars: 86,
        totalChars: 504,
        text: '已同步应用瑞士国际现代主义（Swiss Modernist Grid）1px 开放式结构网格布局。',
      },
    ]

    return {
      isActive: true,
      sessionId: session.id,
      model: 'deepseek-v4.1-flash-1017',
      provider: 'a6api-deepseek',
      phase: 'text',
      currentDeltaSnippet: chunks[chunks.length - 1].text,
      thinkingText: chunks
        .filter((c) => c.phase === 'thinking')
        .map((c) => c.text)
        .join('\n'),
      accumulatedText: chunks
        .filter((c) => c.phase !== 'thinking')
        .map((c) => c.text)
        .join('\n\n'),
      chunks,
      totalChars: 504,
      totalTokensEst: 144,
      startedAt: now - 14500,
      lastChunkAt: now - 600,
      silenceDurationMs: 600,
      activeDurationMs: 14500,
      ttftMs: 420,
      tpsCurrent: 58.4,
      healthStatus: 'healthy',
      diagnosticVerdict: '正常高速流式中：实时吞吐率 58.4 tok/s，数据流顺畅。',
    }
  }

  // Inactive Session (e.g. Session 2): strictly isActive = false, shows its own historical chunks
  const histChunks: TelemetryChunk[] = [
    {
      seq: 1,
      timestamp: session.updatedAt - 18000,
      phase: 'thinking',
      chars: 52,
      totalChars: 52,
      text: `[历史记录] 检索会话 "${session.title || session.fileName}" 的上下文结构与模块依赖。`,
    },
    {
      seq: 2,
      timestamp: session.updatedAt - 9000,
      phase: 'tool_call',
      chars: 78,
      totalChars: 130,
      text: `[toolCall: read] 读取目标配置文件与组件源码完成。`,
    },
    {
      seq: 3,
      timestamp: session.updatedAt - 2000,
      phase: 'text',
      chars: 112,
      totalChars: 242,
      text: `已完成该会话的所有预定修改并通过类型检查。当前会话已执行完毕，处于静止待命状态。`,
    },
  ]

  return {
    isActive: false,
    sessionId: session.id,
    model: 'claude-3-5-sonnet',
    provider: 'anthropic',
    phase: 'idle',
    currentDeltaSnippet: '',
    thinkingText: histChunks[0].text,
    accumulatedText: `${histChunks[1].text}\n\n${histChunks[2].text}`,
    chunks: histChunks,
    totalChars: 242,
    totalTokensEst: 69,
    startedAt: null,
    lastChunkAt: session.updatedAt,
    silenceDurationMs: 0,
    activeDurationMs: 0,
    ttftMs: null,
    tpsCurrent: 0,
    healthStatus: 'healthy',
    diagnosticVerdict: '当前会话无活跃请求，系统处于待命状态（下方展示本会话历史传入数据包）。',
  }
}

function createMockWorkspaces(includeAll = false): WorkspaceItem[] {
  const now = Date.now()
  const baseSessionsWs1: SessionSummary[] = [
    {
      id: '01a20101-11aa-4301-8811-000000000001',
      fileName: '2026-10-23T06-40-12-100Z_01a20101.jsonl',
      filePath: 'D:\\code\\pi-extension\\usage_report\\.pi\\session.jsonl',
      cwd: 'D:\\code\\pi-extension\\usage_report',
      title: '优化工作空间与全量会话树模态弹窗与检索交互',
      createdAt: '2026-10-23T06:40:12.100Z',
      updatedAt: now - 15_000,
      fileSize: 98200,
      entryCount: 28,
      isLive: true,
    },
    {
      id: '01a20101-11aa-4301-8811-000000000002',
      fileName: '2026-10-23T05-20-00-000Z_01a20102.jsonl',
      filePath: 'D:\\code\\pi-extension\\usage_report\\.pi\\session2.jsonl',
      cwd: 'D:\\code\\pi-extension\\usage_report',
      title: '解决端口占用与Vite前端免编译热重载调试方案',
      createdAt: '2026-10-23T05:20:00.000Z',
      updatedAt: now - 3600_000,
      fileSize: 42100,
      entryCount: 14,
      isLive: false,
    },
  ]

  if (includeAll) {
    for (let i = 3; i <= 8; i++) {
      baseSessionsWs1.push({
        id: `01a20101-11aa-4301-8811-00000000000${i}`,
        fileName: `2026-10-22T0${i}-00-00-000Z_01a2010${i}.jsonl`,
        filePath: `D:\\code\\pi-extension\\usage_report\\.pi\\session${i}.jsonl`,
        cwd: 'D:\\code\\pi-extension\\usage_report',
        title: `历史开发会话 #${i}：构建多维 Token 成本校准与适配器架构`,
        createdAt: `2026-10-22T0${i}:00:00.000Z`,
        updatedAt: now - 3600_000 * i,
        fileSize: 34000 + i * 2000,
        entryCount: 12 + i,
        isLive: false,
      })
    }
  }

  return [
    {
      id: '--D--code-pi-extension-usage_report--',
      path: 'D:\\code\\pi-extension\\usage_report',
      sessionCount: 8,
      lastActiveAt: now - 15_000,
      sessions: baseSessionsWs1,
    },
    {
      id: '--F--lattice-archive-v2--',
      path: 'F:\\lattice-archive-v2',
      sessionCount: 12,
      lastActiveAt: now - 45_000,
      sessions: [
        {
          id: '01a15b25-5c13-742b-8a13-da55e63e07d9',
          fileName: '2026-10-20T21-08-57-491Z_01a15b25-5c13-742b-8a13-da55e63e07d9.jsonl',
          filePath: 'F:\\lattice-archive-v2\\.pi\\session.jsonl',
          cwd: 'F:\\lattice-archive-v2',
          title: '这边输入行的位置，感觉有点不和谐，你给我一个调整方案看看',
          createdAt: '2026-10-20T21:08:57.491Z',
          updatedAt: now - 45_000,
          fileSize: 142850,
          entryCount: 42,
          isLive: false,
        },
        {
          id: '01a16554-3f8d-703b-8644-d69381131bd9',
          fileName: '2026-10-22T20-36-22-542Z_01a16554-3f8d-703b-8644-d69381131bd9.jsonl',
          filePath: 'F:\\lattice-archive-v2\\.pi\\session2.jsonl',
          cwd: 'F:\\lattice-archive-v2',
          title: '排查 MessageBubble 渲染卡顿与动画异常',
          createdAt: '2026-10-22T20:36:22.542Z',
          updatedAt: now - 3600_000 * 2,
          fileSize: 45200,
          entryCount: 18,
          isLive: false,
        },
      ],
    },
    {
      id: '--D--code-salesTrace-v2--',
      path: 'D:\\code\\salesTrace-v2',
      sessionCount: 5,
      lastActiveAt: now - 3600_000 * 5,
      sessions: [
        {
          id: '01a15612-66da-72a2-ad5c-82c5267739e2',
          fileName: 'session_sales.jsonl',
          filePath: 'D:\\code\\salesTrace-v2\\.pi\\session.jsonl',
          cwd: 'D:\\code\\salesTrace-v2',
          title: '重构销售机会流转看板数据聚合逻辑',
          createdAt: '2026-10-19T21:30:08.986Z',
          updatedAt: now - 3600_000 * 5,
          fileSize: 89000,
          entryCount: 35,
          isLive: false,
        },
      ],
    },
    {
      id: '--D--projects-crm-backend--',
      path: 'D:\\projects\\crm-backend',
      sessionCount: 16,
      lastActiveAt: now - 3600_000 * 12,
      sessions: [
        {
          id: '01a15888-77cc-99aa-bb11-445566778899',
          fileName: 'session_crm.jsonl',
          filePath: 'D:\\projects\\crm-backend\\.pi\\session.jsonl',
          cwd: 'D:\\projects\\crm-backend',
          title: '客户合同自动审批流与状态机迁移验证',
          createdAt: '2026-10-18T10:15:30.000Z',
          updatedAt: now - 3600_000 * 12,
          fileSize: 112000,
          entryCount: 50,
          isLive: false,
        },
      ],
    },
    {
      id: '--E--workspace-data-pipeline--',
      path: 'E:\\workspace\\data-pipeline',
      sessionCount: 7,
      lastActiveAt: now - 86400_000,
      sessions: [
        {
          id: '01a14111-2222-3333-4444-555566667777',
          fileName: 'session_pipeline.jsonl',
          filePath: 'E:\\workspace\\data-pipeline\\.pi\\session.jsonl',
          cwd: 'E:\\workspace\\data-pipeline',
          title: 'ClickHouse 批量写入降频与背压缓存机制设计',
          createdAt: '2026-10-17T08:00:00.000Z',
          updatedAt: now - 86400_000,
          fileSize: 67300,
          entryCount: 24,
          isLive: false,
        },
      ],
    },
  ]
}

function createMockSessionTree(sessionId: string): SessionTreeResult {
  const t1_children = ['step_t1_1', 'step_t1_2', 'step_t1_3', 'step_t1_4', 'step_t1_5']
  const t2_children = ['step_t2_1', 'step_t2_2', 'step_t2_3', 'step_t2_4', 'step_t2_5', 'step_t2_6']
  const t3_children = ['step_t3_1', 'step_t3_2', 'step_t3_3']

  return {
    sessionId,
    cwd: 'F:\\lattice-archive-v2',
    rootIds: ['init_1', 'turn_1', 'turn_2', 'turn_3'],
    totalNodes: 18,
    nodes: [
      {
        id: 'init_1',
        parentId: null,
        depth: 0,
        isBranchPoint: false,
        branchKind: 'system',
        entryType: 'model_change',
        timestamp: '2026-10-20T21:09:05.565Z',
        role: null,
        roleLabel: 'model_change',
        model: 'deepseek-v4.1-flash-1017',
        summary: '[model: deepseek-v4.1-flash-1017 (thinking: low)]',
        detail: { modelId: 'deepseek-v4.1-flash-1017' },
        status: 'ok',
        durationMs: null,
        tokens: null,
        cost: null,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      // === Turn 1 ===
      {
        id: 'turn_1',
        parentId: null,
        depth: 0,
        isBranchPoint: false,
        branchKind: 'user',
        entryType: 'message',
        timestamp: '2026-10-20T21:09:29.480Z',
        role: 'user',
        roleLabel: 'user',
        summary: 'user: 这边输入行的位置，感觉有点不和谐，你给我一个调整方案看看',
        detail: { message: { role: 'user', content: '这边输入行的位置，感觉有点不和谐，你给我一个调整方案看看' } },
        status: 'ok',
        durationMs: null,
        tokens: null,
        cost: null,
        isLeaf: false,
        hasChildren: true,
        childrenIds: t1_children,
      },
      {
        id: 'step_t1_1',
        parentId: 'turn_1',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'thinking',
        entryType: 'message',
        timestamp: '2026-10-20T21:09:35.120Z',
        role: 'assistant',
        roleLabel: 'thinking',
        model: 'deepseek-v4.1-flash-1017',
        summary: '[thinking] 用户给了一张截图，想调整输入行的位置。先看图片排查布局结构。',
        detail: {},
        status: 'ok',
        durationMs: 1420,
        tokens: 380,
        cost: 0.00004,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t1_2',
        parentId: 'turn_1',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'tool',
        entryType: 'message',
        timestamp: '2026-10-20T21:09:37.400Z',
        role: 'toolResult',
        roleLabel: 'bash',
        toolName: 'bash',
        summary: '[bash: cd /f/lattice-archive-v2 && rg --files src/views/main/chats | head -50]',
        detail: {},
        status: 'ok',
        durationMs: 91,
        tokens: null,
        cost: null,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t1_3',
        parentId: 'turn_1',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'tool',
        entryType: 'message',
        timestamp: '2026-10-20T21:09:40.150Z',
        role: 'toolResult',
        roleLabel: 'read',
        toolName: 'read',
        summary: '[read: src/views/main/chats/conversation/ConversationContainer.vue (offset 1, limit 80)]',
        detail: {},
        status: 'ok',
        durationMs: 45,
        tokens: null,
        cost: null,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t1_4',
        parentId: 'turn_1',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'tool',
        entryType: 'message',
        timestamp: '2026-10-20T21:09:43.200Z',
        role: 'toolResult',
        roleLabel: 'read',
        toolName: 'read',
        summary: '[read: src/views/main/chats/conversation/MessageFeed.vue (offset 1, limit 80)]',
        detail: {},
        status: 'ok',
        durationMs: 38,
        tokens: null,
        cost: null,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t1_5',
        parentId: 'turn_1',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'assistant',
        entryType: 'message',
        timestamp: '2026-10-20T21:09:48.800Z',
        role: 'assistant',
        roleLabel: 'assistant',
        model: 'deepseek-v4.1-flash-1017',
        summary: 'assistant: 现在理解结构了：MessageFeed (含蓝色背景图案) + MessageInput。建议将输入框底色设为 card 背景...',
        detail: {},
        status: 'ok',
        durationMs: 3650,
        tokens: 680,
        cost: 0.00012,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      // === Turn 2 ===
      {
        id: 'turn_2',
        parentId: null,
        depth: 0,
        isBranchPoint: false,
        branchKind: 'user',
        entryType: 'message',
        timestamp: '2026-10-20T21:10:02.100Z',
        role: 'user',
        roleLabel: 'user',
        summary: 'user: 去改',
        detail: { content: '去改' },
        status: 'ok',
        durationMs: null,
        tokens: null,
        cost: null,
        isLeaf: false,
        hasChildren: true,
        childrenIds: t2_children,
      },
      {
        id: 'step_t2_1',
        parentId: 'turn_2',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'thinking',
        entryType: 'message',
        timestamp: '2026-10-20T21:10:05.300Z',
        role: 'assistant',
        roleLabel: 'thinking',
        model: 'deepseek-v4.1-flash-1017',
        summary: '[thinking] 执行方案 A。修改 MessageInput.vue 和 MessageFeed.vue，统一底色和内边距。',
        detail: {},
        status: 'ok',
        durationMs: 1200,
        tokens: 310,
        cost: 0.00003,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t2_2',
        parentId: 'turn_2',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'tool',
        entryType: 'message',
        timestamp: '2026-10-20T21:10:08.500Z',
        role: 'toolResult',
        roleLabel: 'edit',
        toolName: 'edit',
        summary: '[edit: src/views/main/chats/conversation/MessageInput.vue 替换 1 个区块]',
        detail: {},
        status: 'ok',
        durationMs: 82,
        tokens: null,
        cost: null,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t2_3',
        parentId: 'turn_2',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'tool',
        entryType: 'message',
        timestamp: '2026-10-20T21:10:08.520Z',
        role: 'toolResult',
        roleLabel: 'result',
        toolName: 'edit',
        summary: '[editResult: Successfully replaced 1 block in MessageInput.vue]',
        detail: {},
        status: 'ok',
        durationMs: 2,
        tokens: null,
        cost: null,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t2_4',
        parentId: 'turn_2',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'tool',
        entryType: 'message',
        timestamp: '2026-10-20T21:10:10.800Z',
        role: 'toolResult',
        roleLabel: 'edit',
        toolName: 'edit',
        summary: '[edit: src/views/main/chats/conversation/MessageFeed.vue 调整遮罩渐变]',
        detail: {},
        status: 'ok',
        durationMs: 76,
        tokens: null,
        cost: null,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t2_5',
        parentId: 'turn_2',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'tool',
        entryType: 'message',
        timestamp: '2026-10-20T21:10:14.200Z',
        role: 'toolResult',
        roleLabel: 'bash',
        toolName: 'bash',
        summary: '[bash: npm run typecheck (0 errors)]',
        detail: {},
        status: 'ok',
        durationMs: 2310,
        tokens: null,
        cost: null,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t2_6',
        parentId: 'turn_2',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'assistant',
        entryType: 'message',
        timestamp: '2026-10-20T21:10:18.900Z',
        role: 'assistant',
        roleLabel: 'assistant',
        model: 'deepseek-v4.1-flash-1017',
        summary: 'assistant: 已经改完，类型检查也通过了。改动：MessageInput.vue 外层卡片颜色一致，边距已修复。',
        detail: {},
        status: 'ok',
        durationMs: 2890,
        tokens: 520,
        cost: 0.00009,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      // === Turn 3 ===
      {
        id: 'turn_3',
        parentId: null,
        depth: 0,
        isBranchPoint: false,
        branchKind: 'user',
        entryType: 'message',
        timestamp: '2026-10-20T21:11:05.100Z',
        role: 'user',
        roleLabel: 'user',
        summary: 'user: 定位到磁性页面，模仿一下苹果文件夹的交互逻辑。我需要实现：1. 文件夹外的磁贴拖进去；2. 文件夹内的磁贴拖出来。',
        detail: {},
        status: 'ok',
        durationMs: null,
        tokens: null,
        cost: null,
        isLeaf: false,
        hasChildren: true,
        childrenIds: t3_children,
      },
      {
        id: 'step_t3_1',
        parentId: 'turn_3',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'thinking',
        entryType: 'message',
        timestamp: '2026-10-20T21:11:09.200Z',
        role: 'assistant',
        roleLabel: 'thinking',
        model: 'deepseek-v4.1-flash-1017',
        summary: '[thinking] 用户要求：定位到磁性页面（应该是“磁贴”页面），模仿苹果文件夹的交互逻辑。正在检索 TileBoard.vue...',
        detail: {},
        status: 'ok',
        durationMs: 1650,
        tokens: 420,
        cost: 0.00005,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t3_2',
        parentId: 'turn_3',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'tool',
        entryType: 'message',
        timestamp: '2026-10-20T21:11:12.800Z',
        role: 'toolResult',
        roleLabel: 'read',
        toolName: 'read',
        summary: '[read: src/views/main/settings/TileBoard.vue]',
        detail: {},
        status: 'ok',
        durationMs: 110,
        tokens: null,
        cost: null,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
      {
        id: 'step_t3_3',
        parentId: 'turn_3',
        depth: 1,
        isBranchPoint: true,
        branchKind: 'assistant',
        entryType: 'message',
        timestamp: '2026-10-20T21:11:18.500Z',
        role: 'assistant',
        roleLabel: 'assistant',
        model: 'deepseek-v4.1-flash-1017',
        summary: 'assistant: 正在分析磁贴拖拽事件与拖放释放动画，已构建文件夹聚合逻辑...',
        detail: {},
        status: 'ok',
        durationMs: 4120,
        tokens: 890,
        cost: 0.00015,
        isLeaf: true,
        hasChildren: false,
        childrenIds: [],
      },
    ],
  }
}
