import * as echarts from 'echarts'

const baseData = Array.from({length: 48}, (_, i) => ({ time: `t${i}`, v: i*100 }))
function makeOption(withHardcoded) {
  return {
    xAxis: { type: 'category', data: baseData.map(d => d.time) },
    yAxis: { type: 'value' },
    dataZoom: [{ type: 'inside' }, { type: 'slider', ...(withHardcoded ? { start: 0, end: 100 } : {}) }],
    series: [{ id: 's1', type: 'line', data: baseData.map(d => d.v) }],
  }
}
function newChart() { return echarts.init(null, null, { ssr: true, renderer: 'svg', width: 600, height: 300 }) }

// 模拟「vue-echarts 修复前」：option 每次新引用 → notMerge:true 全量重建 + dataZoom 带 start/end
const c1 = newChart()
let opt = makeOption(true)
c1.setOption(opt, { notMerge: opt !== opt }) // 首次
c1.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: 40, end: 60 })
const n1 = c1.getOption()
console.log('修复前：缩放后 =', n1.dataZoom[1].start, '-', n1.dataZoom[1].end)
opt = makeOption(true)  // LIVE 刷新 → 新对象引用
c1.setOption(opt, { notMerge: true })  // vue-echarts: option!==oldOption → notMerge:true
const a1 = c1.getOption()
console.log('修复前：刷新后 =', a1.dataZoom[1].start, '-', a1.dataZoom[1].end, '← 回正' )

// 模拟「vue-echarts 修复后」：update-options={notMerge:false} + dataZoom 不带 start/end
const c2 = newChart()
opt = makeOption(false)
c2.setOption(opt, { notMerge: false })
c2.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: 40, end: 60 })
opt = makeOption(false)  // LIVE 刷新 → 新对象引用，但强制 merge
c2.setOption(opt, { notMerge: false })
const a2 = c2.getOption()
console.log('修复后：刷新后 =', a2.dataZoom[1].start, '-', a2.dataZoom[1].end, '← 保留缩放 ✓')

// 边界：merge 模式下如果 dataZoom 仍带 start/end 会怎样
const c3 = newChart()
opt = makeOption(false)
c3.setOption(opt, { notMerge: false })
c3.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: 40, end: 60 })
opt = makeOption(true)  // 仍写死 start:0,end:100
c3.setOption(opt, { notMerge: false })
const a3 = c3.getOption()
console.log('边界：merge 但带 start/end =', a3.dataZoom[1].start, '-', a3.dataZoom[1].end, '← 也会被覆盖，所以必须去掉')
