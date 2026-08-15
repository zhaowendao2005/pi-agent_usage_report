import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { formatDatetime } from '@/lib/utils'

export interface TokenDataPoint {
  time: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  tpsTotal: number
  tpsGen: number
  /** @deprecated use tpsGen; kept for chart compatibility */
  tps: number
  totalCost: number
  ttftMs: number | null
  durationMs: number | null
}

export interface ModelUsage {
  model: string
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cost: number
}

export interface SummaryStats {
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheWrite: number
  cacheHitRate: number
  totalCost: number
  requestCount: number
  avgLatency: number
}

/** Persisted UI options → ~/.pi/agent/usage_config.yaml */
export interface UsageUiConfig {
  time_preset: string
  end_is_live: boolean
  refresh_interval: number
  is_live: boolean
  start_time?: string | null
  end_time?: string | null
}

const DEFAULT_CONFIG: UsageUiConfig = {
  time_preset: '24h',
  end_is_live: true,
  refresh_interval: 30,
  is_live: true,
  start_time: null,
  end_time: null,
}

// Empty = same-origin HTTP (legacy bun server / vite proxy)
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? ''

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

function normalizePoint(raw: any): TokenDataPoint {
  const tpsTotal = Number(raw.tpsTotal ?? raw.tps_total ?? 0) || 0
  const tpsGen = Number(raw.tpsGen ?? raw.tps_gen ?? raw.tps ?? 0) || 0
  return {
    time: String(raw.time ?? ''),
    model: String(raw.model ?? 'unknown'),
    inputTokens: Number(raw.inputTokens ?? raw.input_tokens ?? 0) || 0,
    outputTokens: Number(raw.outputTokens ?? raw.output_tokens ?? 0) || 0,
    cacheRead: Number(raw.cacheRead ?? raw.cache_read ?? 0) || 0,
    cacheWrite: Number(raw.cacheWrite ?? raw.cache_write ?? 0) || 0,
    tpsTotal,
    tpsGen,
    tps: tpsGen || tpsTotal,
    totalCost: Number(raw.totalCost ?? raw.total_cost ?? 0) || 0,
    ttftMs: raw.ttftMs == null && raw.ttft_ms == null ? null : Number(raw.ttftMs ?? raw.ttft_ms),
    durationMs:
      raw.durationMs == null && raw.duration_ms == null
        ? null
        : Number(raw.durationMs ?? raw.duration_ms),
  }
}

function normalizeModel(m: any): ModelUsage {
  return {
    model: String(m.model ?? 'unknown'),
    inputTokens: Number(m.inputTokens ?? m.input_tokens ?? 0) || 0,
    outputTokens: Number(m.outputTokens ?? m.output_tokens ?? 0) || 0,
    cacheRead: Number(m.cacheRead ?? m.cache_read ?? 0) || 0,
    cost: Number(m.cost ?? 0) || 0,
  }
}

function computePresetStart(preset: string, end: Date): Date {
  switch (preset) {
    case '15m':
      return new Date(end.getTime() - 15 * 60 * 1000)
    case '1h':
      return new Date(end.getTime() - 60 * 60 * 1000)
    case '6h':
      return new Date(end.getTime() - 6 * 60 * 60 * 1000)
    case '24h':
    case '1d':
      return new Date(end.getTime() - 24 * 60 * 60 * 1000)
    case '7d':
      return new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
    case '14d':
      return new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000)
    case '30d':
      return new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
    case 'today': {
      const start = new Date(end)
      start.setHours(0, 0, 0, 0)
      return start
    }
    default:
      return new Date(end.getTime() - 24 * 60 * 60 * 1000)
  }
}

