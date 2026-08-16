import * as echarts from 'echarts'
const COLORS = { cache: '#22c55e', write: '#f59e0b', input: '#3b82f6', output: '#a855f7' }
const totalOf = (m) => m.cacheRead + m.cacheWrite + m.inputTokens + m.outputTokens
const formatTokens = (v) => v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : String(v)
const data = [
  { model: 'anthropic/claude-sonnet-4-20250514', cacheRead: 320000, cacheWrite: 40000, inputTokens: 180000, outputTokens: 95000, cost: 1.2 },
  { model: 'gpt-4o', cacheRead: 120000, cacheWrite: 10000, inputTokens: 60000, outputTokens: 40000, cost: 0.8 },
  { model: 'deepseek/deepseek-v3', cacheRead: 80000, cacheWrite: 5000, inputTokens: 50000, outputTokens: 30000, cost: 0.1 },
]
const sorted = [...data].sort((a,b) => totalOf(b)-totalOf(a))
const option = {
  tooltip: { trigger: 'axis', formatter(params) {
    const m = sorted[params[0].dataIndex]
    const rows = [['总 Token', totalOf(m), '#334155'],['缓存命中', m.cacheRead, COLORS.cache],['缓存写入', m.cacheWrite, COLORS.write],['输入', m.inputTokens, COLORS.input],['输出', m.outputTokens, COLORS.output]]
    return `<b>${m.model}</b>` + rows.map(([l,v,c]) => `<div>${l}: ${v}</div>`).join('')
  }},
  legend: {},
  grid: { top: 10, right: 76, bottom: 36, left: 8, containLabel: true },
  xAxis: { type: 'value' },
  yAxis: { type: 'category', inverse: true, data: sorted.map(d => d.model) },
  series: [
    { name: '缓存命中', type: 'bar', stack: 'total', barMaxWidth: 26, data: sorted.map(d => d.cacheRead), itemStyle: { color: COLORS.cache } },
    { name: '缓存写入', type: 'bar', stack: 'total', barMaxWidth: 26, data: sorted.map(d => d.cacheWrite), itemStyle: { color: COLORS.write } },
    { name: '输入', type: 'bar', stack: 'total', barMaxWidth: 26, data: sorted.map(d => d.inputTokens), itemStyle: { color: COLORS.input } },
    { name: '输出', type: 'bar', stack: 'total', barMaxWidth: 26, data: sorted.map(d => d.outputTokens), itemStyle: { color: COLORS.output, borderRadius: [0,6,6,0] },
      label: { show: true, position: 'right', formatter: (p) => formatTokens(totalOf(sorted[p.dataIndex])) } },
  ],
}
const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 420, height: 240 })
chart.setOption(option)
const svg = chart.renderToSVGString()
const nums = svg.match(/\d+(\.\d+)?[KM]/g)
console.log('SVG len:', svg.length, '| labels:', nums)
console.log('total labels ok:', nums.includes('635.0K') && nums.includes('230.0K') && nums.includes('165.0K'))
const tip = option.tooltip.formatter([{ dataIndex: 0 }])
console.log('tooltip 5 dims ok:', tip.includes('总 Token') && tip.includes('缓存命中') && tip.includes('缓存写入') && tip.includes('输入') && tip.includes('输出'))
