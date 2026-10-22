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

    // Set of parent IDs whose descendants should be hidden
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
      } else {
        // Pure Web Dev Mode (Browser fallback mock)
        const mockWs = createMockWorkspaces()
        workspaces.value = mockWs
        if (mockWs.length > 0 && mockWs[0].sessions.length > 0) {
          activeWorkspaceId.value = mockWs[0].id
          await selectSession(mockWs[0].sessions[0])
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
      } else {
        // Pure Web Dev Mode Mock Tree
        const mockTree = createMockSessionTree(session.id)
        sessionTree.value = mockTree
        if (mockTree.nodes.length > 0) {
          activeNodeId.value = mockTree.nodes[mockTree.nodes.length - 1].id
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
      } else {
        // Pure Web Dev Mode mock live telemetry
        telemetry.value = {
          isActive: true,
          sessionId: activeSession.value?.id ?? 'mock-session-id',
          model: 'deepseek-v4.1-flash-1017',
          provider: 'a6api-deepseek',
          phase: 'text',
          currentDeltaSnippet: '...已完成磁贴组件结构定义与边界吸附逻辑处理...',
          totalChars: 1840,
          totalTokensEst: 520,
          startedAt: Date.now() - 14500,
          lastChunkAt: Date.now() - 800,
          silenceDurationMs: 800,
          activeDurationMs: 14500,
          ttftMs: 650,
          tpsCurrent: 58.4,
          healthStatus: 'healthy',
          diagnosticVerdict: '🟢 正常高速流式中。实时吞吐率 58.4 tok/s，数据流顺畅。',
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

// === Mock Data for Browser Dev Mode ===

function createMockWorkspaces(): WorkspaceItem[] {
  return [
    {
      id: '--F--lattice-archive-v2--',
      path: 'F:\\lattice-archive-v2',
      sessionCount: 12,
      lastActiveAt: Date.now() - 30_000,
      sessions: [
        {
          id: '01a15b25-5c13-742b-8a13-da55e63e07d9',
          fileName: '2026-10-20T21-08-57-491Z_01a15b25-5c13-742b-8a13-da55e63e07d9.jsonl',
          filePath: 'F:\\lattice-archive-v2\\.pi\\session.jsonl',
          cwd: 'F:\\lattice-archive-v2',
          title: '这边输入行的位置，感觉有点不和谐，你给我一个调整方案看看',
          createdAt: '2026-10-20T21:08:57.491Z',
          updatedAt: Date.now() - 30_000,
          fileSize: 142850,
          entryCount: 42,
          isLive: true,
        },
        {
          id: '01a16554-3f8d-703b-8644-d69381131bd9',
          fileName: '2026-10-22T20-36-22-542Z_01a16554-3f8d-703b-8644-d69381131bd9.jsonl',
          filePath: 'F:\\lattice-archive-v2\\.pi\\session2.jsonl',
          cwd: 'F:\\lattice-archive-v2',
          title: '排查 MessageBubble 渲染卡顿与动画异常',
          createdAt: '2026-10-22T20:36:22.542Z',
          updatedAt: Date.now() - 3600_000,
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
      lastActiveAt: Date.now() - 86400_000,
      sessions: [
        {
          id: '01a15612-66da-72a2-ad5c-82c5267739e2',
          fileName: 'session_sales.jsonl',
          filePath: 'D:\\code\\salesTrace-v2\\.pi\\session.jsonl',
          cwd: 'D:\\code\\salesTrace-v2',
          title: '重构销售机会流转看板数据聚合逻辑',
          createdAt: '2026-10-19T21:30:08.986Z',
          updatedAt: Date.now() - 86400_000,
          fileSize: 89000,
          entryCount: 35,
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
        entryType: 'model_change',
        timestamp: '2026-10-20T21:09:05.565Z',
        role: null,
        roleLabel: 'model_change',
        summary: '[model: deepseek-v4.1-flash-1017 (thinking: low)]',
        detail: { model: 'deepseek-v4.1-flash-1017' },
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
        entryType: 'message',
        timestamp: '2026-10-20T21:09:29.480Z',
        role: 'user',
        roleLabel: 'user',
        summary: 'user: 这边输入行的位置，感觉有点不和谐，你给我一个调整方案看看',
        detail: { content: '这边输入行的位置，感觉有点不和谐，你给我一个调整方案看看' },
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
        entryType: 'message',
        timestamp: '2026-10-20T21:09:35.120Z',
        role: 'assistant',
        roleLabel: 'thinking',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:09:37.400Z',
        role: 'toolResult',
        roleLabel: 'bash',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:09:40.150Z',
        role: 'toolResult',
        roleLabel: 'read',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:09:43.200Z',
        role: 'toolResult',
        roleLabel: 'read',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:09:48.800Z',
        role: 'assistant',
        roleLabel: 'assistant',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:10:05.300Z',
        role: 'assistant',
        roleLabel: 'thinking',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:10:08.500Z',
        role: 'toolResult',
        roleLabel: 'edit',
        summary: '[edit: src/views/main/chats/conversation/MessageInput.vue 替换 1 个区块]',
        detail: {},
        status: 'ok',
        durationMs: 82,
        tokens: null,
        cost: null,
        isLeaf: false,
        hasChildren: true,
        childrenIds: ['step_t2_3'],
      },
      {
        id: 'step_t2_3',
        parentId: 'step_t2_2',
        depth: 2,
        isBranchPoint: true,
        entryType: 'message',
        timestamp: '2026-10-20T21:10:08.520Z',
        role: 'toolResult',
        roleLabel: 'result',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:10:10.800Z',
        role: 'toolResult',
        roleLabel: 'edit',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:10:14.200Z',
        role: 'toolResult',
        roleLabel: 'bash',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:10:18.900Z',
        role: 'assistant',
        roleLabel: 'assistant',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:11:09.200Z',
        role: 'assistant',
        roleLabel: 'thinking',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:11:12.800Z',
        role: 'toolResult',
        roleLabel: 'read',
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
        entryType: 'message',
        timestamp: '2026-10-20T21:11:18.500Z',
        role: 'assistant',
        roleLabel: 'assistant',
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
