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
 * 前端重算 TPS（兼容库内旧公式把 input 算进去的数据）
 * 仅 output；含首字用全程 duration。
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
  const dur = point.durationMs
  if (dur != null && dur > 0 && out > 0) {
    const tpsTotal = out / (dur / 1000)
    const genMs = Math.max(1, dur - (point.ttftMs ?? 0))
    const tpsGen = genMs < 2000 ? tpsTotal : out / (genMs / 1000)
    return { tpsTotal, tpsGen }
  }
  return {
    tpsTotal: point.tpsTotal ?? point.tps ?? 0,
    tpsGen: point.tpsGen ?? point.tps ?? 0,
  }
}

export type TrendTooltipMode = 'all' | 'local'

/** 趋势图悬浮：全部指标（模型 + 时间 + 9 项） */
export function buildFullPointTooltip(
  point: {
    time?: string
    provider: string | null
    model: string
    inputTokens: number
    outputTokens: number
    cacheRead: number
    cacheWrite: number
    ttftMs: number | null
    durationMs: number | null
    totalCost: number
  },
  axisValue: string,
): string {
  const modelText = point.provider ? `${point.provider}/${point.model}` : point.model
  const { tpsTotal, tpsGen } = recomputeTps(point as any)
  const modelLine =
    `<div style="color:#3b82f6;font-weight:600;font-size:11px;margin-bottom:4px;padding:2px 6px;background:rgba(59,130,246,0.1);border-radius:4px;display:inline-block">${modelText}</div>`
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
