# TPS 计算说明

## 现行公式（仅输出 token）

实现：`extensions/collector.ts` → `computeTps`  
展示侧兼容重算：`src-tauri/src-web/src/lib/utils.ts` → `recomputeTps`

```ts
// 含首字：全程 wall-clock（含 TTFT）
tpsTotal = outputTokens / (durationMs / 1000)

// 纯生成：去掉首字时间
genMs = max(1, durationMs - (ttftMs ?? 0))
tpsGen = outputTokens / (genMs / 1000)
```

| 指标 | 分子 | 分母 | 含义 |
|------|------|------|------|
| TPS(含首字) | **仅 output** | 总耗时 duration | 从发请求到结束的平均输出吞吐 |
| TPS(纯生成) | **仅 output** | duration − TTFT | 首 token 之后的解码速度 |

**不再把 input / cache 计入 TPS 分子。**

## 时间

- `durationMs`：请求开始 → 结束
- `ttftMs`：请求开始 → 首 token
- `durationMs ≈ ttftMs + 生成时长`

## Token 计费展示

用量/计费相关 Token 优先用 **M（百万）** 单位，见 `formatTokensM` / `formatTokenAxis`。
