# TPS 计算与鲁棒统计模型说明 (RMT-TPS)

## 1. 现行基础公式（仅输出 Token）

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
| **TPS(含首字)** | **仅 output** | 总耗时 duration | 从发请求到结束的端到端感知吞吐 |
| **TPS(纯生成)** | **仅 output** | duration − TTFT | 首 token 之后的自回归解码速度 |

---

## 2. 极端值防护：样本级门控与物理截断 (Sample Gating & Clamping)

为避免流式首尾包集中到达导致分母 $(duration - ttft) \to 0$ 产生数千 TPS 的奇异假尖峰，或极小样本（1~2 token）扰动：

1. **纯生成门控条件**：
   - 必须满足 `outputTokens >= 3` 且 `(durationMs - ttftMs) >= 150ms`；
   - 若不满足门控条件，则判定为非流式或瞬时微小调用，纯生成 TPS 回退到全局含首字 TPS；
2. **物理范围截断 (Winsorization)**：
   - 单次调用的 TPS 限制在 `[0.1, 800]` 物理可信区间内，防止除零或时间戳抖动。

---

## 3. 统计聚合：Token 加权吞吐模型 (Token-Weighted Aggregation)

在雷达图、趋势分桶（LOD）、散点对比图等聚合统计中，**全面采用 Token 加权吞吐代替脆弱的算术平均**：

$$\overline{TPS}_{total} = \frac{\sum OutputTokens}{\sum (durationMs / 1000)}$$

$$\overline{TPS}_{gen} = \frac{\sum_{valid} OutputTokens}{\sum_{valid} (genMs / 1000)}$$

### 优势：
- 短文本调用（如 1 Token 耗时 5ms 产生 200 TPS）在加权计算中权重只有 $1 / \text{总Token}$，天然免疫瞬时假尖峰；
- 精确反映模型处理实际海量 Token 时的真实吞吐能力。

---

## 4. 雷达图六维评分与抗畸变模型 (Robust Radar Scoring)

针对多模型性能对比雷达图：

1. **贝叶斯样本量收缩 (Bayesian Shrinkage)**：
   - 对调用次数极少（$N < 5$）的模型，将其指标向全集群基准先验均值收缩：
     $$V_{shrunk} = \frac{N \cdot V_{model} + K \cdot V_{prior}}{N + K}$$
   - 彻底解决“新模型调用 1 次产生极值直接拿到 100 分或 0 分”的虚假极值问题。
2. **鲁棒分位数打分 (Quantile-based Normalization)**：
   - 摒弃极易受离群点破坏的原始全局 Min-Max；
   - 采用 $5\% \sim 95\%$ Winsorized 分位数作为参考边界，将得分映射在 $[20, 95]$ 的舒适雷达区间；
   - 确保即便存在超高速/超低速离群模型，其余正常模型（$30 \sim 100$ TPS）依然保持清晰优美的形态与区分度。

---

## 5. Token 计费与时间单位

- 用量/计费相关 Token 优先用 **M（百万）** 单位，见 `formatTokensM` / `formatTokenAxis`；
- 时间单位秒级格式化见 `fmtSec`。
