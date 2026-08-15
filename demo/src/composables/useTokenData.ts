import { ref, computed, readonly } from 'vue'
import { formatDatetime } from '@/lib/utils'

export interface TokenDataPoint {
  time: string
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  tps: number
  totalCost: number
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

function generateSeries(start: Date, end: Date, points = 60): TokenDataPoint[] {
  const data: TokenDataPoint[] = []
  const step = (end.getTime() - start.getTime()) / points
  const stepSeconds = Math.max(1, step / 1000)
  let base = 4000
  for (let i = 0; i <= points; i++) {
    const t = new Date(start.getTime() + step * i)
    // simulate some spikes and patterns
    const hour = t.getHours()
    const activityMul = hour >= 9 && hour <= 22 ? 1 + Math.sin((hour - 9) * 0.3) * 0.6 : 0.3
    const noise = () => (Math.random() - 0.5) * 0.4
    base = Math.max(500, base * (1 + noise() * 0.15))
    const input = Math.round(base * activityMul * (1 + noise()))
    const output = Math.round(input * (0.3 + Math.random() * 0.2))
    const cacheWrite = Math.round(input * 0.6)
    const cacheRead = Math.round(input * (0.4 + Math.random() * 0.3))
    const tps = Math.round(((input + output) / stepSeconds) * (0.8 + Math.random() * 0.4))
    const totalCost = +(input * 0.000003 + output * 0.000015 + cacheRead * 0.0000003).toFixed(6)
    data.push({
      time: formatDatetime(t),
      inputTokens: input,
      outputTokens: output,
      cacheRead,
      cacheWrite,
      tps,
      totalCost,
    })
  }
  return data
}

const MODELS = ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-3-5', 'gpt-4o', 'deepseek-v3']

function generateModelUsage(): ModelUsage[] {
  return MODELS.map((model) => {
    const input = Math.round(Math.random() * 800000 + 50000)
    const output = Math.round(input * (0.2 + Math.random() * 0.3))
    const cacheRead = Math.round(input * (0.3 + Math.random() * 0.4))
    const cost = +(input * 0.000003 + output * 0.000015 + cacheRead * 0.0000003).toFixed(4)
    return { model, inputTokens: input, outputTokens: output, cacheRead, cost }
  })
}

// ---- state ----
const now = new Date()
const defaultEnd = new Date(now)
const defaultStart = new Date(now.getTime() - 6 * 60 * 60 * 1000)

export const startTime = ref(formatDatetime(defaultStart))
export const endTime = ref(formatDatetime(defaultEnd))
export const refreshInterval = ref(30) // seconds
export const isLive = ref(false)

export const series = ref<TokenDataPoint[]>(generateSeries(defaultStart, defaultEnd))
export const modelUsage = ref<ModelUsage[]>(generateModelUsage())

export const summary = computed<SummaryStats>(() => {
  const s = series.value
  const totalInput = s.reduce((a, b) => a + b.inputTokens, 0)
  const totalOutput = s.reduce((a, b) => a + b.outputTokens, 0)
  const totalCacheRead = s.reduce((a, b) => a + b.cacheRead, 0)
  const totalCacheWrite = s.reduce((a, b) => a + b.cacheWrite, 0)
  const totalCost = +s.reduce((a, b) => a + b.totalCost, 0).toFixed(4)
  const cacheHitRate = totalInput > 0 ? +((totalCacheRead / (totalInput + totalCacheRead)) * 100).toFixed(1) : 0
  return {
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheWrite,
    cacheHitRate,
    totalCost,
    requestCount: s.length,
    avgLatency: +(800 + Math.random() * 400).toFixed(0),
  }
})

let liveTimer: ReturnType<typeof setInterval> | null = null

export function refreshData() {
  const start = new Date(startTime.value.replace(' ', 'T'))
  const end = new Date(endTime.value.replace(' ', 'T'))
  if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
    series.value = generateSeries(start, end)
    modelUsage.value = generateModelUsage()
  }
}

export function setLive(val: boolean) {
  isLive.value = val
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null }
  if (val) {
    liveTimer = setInterval(() => {
      const end = new Date()
      const start = new Date(end.getTime() - 6 * 60 * 60 * 1000)
      endTime.value = formatDatetime(end)
      startTime.value = formatDatetime(start)
      refreshData()
    }, refreshInterval.value * 1000)
  }
}

export function setRefreshInterval(seconds: number) {
  refreshInterval.value = seconds
  if (isLive.value) { setLive(false); setLive(true) }
}

export function applyTimePreset(preset: string) {
  const end = new Date()
  let start: Date
  switch (preset) {
    case '15m': start = new Date(end.getTime() - 15 * 60 * 1000); break
    case '1h':  start = new Date(end.getTime() - 60 * 60 * 1000); break
    case '6h':  start = new Date(end.getTime() - 6 * 60 * 60 * 1000); break
    case '24h': start = new Date(end.getTime() - 24 * 60 * 60 * 1000); break
    case '7d':  start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000); break
    default:    start = new Date(end.getTime() - 60 * 60 * 1000)
  }
  endTime.value = formatDatetime(end)
  startTime.value = formatDatetime(start)
  refreshData()
}
