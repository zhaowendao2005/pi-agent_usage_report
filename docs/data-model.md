# 数据模型

数据库路径：`~/.pi/agent/usage.db`  
Windows 示例：`C:\Users\<用户名>\.pi\agent\usage.db`

## 设计原则

- **一行 = 一次 LLM 调用**（`assistant` 消息结束时落库，含失败）
- **只存指标**，不存对话正文 / 工具输出 / 提示词
- 图表数据在**查询时**由原始调用行聚合计算，不预存聚合表

## 表结构

```sql
CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  session_id   TEXT    NOT NULL UNIQUE,
  session_file TEXT,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER
);

CREATE TABLE models (
  id       INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  model    TEXT NOT NULL,
  UNIQUE(provider, model)
);

CREATE TABLE llm_calls (
  id            INTEGER PRIMARY KEY,
  session_int   INTEGER NOT NULL REFERENCES sessions(id),
  model_int     INTEGER NOT NULL REFERENCES models(id),
  message_id    TEXT    NOT NULL,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  ttft_ms       INTEGER,
  duration_ms   INTEGER,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read    INTEGER NOT NULL DEFAULT 0,
  cache_write   INTEGER NOT NULL DEFAULT 0,
  cost_usd      INTEGER NOT NULL,
  tps_total     REAL,
  tps_gen       REAL,
  http_status   INTEGER,   -- after_provider_response.status；旧数据 NULL
  stop_reason   TEXT,      -- stop|error|aborted|toolUse|length|…
  error_message TEXT,      -- 截断后的错误文案
  UNIQUE(session_int, message_id)
);

CREATE INDEX idx_calls_started ON llm_calls(started_at);
CREATE INDEX idx_calls_model   ON llm_calls(model_int);
CREATE INDEX idx_calls_status  ON llm_calls(http_status);
```

旧库打开时会 `ALTER TABLE` 补列（`http_status` / `stop_reason` / `error_message`）。

## 字段来源

| 列 | 来源 |
|---|---|
| `message_id` | `message_end` → `event.message.id`（缺失时用合成 ID） |
| `started_at` | 本轮第一次 `before_provider_request`（`Date.now()`） |
| `finished_at` | `message_end`（`Date.now()`） |
| `ttft_ms` | 首个 `message_update` 文本 delta 时刻 − `started_at`（失败常为 NULL） |
| `duration_ms` | `finished_at − started_at` |
| `input_tokens` / `output_tokens` / `cache_*` | `message.usage.*`（失败多为 0） |
| `cost_usd` | `round(usage.cost.total × 1e6)`（微美元整数） |
| `tps_total` | `(input+output) / (duration_ms/1000)`（含首字等待） |
| `tps_gen` | `(input+output) / max(1ms, duration_ms−ttft_ms) / 1000`（纯生成） |
| `http_status` | `after_provider_response.status`；缺失时从 `errorMessage` 解析 4xx/5xx |
| `stop_reason` | `message.stopReason` |
| `error_message` | `message.errorMessage`（最多约 500 字符） |

## 失败调用

满足任一条件即落库为失败行（即使无 `usage`）：

- `stopReason ∈ {error, aborted}`
- `http_status` 存在且不在 `[200, 300)`

成功且完全无 `usage` 的消息仍跳过（无指标可记）。

## provider / model

- 采集自 `message_end` → `message.provider` / `message.model`
- **缺少 provider**（字段缺失或空串）时写入 `models.provider = ''`（SQLite `UNIQUE` 不能稳定键合 `NULL`）
- 查询 API 将空字符串规范化为 **`null`**，旧数据无提供商字段时同样返回 `null`
- 工具嵌套用量：`provider = "tool"`，`model = toolName`

## 写入策略

- `journal_mode=WAL` + `synchronous=NORMAL` + `busy_timeout=5000`
- 连接随会话：`session_start` 打开，`session_shutdown` 关闭
- 预编译语句 + 进程内字典缓存（`sessions` / `models` → 小整数）
- 批量缓冲：满 **16 条** 或 **2 秒** 任一先到则 flush
- `session_shutdown` / 进程退出时强制 flush
- `INSERT OR IGNORE` + `UNIQUE(session_int, message_id)`，防止 resume 重放重复写入
