import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

/** Token 计费/用量展示：优先用 M（百万 token） */
export function formatTokensM(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(digits).replace(/\.?0+$/, '') + 'M'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K'
  return String(Math.round(n))
}

/** 图表轴：Token 用 M/K */
export function formatTokenAxis(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 2) + 'M'
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1) + 'K'
  return String(v)
}

export function fmtSec(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const s = ms / 1000
  if (s < 10) return s.toFixed(2) + 's'
  if (s < 100) return s.toFixed(1) + 's'
  return Math.round(s) + 's'
}

/**
 * 官方标准模型价格字典（单位：美元 / 1M Tokens）
 * 当上游 API (如 OAuth / 免计费订阅) 返回 cost = 0 时，用于估算等效市场费用
 */
export function estimateCostMicroUsd(
  _provider: string | null,
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
): number {
  const m = (model || '').toLowerCase()
  let inP = 1.0, outP = 3.0, crP = 0.25, cwP = 1.25

  if (m.includes('haiku')) {
    inP = 0.8; outP = 4.0; crP = 0.08; cwP = 1.0
  } else if (m.includes('opus')) {
    inP = 15.0; outP = 75.0; crP = 1.5; cwP = 18.75
  } else if (m.includes('sonnet') || m.includes('claude')) {
    inP = 3.0; outP = 15.0; crP = 0.3; cwP = 3.75
  } else if (m.includes('flash') || m.includes('gemini')) {
    inP = 0.10; outP = 0.40; crP = 0.025; cwP = 0.10
  } else if (m.includes('gpt-4o-mini') || m.includes('mini')) {
    inP = 0.15; outP = 0.60; crP = 0.075; cwP = 0.15
  } else if (m.includes('gpt-4o') || m.includes('gpt-5') || m.includes('codex') || m.includes('sol') || m.includes('terra')) {
    inP = 2.50; outP = 10.0; crP = 1.25; cwP = 2.50
  } else if (m.includes('deepseek')) {
    inP = 0.14; outP = 0.28; crP = 0.014; cwP = 0.14
  } else if (m.includes('grok')) {
    inP = 2.00; outP = 10.0; crP = 0.50; cwP = 2.00
  }

  const usd = (input * inP + output * outP + cacheRead * crP + cacheWrite * cwP) / 1_000_000
  return Math.round(usd * 1_000_000)
}

/**
 * 前端重算 TPS（采用 RMT-TPS 鲁棒单点计算模型）
 * 仅 output；含首字用全程 duration；纯生成剔除 TTFT。
 * 加设 150ms / 3 token 门控与 [0.1, 800] 物理截断，防止除零与极小时间分母爆炸。
 */
export function recomputeTps(point: {
  outputTokens: number
  durationMs: number | null
  ttftMs: number | null
  tpsTotal?: number
  tpsGen?: number
  tps?: number
}): { tpsTotal: number; tpsGen: number } {
  const out = point.outputTokens || 0
  let dur = point.durationMs
  let ttft = point.ttftMs

  // 防御性耗时修复：极小耗时反推物理合理值
  if (dur != null && dur < 100 && out > 0) {
    dur = Math.max(200, Math.round((out / 45) * 1000))
  }
  if (dur != null && dur > 300 && (ttft == null || ttft <= 0)) {
    ttft = Math.round(dur * 0.3)
  }

  if (dur != null && dur > 0 && out > 0) {
    const rawTotal = out / (dur / 1000)
    const tpsTotal = Math.min(Math.max(rawTotal, 0.1), 800)

    const genMs = Math.max(1, dur - (ttft ?? 0))
    let tpsGen: number
    if (genMs < 150 || out < 3) {
      tpsGen = dur < 150 ? tpsTotal : Math.min(out / (dur / 1000), 800)
    } else {
      const rawGen = out / (genMs / 1000)
      tpsGen = Math.min(Math.max(rawGen, 0.1), 800)
    }
    return { tpsTotal, tpsGen }
  }
  const fallbackTotal = point.tpsTotal ?? point.tps ?? 0
  const fallbackGen = point.tpsGen ?? point.tps ?? 0
  return {
    tpsTotal: fallbackTotal > 0 ? Math.min(Math.max(fallbackTotal, 0.1), 800) : 0,
    tpsGen: fallbackGen > 0 ? Math.min(Math.max(fallbackGen, 0.1), 800) : 0,
  }
}

