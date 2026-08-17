import { ref, computed, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useUsageStore, type TokenDataPoint } from '@/stores/usage'
import { recomputeTps } from '@/lib/utils'

export interface AggregatedPoint {
  id: number
  time: string
  timeRange?: string
  isAggregated: boolean
  bucketCount: number
  provider: string | null
  model: string
  models?: string[]
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  tpsTotal: number
  tpsGen: number
  tps: number
  maxTpsTotal?: number
  maxTpsGen?: number
  totalCost: number
  maxCost?: number
  ttftMs: number | null
  maxTtftMs?: number | null
  durationMs: number | null
  maxDurationMs?: number | null
  httpStatus: number | null
  stopReason: string | null
  errorMessage: string | null
}

export type TrendDataPoint = TokenDataPoint | AggregatedPoint

export interface DownsampleOptions {
  /** 目标聚合点数，默认 100 */
  targetPoints?: number
  /** 触发聚合的最小数据点数阈值，低于此值直接展示原始点，默认 100 */
  minPointsToAggregate?: number
  /** 触发聚合的最小视口时间跨度（毫秒），默认 1 小时（3,600,000ms），<= 1h 直接展示真实原始点 */
  minTimeSpanToAggregateMs?: number
}

function aggregateChunk(chunk: TokenDataPoint[]): AggregatedPoint {
  if (chunk.length === 1) {
    const p = chunk[0]
    return {
      ...p,
      isAggregated: false,
      bucketCount: 1,
    }
  }

  const count = chunk.length
  const midPoint = chunk[Math.floor(count / 2)]
  const firstTime = chunk[0].time
  const lastTime = chunk[count - 1].time
  const timeRange =
    firstTime === lastTime
      ? firstTime.slice(11, 19)
      : `${firstTime.slice(11, 16)} ~ ${lastTime.slice(11, 16)}`

  let totalInput = 0
  let totalOutput = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  let totalCost = 0
  let maxCost = 0

  let sumTpsTotal = 0
  let sumTpsGen = 0
  let maxTpsTotal = 0
  let maxTpsGen = 0

  let validDurationSum = 0
  let validDurationCount = 0
  let maxDurationMs = 0

  let validTtftSum = 0
  let validTtftCount = 0
  let maxTtftMs = 0

  const modelSet = new Set<string>()

  for (let i = 0; i < count; i++) {
    const p = chunk[i]
    totalInput += p.inputTokens || 0
    totalOutput += p.outputTokens || 0
    totalCacheRead += p.cacheRead || 0
    totalCacheWrite += p.cacheWrite || 0
    totalCost += p.totalCost || 0
    if (p.totalCost > maxCost) maxCost = p.totalCost

    const tps = recomputeTps(p)
    sumTpsTotal += tps.tpsTotal
    sumTpsGen += tps.tpsGen
    if (tps.tpsTotal > maxTpsTotal) maxTpsTotal = tps.tpsTotal
    if (tps.tpsGen > maxTpsGen) maxTpsGen = tps.tpsGen

    if (p.durationMs != null && p.durationMs > 0) {
      validDurationSum += p.durationMs
      validDurationCount++
      if (p.durationMs > maxDurationMs) maxDurationMs = p.durationMs
    }

    if (p.ttftMs != null && p.ttftMs > 0) {
      validTtftSum += p.ttftMs
      validTtftCount++
      if (p.ttftMs > maxTtftMs) maxTtftMs = p.ttftMs
    }

    if (p.model) {
      modelSet.add(p.provider ? `${p.provider}/${p.model}` : p.model)
    }
  }

  const modelList = Array.from(modelSet)
  const modelText =
    modelList.length <= 1
      ? modelList[0] || 'mixed'
      : `${modelList[0]} 等 ${modelList.length} 个模型`

  const avgTpsTotal = count > 0 ? sumTpsTotal / count : 0
  const avgTpsGen = count > 0 ? sumTpsGen / count : 0
  const avgDuration = validDurationCount > 0 ? validDurationSum / validDurationCount : null
  const avgTtft = validTtftCount > 0 ? validTtftSum / validTtftCount : null

  return {
    id: midPoint.id,
    time: midPoint.time,
    timeRange,
    isAggregated: true,
    bucketCount: count,
    provider: null,
    model: modelText,
    models: modelList,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheRead: totalCacheRead,
    cacheWrite: totalCacheWrite,
    tpsTotal: +avgTpsTotal.toFixed(2),
    tpsGen: +avgTpsGen.toFixed(2),
    tps: +avgTpsGen.toFixed(2),
    maxTpsTotal: +maxTpsTotal.toFixed(2),
    maxTpsGen: +maxTpsGen.toFixed(2),
    totalCost: +totalCost.toFixed(6),
    maxCost: +maxCost.toFixed(6),
    ttftMs: avgTtft != null ? Math.round(avgTtft) : null,
    maxTtftMs: validTtftCount > 0 ? Math.round(maxTtftMs) : null,
    durationMs: avgDuration != null ? Math.round(avgDuration) : null,
    maxDurationMs: validDurationCount > 0 ? Math.round(maxDurationMs) : null,
    httpStatus: null,
    stopReason: null,
    errorMessage: null,
  }
}

