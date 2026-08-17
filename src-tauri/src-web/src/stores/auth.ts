import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface AuthConfig {
  relayUrl: string
  edgeAuthEnabled: boolean
  authStatus: string
  bridgePort: number | null
  lastCheckedMs: number | null
  message: string
}

export interface AuthStatus {
  enabled: boolean
  status: string
  relayUrl: string
  bridgePort: number | null
  bridgeRunning: boolean
  message: string
  lastCheckedMs: number | null
}

export const AUTH_STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  off:          { label: '未启用',   color: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  disconnected: { label: '未连接',   color: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
  connected:    { label: '已连接',   color: 'text-blue-600 dark:text-blue-400',   dot: 'bg-blue-500' },
  logged_in:    { label: '已登录',   color: 'text-green-600 dark:text-green-400', dot: 'bg-green-500' },
}

export const useAuthStore = defineStore('auth', () => {
  const relayUrl = ref('')
  const edgeAuthEnabled = ref(false)
  const authStatus = ref('off')
  const bridgePort = ref<number | null>(null)
  const bridgeRunning = ref(false)
  const lastCheckedMs = ref<number | null>(null)
  const message = ref('')
  const loading = ref(false)
  const initialized = ref(false)

  async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(cmd, args)
  }

  function payload(): AuthConfig {
    return {
      relayUrl: relayUrl.value,
      edgeAuthEnabled: edgeAuthEnabled.value,
      authStatus: authStatus.value,
      bridgePort: bridgePort.value,
      lastCheckedMs: lastCheckedMs.value,
      message: message.value,
    }
  }

  function applyStatus(s: AuthStatus) {
    edgeAuthEnabled.value = s.enabled
    authStatus.value = s.status
    relayUrl.value = s.relayUrl ?? relayUrl.value
    bridgePort.value = s.bridgePort ?? null
    bridgeRunning.value = s.bridgeRunning
    lastCheckedMs.value = s.lastCheckedMs ?? null
    message.value = s.message ?? ''
  }

  async function load() {
    loading.value = true
    try {
      const cfg = await invoke<AuthConfig>('get_auth_config')
      relayUrl.value = cfg.relayUrl
      edgeAuthEnabled.value = cfg.edgeAuthEnabled
      authStatus.value = cfg.authStatus
      bridgePort.value = cfg.bridgePort
      lastCheckedMs.value = cfg.lastCheckedMs
      message.value = cfg.message
      initialized.value = true
    } finally {
      loading.value = false
    }
  }

  /** 保存中转站地址（手动） */
  async function saveRelayUrl(url: string) {
    relayUrl.value = url.trim()
    const s = await invoke<AuthStatus>('save_auth_config', { config: payload() })
    applyStatus(s)
  }

  /** 鉴权状态开关：必须手动控制 */
  async function setEnabled(v: boolean) {
    edgeAuthEnabled.value = v
    if (!v) {
      authStatus.value = 'off'
      message.value = '已手动关闭 Edge 登录态'
    } else if (authStatus.value === 'off') {
      authStatus.value = 'disconnected'
      message.value = '已启用，等待连接 Edge'
    }
    const s = await invoke<AuthStatus>('save_auth_config', { config: payload() })
    applyStatus(s)
  }

  /** 手动操作：连接 / 标记已登录 / 断开，并刷新状态 */
  async function connect() {
    await invoke<AuthStatus>('update_auth_status', {
      status: 'connected',
      message: '已连接 Edge 调试通道（EdgeBridge 就绪后为真实连接）',
    })
    await refreshStatus()
  }

  async function markLoggedIn() {
    await invoke<AuthStatus>('update_auth_status', {
      status: 'logged_in',
      message: '已使用 Edge 登录态访问中转站',
    })
    await refreshStatus()
  }

  async function disconnect() {
    await invoke<AuthStatus>('update_auth_status', {
      status: 'disconnected',
      message: '已手动断开 Edge 调试通道',
    })
    await refreshStatus()
  }

  async function refreshStatus() {
    const s = await invoke<AuthStatus>('get_auth_status')
    applyStatus(s)
  }

  return {
    relayUrl,
    edgeAuthEnabled,
    authStatus,
    bridgePort,
    bridgeRunning,
    lastCheckedMs,
    message,
    loading,
    initialized,
    load,
    saveRelayUrl,
    setEnabled,
    connect,
    markLoggedIn,
    disconnect,
    refreshStatus,
  }
})