/**
 * 分位数计算函数（线性插值法）
 */
export function quantile(arr: number[], q: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * Math.max(0, Math.min(1, q))
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  }
  return sorted[base]
}

/**
 * 鲁棒雷达图维度打分模型
 * @param values 各模型的维度原始值
 * @param calls 各模型的样本量（用于贝叶斯收缩）
 * @param good 方向：'high' 为越大越好，'low' 为越小越好
 * @param options 配置：priorWeightK (贝叶斯先验权重), minScore (最低分, 默认 20), maxScore (最高分, 默认 95)
 */
export function computeRobustRadarScores(
  values: number[],
  calls: number[],
  good: 'high' | 'low',
  options: { priorWeightK?: number; minScore?: number; maxScore?: number } = {},
): number[] {
  const n = values.length
  if (n === 0) return []
  const { priorWeightK = 4, minScore = 20, maxScore = 95 } = options

  // 1. 过滤有效值并计算基准（加权均值）
  const validIndices = values.map((v, i) => (v > 0 ? i : -1)).filter(i => i >= 0)
  if (validIndices.length === 0) {
    return values.map(() => 50)
  }

  const validVals = validIndices.map(i => values[i])
  const totalCalls = validIndices.reduce((acc, i) => acc + (calls[i] || 1), 0)
  const priorMean =
    totalCalls > 0
      ? validIndices.reduce((acc, i) => acc + values[i] * (calls[i] || 1), 0) / totalCalls
      : quantile(validVals, 0.5)

  // 2. 贝叶斯收缩：对低样本量模型向全局基准平滑靠拢
  const shrunkValues = values.map((v, i) => {
    if (v <= 0) return 0
    const callCount = calls[i] || 1
    const k = priorWeightK
    return (callCount * v + k * priorMean) / (callCount + k)
  })

  const validShrunkVals = shrunkValues.filter(v => v > 0)
  if (validShrunkVals.length === 0) return values.map(() => 50)

  // 3. 计算鲁棒参考边界（5% ~ 95% Winsorized 分位数）
  let qLow = quantile(validShrunkVals, validShrunkVals.length > 3 ? 0.05 : 0)
  let qHigh = quantile(validShrunkVals, validShrunkVals.length > 3 ? 0.95 : 1)

  if (qHigh <= qLow) {
    qHigh = Math.max(...validShrunkVals)
    qLow = Math.min(...validShrunkVals)
  }

  if (qHigh === qLow) {
    return values.map(v => (v <= 0 ? 50 : 70))
  }

  // 4. 映射到 [minScore, maxScore] 打分空间
  const scoreSpan = maxScore - minScore
  return values.map((v, i) => {
    if (v <= 0) return minScore
    const shrunk = shrunkValues[i]
    const clamped = Math.max(qLow, Math.min(qHigh, shrunk))
    const ratio = (clamped - qLow) / (qHigh - qLow)
    const normalized = good === 'high' ? ratio : 1 - ratio
    return Math.round(minScore + normalized * scoreSpan)
  })
}

export type TrendTooltipMode = 'all' | 'local'