export function useTrendDownsampler(
  customSeries?: Ref<TokenDataPoint[]>,
  options: DownsampleOptions = {},
) {
  const store = useUsageStore()
  const { series: storeSeries, lodEnabled, logEnabled } = storeToRefs(store)
  const source = customSeries ?? storeSeries

  const targetPoints = options.targetPoints ?? 100
  const minPointsToAggregate = options.minPointsToAggregate ?? 100
  const ONE_HOUR_MS = 60 * 60 * 1000
  const minTimeSpanToAggregateMs = options.minTimeSpanToAggregateMs ?? ONE_HOUR_MS

  const zoomStart = ref(0)
  const zoomEnd = ref(100)

  // 当外部数据重载或重置时重置 zoom 记录
  watch(
    () => source.value.length,
    () => {
      zoomStart.value = 0
      zoomEnd.value = 100
    },
  )

  function onDataZoom(evt: any) {
    let start = 0
    let end = 100
    if (evt.batch && evt.batch.length > 0) {
      start = evt.batch[0].start ?? 0
      end = evt.batch[0].end ?? 100
    } else if (evt.start != null || evt.end != null) {
      start = evt.start ?? 0
      end = evt.end ?? 100
    }
    zoomStart.value = Math.max(0, Math.min(100, start))
    zoomEnd.value = Math.max(0, Math.min(100, end))
  }

  const downsampleResult = computed(() => {
    const raw = source.value
    const totalCount = raw.length

    if (totalCount === 0) {
      return {
        points: [],
        isAggregated: false,
        totalRaw: 0,
        renderedCount: 0,
        modeText: '暂无数据',
      }
    }

    // 1. 如果时间预设本身就是 15m 或 1h，视口天然 <= 1h，直接展示真实点
    if (store.activePreset === '15m' || store.activePreset === '1h') {
      if (logEnabled.value && lodEnabled.value) {
        console.log(
          `%c[LOD Trend]%c 当前时间预设为 ${store.activePreset} (<= 1h) ➔ 保持真实原始数据点模式 (共 ${totalCount} 点)`,
          'color: #06b6d4; font-weight: bold;',
          'color: inherit;',
        )
      }
      return {
        points: raw as TrendDataPoint[],
        isAggregated: false,
        totalRaw: totalCount,
        renderedCount: totalCount,
        modeText: '原始调用点 (100%)',
      }
    }

    // 2. 计算当前视口的时间跨度 (毫秒)
    let visibleSpanMs = Infinity
    if (totalCount >= 2) {
      const firstMs = new Date(raw[0].time.replace(' ', 'T')).getTime()
      const lastMs = new Date(raw[totalCount - 1].time.replace(' ', 'T')).getTime()
      const totalSpanMs = Math.max(0, lastMs - firstMs)
      const zoomRatio = Math.max(0.001, (zoomEnd.value - zoomStart.value) / 100)
      visibleSpanMs = totalSpanMs * zoomRatio
    }

    // 3. 判断是否切换回真实原始数据点：
    // - LOD 开关关闭
    // - 数据总点数未达聚合阈值 (<= 100 点)
    // - 当前可见视口时间跨度 <= 1 小时 (<= 3600000ms)
    if (!lodEnabled.value || totalCount <= minPointsToAggregate || visibleSpanMs <= minTimeSpanToAggregateMs) {
      const reason = !lodEnabled.value
        ? 'LOD 开关关闭'
        : totalCount <= minPointsToAggregate
          ? `数据点数 (${totalCount}) <= 阈值 (${minPointsToAggregate})`
          : `视口跨度 ${(visibleSpanMs / 60000).toFixed(1)} 分钟 <= 1h 临界值`

      if (logEnabled.value && lodEnabled.value) {
        console.log(
          `%c[LOD Trend]%c 切换至真实原始点模式 [${reason}] ➔ 展示 100% 真实调用数据点 (共 ${totalCount} 点)`,
          'color: #06b6d4; font-weight: bold;',
          'color: inherit;',
        )
      }
      return {
        points: raw as TrendDataPoint[],
        isAggregated: false,
        totalRaw: totalCount,
        renderedCount: totalCount,
        modeText: '原始调用点 (100%)',
      }
    }

    const t0 = performance.now()

    // 4. 大视口 (> 1h 且 > 100 点) 全局分桶降采样
    const numBuckets = Math.min(targetPoints, totalCount)
    const step = totalCount / numBuckets
    const aggregatedList: TrendDataPoint[] = []

    for (let i = 0; i < numBuckets; i++) {
      const startIndex = Math.floor(i * step)
      const endIndex = Math.min(totalCount, Math.floor((i + 1) * step))
      const chunk = raw.slice(startIndex, endIndex)
      if (chunk.length > 0) {
        aggregatedList.push(aggregateChunk(chunk))
      }
    }

    const t1 = performance.now()
    if (logEnabled.value) {
      console.log(
        `%c[LOD Trend]%c 降采样完成: 原始 ${totalCount} 点 ➔ 聚合为 ${aggregatedList.length} 点 | 耗时 ${(t1 - t0).toFixed(2)}ms`,
        'color: #3b82f6; font-weight: bold;',
        'color: inherit;',
      )
    }

    return {
      points: aggregatedList,
      isAggregated: true,
      totalRaw: totalCount,
      renderedCount: aggregatedList.length,
      modeText: `自适应聚合 (${aggregatedList.length} 桶 / ${totalCount} 次调用)`,
    }
  })

  const renderedPoints = computed(() => downsampleResult.value.points)
  const isAggregated = computed(() => downsampleResult.value.isAggregated)
  const totalRawCount = computed(() => downsampleResult.value.totalRaw)
  const renderedCount = computed(() => downsampleResult.value.renderedCount)
  const modeText = computed(() => downsampleResult.value.modeText)

  return {
    renderedPoints,
    isAggregated,
    totalRawCount,
    renderedCount,
    modeText,
    onDataZoom,
  }
}