export const useUsageStore = defineStore('usage', () => {
  const now = new Date()
  const defaultEnd = new Date(now)
  const defaultStart = computePresetStart('24h', defaultEnd)

  const startTime = ref(formatDatetime(defaultStart))
  const endTime = ref(formatDatetime(defaultEnd))
  /** 结束时间跟随当前时刻（起点固定，终点=now） */
  const endIsLive = ref(true)
  const refreshInterval = ref(DEFAULT_CONFIG.refresh_interval)
  const isLive = ref(DEFAULT_CONFIG.is_live)
  const activePreset = ref(DEFAULT_CONFIG.time_preset)
  const loading = ref(false)
  const lastError = ref<string | null>(null)
  const ready = ref(false)

  const series = ref<TokenDataPoint[]>([])
  const modelUsage = ref<ModelUsage[]>([])
  const serverAvgLatency = ref(0)
  const serverCallCount = ref(0)

  let liveTimer: ReturnType<typeof setInterval> | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let skipPersist = false

  const summary = computed<SummaryStats>(() => {
    const s = series.value
    const totalInput = s.reduce((a, b) => a + b.inputTokens, 0)
    const totalOutput = s.reduce((a, b) => a + b.outputTokens, 0)
    const totalCacheRead = s.reduce((a, b) => a + b.cacheRead, 0)
    const totalCacheWrite = s.reduce((a, b) => a + b.cacheWrite, 0)
    const totalCost = +s.reduce((a, b) => a + b.totalCost, 0).toFixed(6)
    const cacheHitRate =
      totalInput + totalCacheRead > 0
        ? +((totalCacheRead / (totalInput + totalCacheRead)) * 100).toFixed(1)
        : 0
    return {
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheWrite,
      cacheHitRate,
      totalCost,
      requestCount: serverCallCount.value || s.length,
      avgLatency: serverAvgLatency.value || 0,
    }
  })

  const apiBase = computed(() => (isTauri() ? 'tauri://invoke' : API_BASE || '/'))

  function rangeArgs() {
    return { start: startTime.value, end: endTime.value }
  }

  function buildConfig(): UsageUiConfig {
    return {
      time_preset: activePreset.value || '',
      end_is_live: endIsLive.value,
      refresh_interval: refreshInterval.value,
      is_live: isLive.value,
      start_time: activePreset.value ? null : startTime.value,
      end_time: activePreset.value || endIsLive.value ? null : endTime.value,
    }
  }

  async function persistConfig() {
    if (!ready.value || skipPersist) return
    const cfg = buildConfig()
    try {
      if (isTauri()) {
        await tauriInvoke('save_usage_config', { config: cfg })
      } else {
        localStorage.setItem('usage_config', JSON.stringify(cfg))
      }
    } catch (err) {
      console.warn('[usage] persist config failed:', err)
    }
  }

  function schedulePersist() {
    if (!ready.value || skipPersist) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      void persistConfig()
    }, 250)
  }

  async function loadConfig(): Promise<UsageUiConfig> {
    try {
      if (isTauri()) {
        const cfg = await tauriInvoke<UsageUiConfig>('get_usage_config')
        return { ...DEFAULT_CONFIG, ...cfg }
      }
      const raw = localStorage.getItem('usage_config')
      if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    } catch (err) {
      console.warn('[usage] load config failed, using defaults:', err)
    }
    return { ...DEFAULT_CONFIG }
  }

  /** 若结束时间跟随实时，刷新前把 end 推到 now（start 保持不动） */
  function applyEndLiveIfNeeded() {
    if (!endIsLive.value) return
    endTime.value = formatDatetime(new Date())
  }

  async function refreshData() {
    loading.value = true
    lastError.value = null
    applyEndLiveIfNeeded()
    const args = rangeArgs()
    try {
      let seriesJson: any
      let modelsJson: any
      let summaryJson: any

      if (isTauri()) {
        ;[seriesJson, modelsJson, summaryJson] = await Promise.all([
          tauriInvoke('get_series', args),
          tauriInvoke('get_models', args),
          tauriInvoke('get_summary', args),
        ])
      } else {
        const qs = new URLSearchParams({ start: args.start, end: args.end }).toString()
        const [seriesRes, modelsRes, summaryRes] = await Promise.all([
          fetch(`${API_BASE}/api/series?${qs}`),
          fetch(`${API_BASE}/api/models?${qs}`),
          fetch(`${API_BASE}/api/summary?${qs}`),
        ])
        if (!seriesRes.ok) throw new Error(`series ${seriesRes.status}`)
        if (!modelsRes.ok) throw new Error(`models ${modelsRes.status}`)
        if (!summaryRes.ok) throw new Error(`summary ${summaryRes.status}`)
        seriesJson = await seriesRes.json()
        modelsJson = await modelsRes.json()
        summaryJson = await summaryRes.json()
      }

      series.value = Array.isArray(seriesJson) ? seriesJson.map(normalizePoint) : []
      modelUsage.value = Array.isArray(modelsJson) ? modelsJson.map(normalizeModel) : []
      serverAvgLatency.value = Number(summaryJson?.avgLatency ?? summaryJson?.avg_latency ?? 0) || 0
      serverCallCount.value = Number(summaryJson?.callCount ?? summaryJson?.call_count ?? 0) || 0
    } catch (err) {
      lastError.value = String(err)
      console.error('[usage] refresh failed:', err)
    } finally {
      loading.value = false
    }
  }

  function clearLiveTimer() {
    if (liveTimer) {
      clearInterval(liveTimer)
      liveTimer = null
    }
  }

  function startLiveTimer() {
    clearLiveTimer()
    liveTimer = setInterval(() => {
      const end = new Date()
      if (endIsLive.value) {
        endTime.value = formatDatetime(end)
      } else {
        const start = new Date(startTime.value.replace(' ', 'T'))
        const endOld = new Date(endTime.value.replace(' ', 'T'))
        let windowMs = 24 * 60 * 60 * 1000
        if (!isNaN(start.getTime()) && !isNaN(endOld.getTime()) && endOld > start) {
          windowMs = endOld.getTime() - start.getTime()
        }
        endTime.value = formatDatetime(end)
        startTime.value = formatDatetime(new Date(end.getTime() - windowMs))
      }
      void refreshData()
    }, refreshInterval.value * 1000)
  }

  function setEndIsLive(val: boolean) {
    endIsLive.value = val
    if (val) {
      endTime.value = formatDatetime(new Date())
      void refreshData()
    }
    schedulePersist()
  }

  function setTimeRange(start: Date | string, end: Date | string, opts?: { endLive?: boolean; preset?: string }) {
    const s = typeof start === 'string' ? start : formatDatetime(start)
    const e = typeof end === 'string' ? end : formatDatetime(end)
    startTime.value = s
    endTime.value = e
    if (opts && typeof opts.endLive === 'boolean') {
      endIsLive.value = opts.endLive
    }
    if (opts && typeof opts.preset === 'string') {
      activePreset.value = opts.preset
    } else {
      activePreset.value = ''
    }
    void refreshData()
    schedulePersist()
  }

  function setLive(val: boolean) {
    isLive.value = val
    clearLiveTimer()
    if (val) {
      startLiveTimer()
      void refreshData()
    }
    schedulePersist()
  }

  function setRefreshInterval(seconds: number) {
    const sec = Math.max(1, Math.floor(seconds))
    refreshInterval.value = sec
    if (isLive.value) {
      startLiveTimer()
    }
    schedulePersist()
  }

  function applyTimePreset(preset: string) {
    const end = new Date()
    const start = computePresetStart(preset, end)
    activePreset.value = preset
    endIsLive.value = true
    endTime.value = formatDatetime(end)
    startTime.value = formatDatetime(start)
    void refreshData()
    schedulePersist()
  }

  async function init() {
    skipPersist = true
    const cfg = await loadConfig()
    const end = new Date()
    refreshInterval.value = Math.max(1, Number(cfg.refresh_interval) || DEFAULT_CONFIG.refresh_interval)
    endIsLive.value = cfg.end_is_live !== false
    activePreset.value = cfg.time_preset || DEFAULT_CONFIG.time_preset

    if (cfg.time_preset) {
      const start = computePresetStart(cfg.time_preset, end)
      startTime.value = formatDatetime(start)
      endTime.value = formatDatetime(end)
      endIsLive.value = true
    } else if (cfg.start_time) {
      startTime.value = cfg.start_time
      endTime.value = cfg.end_time || formatDatetime(end)
      activePreset.value = ''
    } else {
      applyTimePreset('24h')
    }

    ready.value = true
    skipPersist = false

    await refreshData()
    if (cfg.is_live !== false) {
      setLive(true)
    } else {
      isLive.value = false
    }
  }

  return {
    startTime,
    endTime,
    endIsLive,
    refreshInterval,
    isLive,
    activePreset,
    loading,
    lastError,
    ready,
    series,
    modelUsage,
    summary,
    apiBase,
    refreshData,
    setEndIsLive,
    setTimeRange,
    setLive,
    setRefreshInterval,
    applyTimePreset,
    init,
    persistConfig,
  }
})