/** 趋势图悬浮：全部指标（支持单次原始调用与聚合桶统计） */
export function buildFullPointTooltip(
  point: {
    time?: string
    timeRange?: string
    isAggregated?: boolean
    bucketCount?: number
    provider: string | null
    model: string
    models?: string[]
    inputTokens: number
    outputTokens: number
    cacheRead: number
    cacheWrite: number
    ttftMs: number | null
    maxTtftMs?: number | null
    durationMs: number | null
    maxDurationMs?: number | null
    totalCost: number
    maxCost?: number
    maxTpsTotal?: number
    maxTpsGen?: number
  },
  axisValue: string,
): string {
  const isAgg = !!point.isAggregated && (point.bucketCount ?? 0) > 1
  const count = point.bucketCount ?? 1

  if (isAgg) {
    const timeBadge = point.timeRange || axisValue
    const modelBadge = `<div style="color:#3b82f6;font-weight:600;font-size:11px;margin-bottom:4px;padding:2px 6px;background:rgba(59,130,246,0.1);border-radius:4px;display:inline-block">📦 聚合 ${count} 次调用 · ${point.model}</div>`
    const head = `<div style="color:#64748b;margin-bottom:6px;font-size:11px">时段：${timeBadge}</div>`

    const items: { name: string; color: string; value: string }[] = [
      { name: '输入 Token (合计)', color: '#3b82f6', value: formatTokensM(point.inputTokens) },
      { name: '输出 Token (合计)', color: '#a855f7', value: formatTokensM(point.outputTokens) },
      { name: '缓存读取 (合计)', color: '#22c55e', value: formatTokensM(point.cacheRead) },
      { name: '缓存写入 (合计)', color: '#f59e0b', value: formatTokensM(point.cacheWrite) },
      {
        name: 'TPS(平均/峰值)',
        color: '#06b6d4',
        value: `${(point as any).tpsTotal ?? '—'} / ${point.maxTpsTotal ?? '—'}`,
      },
      {
        name: '首字延迟(均/峰)',
        color: '#8b5cf6',
        value: `${fmtSec(point.ttftMs)} / ${fmtSec(point.maxTtftMs)}`,
      },
      {
        name: '总耗时(均/峰)',
        color: '#ec4899',
        value: `${fmtSec(point.durationMs)} / ${fmtSec(point.maxDurationMs)}`,
      },
      {
        name: '费用 (合计/单次最高)',
        color: '#ef4444',
        value: `$${point.totalCost.toFixed(4)} / $${(point.maxCost ?? point.totalCost).toFixed(4)}`,
      },
    ]

    const rows = items
      .map(
        i =>
          `<div style="display:flex;justify-content:space-between;gap:18px">
            <span style="color:${i.color}">● ${i.name}</span>
            <span style="font-weight:600">${i.value}</span>
          </div>`,
      )
      .join('')

    const tip = `<div style="margin-top:6px;padding-top:4px;border-top:1px dashed rgba(0,0,0,0.08);color:#94a3b8;font-size:10px">🔍 滚轮放大视口可自动查看单次原始调用</div>`
    return modelBadge + head + rows + tip
  }

  const modelText = point.provider ? `${point.provider}/${point.model}` : point.model
  const { tpsTotal, tpsGen } = recomputeTps(point as any)
  const modelLine = `<div style="color:#3b82f6;font-weight:600;font-size:11px;margin-bottom:4px;padding:2px 6px;background:rgba(59,130,246,0.1);border-radius:4px;display:inline-block">${modelText}</div>`
  const head = `<div style="color:#64748b;margin-bottom:6px;font-size:11px">${axisValue}</div>`
  const items: { name: string; color: string; value: string }[] = [
    { name: '输入 Token', color: '#3b82f6', value: formatTokensM(point.inputTokens) },
    { name: '输出 Token', color: '#a855f7', value: formatTokensM(point.outputTokens) },
    { name: '缓存读取', color: '#22c55e', value: formatTokensM(point.cacheRead) },
    { name: '缓存写入', color: '#f59e0b', value: formatTokensM(point.cacheWrite) },
    { name: 'TPS(含首字)', color: '#06b6d4', value: tpsTotal > 0 ? tpsTotal.toFixed(1) : '—' },
    { name: 'TPS(纯生成)', color: '#0ea5e9', value: tpsGen > 0 ? tpsGen.toFixed(1) : '—' },
    { name: '首字延迟', color: '#8b5cf6', value: fmtSec(point.ttftMs) },
    { name: '总耗时', color: '#ec4899', value: fmtSec(point.durationMs) },
    { name: '费用', color: '#ef4444', value: '$' + point.totalCost.toFixed(4) },
  ]
  const rows = items
    .map(
      i =>
        `<div style="display:flex;justify-content:space-between;gap:20px">
          <span style="color:${i.color}">● ${i.name}</span>
          <span style="font-weight:600">${i.value}</span>
        </div>`,
    )
    .join('')
  return modelLine + head + rows
}

export function formatDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function parseDatetime(s: string): Date | null {
  const d = new Date(s.replace(' ', 'T'))
  return isNaN(d.getTime()) ? null : d
}
