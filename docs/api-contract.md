# API 契约

仪表盘通过 **Tauri 命令**（`invoke`）读库，不依赖 HTTP 服务。

前端构建产物目录：`src-tauri/web`（vite `outDir`）。

## Tauri 命令一览

| 命令 | 参数 | 返回 |
|---|---|---|
| `get_health` | 无 | `{ ok, dbPath, rows }` |
| `get_series` | `{ start?, end? }` | `TokenDataPoint[]` |
| `get_models` | `{ start?, end? }` | `ModelUsage[]` |
| `get_summary` | `{ start?, end? }` | `ServerSummary` |
| `show_main_window` | 无 | 聚焦主窗口 |

### 时间参数

`start` / `end` 支持：

- 数字：epoch 毫秒
- 字符串：本地时间 `"YYYY-MM-DD HH:mm:ss"`

未传时默认：结束 = 现在，开始 = 现在 − 6 小时。

前端通过 `window.__TAURI_INTERNALS__` 判断 Tauri 环境，并调用 `invoke()`。

---

## 数据结构

### 调用序列点（`get_series`）

区间内**每次 LLM 调用一条**，按 `started_at` 升序。

```ts
interface TokenDataPoint {
  time: string           // 本地 "YYYY-MM-DD HH:mm:ss"
  model: string
  inputTokens: number    // 上行 token
  outputTokens: number   // 下行 token
  cacheRead: number      // 缓存读
  cacheWrite: number     // 缓存写
  tpsTotal: number       // TPS（含首字）
  tpsGen: number         // TPS（纯生成）
  totalCost: number      // 费用 USD
  ttftMs: number | null  // 首字时长 ms
  durationMs: number | null
}
```

### 模型分布（`get_models`）

```ts
interface ModelUsage {
  model: string
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cost: number           // USD
}
```

### 汇总（`get_summary`）

```ts
interface ServerSummary {
  avgLatency: number     // AVG(duration_ms)
  callCount: number      // 调用次数
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheWrite: number
  totalCost: number      // USD
  // 缓存命中率（仪表盘口径）：
  // cacheRead / (input + cacheRead) × 100
  cacheHitRate: number
}
```

### 健康检查（`get_health`）

```ts
interface Health {
  ok: boolean
  dbPath: string
  rows: number           // llm_calls 总行数
}
```

---

## 前端统计页计算公式（查询侧）

| 展示项 | 计算方式 |
|---|---|
| 总输入 / 总输出 / 缓存读 / 缓存写 / 总费用 | 对 `series` 各字段求和，或用 `get_summary` |
| 缓存命中率 | `totalCacheRead / (totalInput + totalCacheRead) × 100` |
| 平均延迟 | `get_summary.avgLatency`（`AVG(duration_ms)`） |
| 调用次数 | `get_summary.callCount` 或 `series.length` |
| TPS（含首字） | 行内字段 `tpsTotal`（写入时已算好） |
| TPS（纯生成） | 行内字段 `tpsGen` |
| 费用累计曲线 | 对 `series.totalCost` 按时间前缀和 |
| 模型柱状图 | `get_models` 按模型分组求和 |
