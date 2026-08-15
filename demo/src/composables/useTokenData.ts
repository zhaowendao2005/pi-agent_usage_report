import { ref, computed, readonly } from 'vue'
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

// Empty = same-origin HTTP (legacy bun server / vite proxy)
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? ''

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

// ---- state ----
const now = new Date()
const defaultEnd = new Date(now)
const defaultStart = new Date(now.getTime() - 6 * 60 * 60 * 1000)

export const startTime = ref(formatDatetime(defaultStart))
export const endTime = ref(formatDatetime(defaultEnd))
export const refreshInterval = ref(30) // seconds
export const isLive = ref(false)
export const loading = ref(false)
export const lastError = ref<string | null>(null)

export const series = ref<TokenDataPoint[]>([])
export const modelUsage = ref<ModelUsage[]>([])
export const serverAvgLatency = ref(0)
export const serverCallCount = ref(0)

export const summary = computed<SummaryStats>(() => {
  const s = series.value
  const totalInput = s.reduce((a, b) => a + b.inputTokens, 0)
  const totalOutput = s.reduce((a, b) => a + b.outputTokens, 0)
  const totalCacheRead = s.reduce((a, b) => a + b.cacheRead, 0)
  const totalCacheWrite = s.reduce((a, b) => a + b.cacheWrite, 0)
  const totalCost = +s.reduce((a, b) => a + b.totalCost, 0).toFixed(6)
  // demo 口径: cacheRead / (input + cacheRead)
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

function rangeArgs() {
  return { start: startTime.value, end: endTime.value }
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

export async function refreshData() {
  loading.value = true
  lastError.value = null
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

let liveTimer: ReturnType<typeof setInterval> | null = null

export function setLive(val: boolean) {
  isLive.value = val
  if (liveTimer) {
    clearInterval(liveTimer)
    liveTimer = null
  }
  if (val) {
    liveTimer = setInterval(() => {
      const end = new Date()
      const start = new Date(startTime.value.replace(' ', 'T'))
      const endOld = new Date(endTime.value.replace(' ', 'T'))
      let windowMs = 6 * 60 * 60 * 1000
      if (!isNaN(start.getTime()) && !isNaN(endOld.getTime()) && endOld > start) {
        windowMs = endOld.getTime() - start.getTime()
      }
      endTime.value = formatDatetime(end)
      startTime.value = formatDatetime(new Date(end.getTime() - windowMs))
      void refreshData()
    }, refreshInterval.value * 1000)
    void refreshData()
  }
}

export function setRefreshInterval(seconds: number) {
  refreshInterval.value = seconds
  if (isLive.value) {
    setLive(false)
    setLive(true)
  }
}

export function applyTimePreset(preset: string) {
  const end = new Date()
  let start: Date
  switch (preset) {
    case '15m':
      start = new Date(end.getTime() - 15 * 60 * 1000)
      break
    case '1h':
      start = new Date(end.getTime() - 60 * 60 * 1000)
      break
    case '6h':
      start = new Date(end.getTime() - 6 * 60 * 60 * 1000)
      break
    case '24h':
      start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
      break
    case '7d':
      start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    default:
      start = new Date(end.getTime() - 60 * 60 * 1000)
  }
  endTime.value = formatDatetime(end)
  startTime.value = formatDatetime(start)
  void refreshData()
}

// Initial load
void refreshData()

export const apiBase = readonly(ref(isTauri() ? 'tauri://invoke' : API_BASE || '/'))
