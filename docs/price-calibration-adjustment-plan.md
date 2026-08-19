# 价格校准系统调整计划与完整设计

## 1. 现状分析

### 1.1 当前价格校准页功能

**已有功能**：
- 列出所有提供商（基于 `llm_calls` 表的 `models.provider`）
- 为每个提供商配置自定义价格计算脚本（存储在 `price_calibration` 表）
- 提供商分组功能（`provider_groups` + `provider_group_members` 表）
- 拖拽合并提供商
- 搜索、分页、展开/折叠分组

**核心表结构**：
```sql
-- 价格校准脚本（当前用于自定义价格计算）
CREATE TABLE price_calibration (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  script TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 提供商分组
CREATE TABLE provider_groups (
  id INTEGER PRIMARY KEY,
  group_name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- 分组成员关系
CREATE TABLE provider_group_members (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL,
  original_provider TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  UNIQUE(group_id, original_provider),
  FOREIGN KEY(group_id) REFERENCES provider_groups(id) ON DELETE CASCADE
);
```

**现有问题**：
1. **脚本用途模糊**：当前 `price_calibration.script` 是价格计算脚本，但我们需要的是 **Adapter 绑定**
2. **缺少 Adapter 关联**：没有字段记录"提供商使用哪个 Adapter 抓取真实费用"
3. **缺少真实费用存储**：没有表存储从中转站抓取的真实费用数据
4. **"鉴权"按钮未实现**：预留了 OAuth 授权功能，但未与 Adapter 关联

---

## 2. 两个阶段的严格区分

### 阶段 1：Adapter 制作阶段（Skill 驱动）

**目标**：为某个中转站创建并配置 Adapter

**参与组件**：
- `skills/usage-fetcher/` - Skill 工具集
- `~/.pi/pi-usage-report-store/<adapter-name>/` - Adapter 存储位置

**主要操作**：
1. Agent 通过 CLI 检测浏览器环境
2. 创建 Adapter（交互式填写配置）
3. 登录检测（打开浏览器，用户登录）
4. 抓包分析（自动捕获 API 调用）
5. 测试同步（验证 Adapter 可用性）

**产物**：
- `~/.pi/pi-usage-report-store/<adapter-name>/adapter.js` - 适配器代码
- `~/.pi/pi-usage-report-store/<adapter-name>/config.json` - 配置文件
- `~/.pi/pi-usage-report-store/<adapter-name>/state.json` - 运行时状态

**关键点**：
- 此阶段**不涉及 Tauri 应用**
- 此阶段**不涉及数据库绑定**
- 此阶段由 **pi Agent + CLI 工具**完成
- 用户可以创建多个 Adapter（不同中转站）

---

### 阶段 2：价格校准阶段（Tauri App 驱动）

**目标**：将提供商与 Adapter 绑定，同步真实费用，匹配本地记录

**参与组件**：
- Tauri 应用的"价格校准"页
- `~/.pi/pi-usage-report-store/usage.db` - 数据库（新增表）
- `~/.pi/pi-usage-report-store/` - Adapter 存储位置

**主要操作**：
1. 列出所有提供商（从 `llm_calls` 聚合）
2. 用户为提供商选择绑定的 Adapter
3. 点击"同步"按钮，调用 Adapter 抓取真实费用
4. 将抓取的数据写入 `fetched_usage` 表
5. 根据指纹匹配本地 `llm_calls` 记录
6. 展示价格对比（估算 vs 实际）

**产物**：
- `provider_adapter_bindings` 表 - 提供商与 Adapter 的绑定关系
- `fetched_usage` 表 - 从中转站抓取的真实费用数据
- 价格对比报告（前端展示）

**关键点**：
- 此阶段在 **Tauri 应用**中完成
- 此阶段依赖**阶段 1 已创建的 Adapter**
- 此阶段通过 **Rust Command** 调用 Adapter CLI
- 用户可以为同一个提供商切换不同 Adapter

---

## 3. 数据库调整方案

### 3.1 新增表：`provider_adapter_bindings`

**用途**：记录提供商与 Adapter 的绑定关系

```sql
CREATE TABLE provider_adapter_bindings (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,         -- 提供商名称（如 "openai"）
  adapter_name TEXT NOT NULL,            -- Adapter 名称（如 "openai-relay"）
  adapter_path TEXT NOT NULL,            -- Adapter 路径（绝对路径）
  enabled BOOLEAN NOT NULL DEFAULT 1,    -- 是否启用
  last_sync_time INTEGER,                -- 最后同步时间（毫秒）
  last_sync_status TEXT,                 -- 最后同步状态（success/error）
  last_error_message TEXT,               -- 最后同步错误信息
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_adapter_bindings_provider ON provider_adapter_bindings(provider);
CREATE INDEX idx_adapter_bindings_enabled ON provider_adapter_bindings(enabled);
```

**字段说明**：
- `provider`：提供商名称，与 `models.provider` 对应
- `adapter_name`：Adapter 名称（目录名）
- `adapter_path`：Adapter 完整路径（如 `C:\Users\xxx\.pi\pi-usage-report-store\openai-relay`）
- `enabled`：是否启用此绑定（用户可暂停同步）
- `last_sync_time`：最后同步时间，用于增量同步
- `last_sync_status`：记录同步结果（便于排查问题）

---

### 3.2 新增表：`fetched_usage`

**用途**：存储从中转站抓取的真实费用数据

```sql
CREATE TABLE fetched_usage (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,                -- 提供商名称
  adapter_name TEXT NOT NULL,            -- 数据来源 Adapter
  request_id TEXT,                       -- 中转站的请求 ID（如果有）
  timestamp INTEGER NOT NULL,            -- 请求时间（毫秒）
  model TEXT NOT NULL,                   -- 模型名称
  input_tokens INTEGER NOT NULL,         -- 输入 Token 数
  output_tokens INTEGER NOT NULL,        -- 输出 Token 数
  cache_read_tokens INTEGER DEFAULT 0,   -- 缓存读取 Token 数
  cache_write_tokens INTEGER DEFAULT 0,  -- 缓存写入 Token 数
  cost_usd REAL NOT NULL,                -- 真实费用（美元）
  matched_call_id INTEGER,               -- 匹配到的本地记录 ID
  match_confidence REAL,                 -- 匹配置信度（0-1）
  raw_data TEXT,                         -- 原始 JSON 数据（调试用）
  created_at INTEGER NOT NULL,           -- 记录创建时间
  FOREIGN KEY(matched_call_id) REFERENCES llm_calls(id) ON DELETE SET NULL
);

CREATE INDEX idx_fetched_provider ON fetched_usage(provider);
CREATE INDEX idx_fetched_timestamp ON fetched_usage(timestamp);
CREATE INDEX idx_fetched_matched ON fetched_usage(matched_call_id);
CREATE INDEX idx_fetched_adapter ON fetched_usage(adapter_name);
CREATE UNIQUE INDEX idx_fetched_dedup ON fetched_usage(provider, timestamp, model, input_tokens, output_tokens);
```

**字段说明**：
- `request_id`：中转站的唯一请求 ID（如果提供）
- `matched_call_id`：关联到 `llm_calls.id`，指向匹配的本地记录
- `match_confidence`：匹配置信度（1.0=完美匹配，0.8=模糊匹配）
- `raw_data`：保留原始 JSON，便于调试和未来扩展
- `UNIQUE INDEX idx_fetched_dedup`：防止重复同步相同记录

---

### 3.3 修改现有表：`price_calibration`

**当前用途**：存储价格计算脚本

**调整方案**：
- **保留此表**，但用途调整为"自定义价格校准脚本"（可选高级功能）
- 不再是主要功能，主要功能改为 Adapter 绑定

**或者（推荐）**：
- **重命名表**：`price_calibration` → `custom_price_scripts`
- 明确区分：`provider_adapter_bindings`（Adapter 绑定）vs `custom_price_scripts`（自定义脚本）

**推荐做法**：
```sql
-- 保留旧表作为遗留功能（可选）
-- price_calibration 保持不变

-- 新表作为主要功能
-- provider_adapter_bindings 用于 Adapter 绑定
```

---

## 4. Adapter 公共预定义变量

### 4.1 输入变量（Adapter 可读取）

Adapter 在执行 `fetchUsage()` 时，可以访问以下**只读**变量：

```javascript
// 由 adapter-runner.js 注入到 Adapter 运行环境
const ADAPTER_CONTEXT = {
  // 基本信息
  adapterName: 'openai-relay',           // Adapter 名称
  adapterPath: 'C:\\Users\\xxx\\.pi\\pi-usage-report-store\\openai-relay',
  
  // 同步参数
  syncMode: 'incremental',               // 'incremental' | 'full'
  startTime: 1708320000000,              // Unix 毫秒（增量模式时的起始时间）
  endTime: 1708406400000,                // Unix 毫秒（当前时间）
  
  // 状态信息（从 state.json 读取）
  lastSyncTime: 1708320000000,           // 上次同步时间
  cursor: 'abc123',                      // 分页游标（如果有）
  totalRecords: 1523,                    // 已同步总记录数
  
  // 配置信息（从 config.json 读取）
  config: {
    name: 'openai-relay',
    urls: { /* ... */ },
    browser: 'chrome',
    profile: 'Default',
    // ... 其他配置
  }
};
```

**Adapter 实现示例**：
```javascript
export default class Adapter {
  async fetchUsage({ startTime, endTime, fullSync }) {
    // 访问预定义变量
    const lastCursor = this.state.cursor;
    const baseUrl = this.config.urls.usage;
    
    // 使用变量构建请求
    const url = `${baseUrl}?start=${startTime}&cursor=${lastCursor}`;
    
    // ... 抓取逻辑
  }
}
```

---

### 4.2 输出变量（Adapter 必须返回）

Adapter 的 `fetchUsage()` 方法必须返回**标准化格式**：

```javascript
{
  // 同步结果
  success: true,                         // 是否成功
  records: [                             // 标准化记录数组
    {
      timestamp: 1708320000000,          // Unix 毫秒（必需）
      provider: 'openai',                // 提供商名称（必需）
      model: 'gpt-4-turbo',              // 模型名称（必需）
      inputTokens: 1500,                 // 输入 Token（必需）
      outputTokens: 800,                 // 输出 Token（必需）
      cacheReadTokens: 0,                // 缓存读取 Token（可选，默认 0）
      cacheWriteTokens: 0,               // 缓存写入 Token（可选，默认 0）
      cost: 0.0234,                      // 真实费用 USD（必需）
      requestId: 'req_abc123',           // 中转站请求 ID（可选）
      rawData: { /* 原始 JSON */ }       // 原始数据（可选，调试用）
    },
    // ... 更多记录
  ],
  
  // 分页信息
  cursor: 'next_page_cursor',            // 下一页游标（可选）
  hasMore: false,                        // 是否有更多数据（可选）
  
  // 统计信息
  totalFetched: 237,                     // 本次抓取记录数
  
  // 错误信息（如果失败）
  error: null,                           // 错误信息（成功时为 null）
  errorCode: null                        // 错误代码（可选）
}
```

**字段约束**：
- `timestamp`、`provider`、`model`、`inputTokens`、`outputTokens`、`cost` 为**必需字段**
- 其他字段为可选字段，Adapter 可以根据实际情况提供
- 所有字段名**不可修改**，必须严格按照此格式

---

### 4.3 错误处理变量

Adapter 在发生错误时，必须抛出标准化错误：

```javascript
class AdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;          // 错误代码
    this.details = details;    // 详细信息
  }
}

// 预定义错误代码
const ERROR_CODES = {
  AUTH_FAILED: 'AUTH_FAILED',           // 鉴权失败（未登录）
  NETWORK_ERROR: 'NETWORK_ERROR',       // 网络错误
  API_ERROR: 'API_ERROR',               // API 调用错误
  PARSE_ERROR: 'PARSE_ERROR',           // 数据解析错误
  TIMEOUT: 'TIMEOUT',                   // 超时
  UNKNOWN: 'UNKNOWN'                    // 未知错误
};

// 使用示例
throw new AdapterError(
  'AUTH_FAILED',
  '未检测到登录状态，请先登录',
  { url: 'https://api.example.com/usage' }
);
```

---

## 5. 价格校准页调整计划

### 5.1 UI 调整

**原有布局**：
```
┌─────────────────────────────────────────┐
│ 价格校准                                 │
│ 为每个提供商编写自定义价格计算脚本       │
│                                          │
│ [鉴权] [刷新]                            │
│ [搜索框]                                 │
│                                          │
│ ┌──────────────┐ ┌──────────────┐      │
│ │ openai       │ │ anthropic    │      │
│ │ 调用: 1234   │ │ 调用: 567    │      │
│ │ 费用: $12.34 │ │ 费用: $5.67  │      │
│ │ [配置脚本]   │ │ [配置脚本]   │      │
│ └──────────────┘ └──────────────┘      │
└─────────────────────────────────────────┘
```

**调整后布局**：
```
┌───────────────────────────────────────────────────────────────┐
│ 价格校准                                                       │
│ 绑定 Adapter 以同步中转站真实费用 · 自动匹配本地记录          │
│                                                                │
│ [管理 Adapter] [刷新]              共 3 个提供商 | 2 个已绑定  │
│ [搜索框]                                                       │
│                                                                │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ openai                                          🟢已绑定 │   │
│ │ Adapter: openai-relay            最后同步: 10:30       │   │
│ │ ────────────────────────────────────────────────────   │   │
│ │ 本地估算费用: $12.34                                    │   │
│ │ 真实费用:     $13.56  (+9.9%)                           │   │
│ │ 匹配率:       87% (234/268 条)                          │   │
│ │                                                          │   │
│ │ [立即同步] [查看明细] [解除绑定] [更换 Adapter]         │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                                │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ anthropic                                      ⚪未绑定  │   │
│ │ 调用次数: 567            总费用: $5.67                  │   │
│ │                                                          │   │
│ │ [绑定 Adapter ▼]                                        │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                                │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ gemini-pro                                     ⚪未绑定  │   │
│ │ 调用次数: 123            总费用: $1.23                  │   │
│ │                                                          │   │
│ │ [绑定 Adapter ▼]                                        │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                                │
│ [分页控件]                                                     │
└───────────────────────────────────────────────────────────────┘
```

---

### 5.2 功能调整

#### 功能 1：管理 Adapter（新增）

**触发**：点击"管理 Adapter"按钮

**功能**：
- 列出所有已创建的 Adapter（扫描 `~/.pi/pi-usage-report-store/`）
- 显示 Adapter 详情：
  - 名称、显示名称、版本
  - 配置状态（已配置/未配置）
  - 绑定的提供商列表
  - 最后同步时间
- 操作：
  - 测试连接（运行 `node cli/fetch-cli.js check-login <adapter>`）
  - 删除 Adapter
  - 查看配置文件

**实现**：
- 新增 Rust Command: `list_adapters` → 扫描目录，返回 Adapter 列表
- 新增 Rust Command: `test_adapter_connection` → 调用 CLI 测试

---

#### 功能 2：绑定 Adapter（修改现有"配置脚本"）

**触发**：未绑定提供商点击"绑定 Adapter"下拉菜单

**功能**：
- 列出所有可用 Adapter
- 选择后创建绑定（写入 `provider_adapter_bindings` 表）
- 提示用户进行首次全量同步

**实现**：
- 修改 Rust Command: `bind_adapter(provider, adapter_name)`
- 前端调用后刷新列表

---

#### 功能 3：同步数据（新增）

**触发**：已绑定提供商点击"立即同步"按钮

**功能**：
- 调用 Adapter CLI 执行同步：
  - 首次同步：`node cli/fetch-cli.js sync <adapter> --full`
  - 增量同步：`node cli/fetch-cli.js sync <adapter>`
- 显示同步进度（前端轮询或 WebSocket）
- 同步完成后：
  - 将数据写入 `fetched_usage` 表
  - 执行指纹匹配（匹配到 `llm_calls`）
  - 更新 `provider_adapter_bindings.last_sync_time`
  - 刷新卡片显示

**实现**：
- 新增 Rust Command: `sync_adapter(provider, full_sync: bool)` → 调用 CLI，解析输出
- 新增 Rust Command: `match_usage_records(provider)` → 执行指纹匹配算法

---

#### 功能 4：查看明细（新增）

**触发**：已绑定提供商点击"查看明细"按钮

**功能**：
- 打开详情抽屉，展示：
  - **匹配成功记录**：本地记录 vs 真实费用对比
  - **未匹配记录**：仅在中转站有、本地没有的记录
  - **价格差异记录**：匹配但费用差异较大的记录（>10%）
- 支持筛选、排序、导出 CSV

**实现**：
- 新增 Rust Command: `get_price_comparison(provider, start_time, end_time)`
- 返回分类统计和明细列表

---

#### 功能 5：解除绑定 / 更换 Adapter（新增）

**触发**：已绑定提供商的操作按钮

**功能**：
- **解除绑定**：删除 `provider_adapter_bindings` 记录，保留 `fetched_usage` 历史数据
- **更换 Adapter**：更新 `adapter_name`，提示重新同步

**实现**：
- 新增 Rust Command: `unbind_adapter(provider)`
- 新增 Rust Command: `update_adapter_binding(provider, new_adapter_name)`

---

### 5.3 废弃功能

#### 废弃 1：自定义脚本编辑器（ScriptEditorDrawer）

**原功能**：为提供商编写价格计算脚本

**调整**：
- **短期**：保留组件但隐藏入口，不再主功能
- **长期**：完全移除，专注于 Adapter 绑定

**原因**：
- Adapter 机制更强大（抓取真实费用）
- 自定义脚本维护成本高，用户难以使用
- 与新功能定位冲突

---

#### 废弃 2：提供商分组（provider_groups）

**原功能**：将多个提供商合并为一组，共享脚本

**调整**：
- **短期**：保留表和功能，但不作为主要功能
- **长期**：评估是否保留（可能用于"批量绑定同一个 Adapter"）

**原因**：
- 分组功能与 Adapter 绑定关系不大
- Adapter 是一对一绑定（一个提供商对应一个 Adapter）
- 如果保留，可用于"多个提供商使用同一个 Adapter"（如多个 OpenAI 代理）

---

#### 废弃 3："鉴权"按钮

**原功能**：预留的 OAuth 授权按钮（未实现）

**调整**：
- **移除卡片级别的"鉴权"按钮**
- 鉴权功能整合到"管理 Adapter"中（测试连接时自动处理登录）

**原因**：
- 鉴权是 Adapter 级别的操作，不是提供商级别
- Adapter 创建时已处理登录，无需在此重复

---

## 6. Rust Backend 新增 Commands

### 6.1 Adapter 管理

```rust
#[tauri::command]
async fn list_adapters() -> Result<Vec<AdapterInfo>, String> {
    // 扫描 ~/.pi/pi-usage-report-store/
    // 读取每个 Adapter 的 config.json
    // 返回 Adapter 列表
}

#[tauri::command]
async fn test_adapter_connection(adapter_name: String) -> Result<TestResult, String> {
    // 调用 CLI: node .../fetch-cli.js check-login <adapter_name>
    // 解析输出，返回登录状态
}

#[tauri::command]
async fn delete_adapter(adapter_name: String) -> Result<(), String> {
    // 删除 ~/.pi/pi-usage-report-store/<adapter_name>/
    // 同时删除所有相关绑定
}
```

---

### 6.2 提供商与 Adapter 绑定

```rust
#[tauri::command]
async fn bind_adapter(provider: String, adapter_name: String) -> Result<(), String> {
    // 插入 provider_adapter_bindings 表
    // 验证 Adapter 存在
}

#[tauri::command]
async fn unbind_adapter(provider: String) -> Result<(), String> {
    // 删除 provider_adapter_bindings 记录
    // 保留 fetched_usage 历史数据
}

#[tauri::command]
async fn update_adapter_binding(provider: String, new_adapter_name: String) -> Result<(), String> {
    // 更新 adapter_name
}

#[tauri::command]
async fn get_adapter_bindings() -> Result<Vec<AdapterBinding>, String> {
    // 查询 provider_adapter_bindings 表
    // 返回所有绑定关系
}
```

---

### 6.3 数据同步与匹配

```rust
#[tauri::command]
async fn sync_adapter(provider: String, full_sync: bool) -> Result<SyncResult, String> {
    // 1. 查询 provider_adapter_bindings 获取 adapter_name
    // 2. 构建 CLI 命令: node .../fetch-cli.js sync <adapter> [--full]
    // 3. 执行命令，解析输出（JSON 格式）
    // 4. 将返回的记录写入 fetched_usage 表
    // 5. 更新 provider_adapter_bindings.last_sync_time
    // 6. 返回同步结果
}

#[tauri::command]
async fn match_usage_records(provider: String) -> Result<MatchResult, String> {
    // 1. 查询 fetched_usage（未匹配的记录）
    // 2. 对每条记录，查询 llm_calls 表匹配：
    //    - 时间戳 ±60s
    //    - model 相同
    //    - input_tokens 相同
    //    - output_tokens 相同
    // 3. 计算匹配置信度
    // 4. 更新 fetched_usage.matched_call_id 和 match_confidence
    // 5. 返回匹配统计
}

#[tauri::command]
async fn get_price_comparison(
    provider: String,
    start_time: i64,
    end_time: i64
) -> Result<PriceComparison, String> {
    // 查询：
    // 1. llm_calls 表（本地估算费用）
    // 2. fetched_usage 表（真实费用）
    // 3. 匹配记录的费用对比
    // 返回统计和明细
}
```

---

### 6.4 数据结构定义

```rust
#[derive(Serialize, Clone)]
pub struct AdapterInfo {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub path: String,
    pub configured: bool,
    pub bound_providers: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct AdapterBinding {
    pub id: i64,
    pub provider: String,
    pub adapter_name: String,
    pub enabled: bool,
    pub last_sync_time: Option<i64>,
    pub last_sync_status: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SyncResult {
    pub success: bool,
    pub total_fetched: i64,
    pub new_records: i64,
    pub duplicates: i64,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct MatchResult {
    pub total_records: i64,
    pub matched: i64,
    pub unmatched: i64,
    pub match_rate: f64,
}

#[derive(Serialize, Clone)]
pub struct PriceComparison {
    pub provider: String,
    pub start_time: i64,
    pub end_time: i64,
    pub estimated_cost: f64,      // 本地估算
    pub actual_cost: f64,          // 真实费用
    pub difference: f64,           // 差额
    pub difference_percent: f64,   // 差额百分比
    pub match_rate: f64,           // 匹配率
    pub matched_records: i64,
    pub unmatched_records: i64,
    pub details: Vec<PriceComparisonDetail>,
}

#[derive(Serialize, Clone)]
pub struct PriceComparisonDetail {
    pub timestamp: i64,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub estimated_cost: f64,
    pub actual_cost: Option<f64>,
    pub matched: bool,
    pub confidence: Option<f64>,
}
```

---

## 7. CLI 输出格式规范

为了让 Rust 能够正确解析 CLI 输出，需要定义标准输出格式：

### 7.1 同步命令输出

```bash
node cli/fetch-cli.js sync openai-relay
```

**输出（JSON）**：
```json
{
  "success": true,
  "records": [
    {
      "timestamp": 1708320000000,
      "provider": "openai",
      "model": "gpt-4-turbo",
      "inputTokens": 1500,
      "outputTokens": 800,
      "cacheReadTokens": 0,
      "cacheWriteTokens": 0,
      "cost": 0.0234,
      "requestId": "req_abc123",
      "rawData": {}
    }
  ],
  "cursor": "next_page_cursor",
  "hasMore": false,
  "totalFetched": 237,
  "error": null
}
```

### 7.2 登录检测输出

```bash
node cli/fetch-cli.js check-login openai-relay
```

**输出（JSON）**：
```json
{
  "loggedIn": true,
  "method": "cookie",
  "username": "user@example.com",
  "message": "登录成功"
}
```

**失败输出**：
```json
{
  "loggedIn": false,
  "message": "未检测到登录状态"
}
```

---

## 8. 实现优先级（修订）

### P0（必须实现，第一版）

**数据库**：
- [x] 创建 `provider_adapter_bindings` 表
- [x] 创建 `fetched_usage` 表
- [x] 数据库迁移脚本

**Rust Backend**：
- [ ] `list_adapters`
- [ ] `bind_adapter` / `unbind_adapter`
- [ ] `get_adapter_bindings`
- [ ] `sync_adapter`（基础版，调用 CLI）
- [ ] `match_usage_records`（基础匹配算法）

**前端 Vue**：
- [ ] 修改 ProviderCard 组件（显示绑定状态）
- [ ] 新增"绑定 Adapter"下拉选择
- [ ] 新增"立即同步"按钮
- [ ] 调整主页面布局

---

### P1（重要功能，第二版）

**Rust Backend**：
- [ ] `test_adapter_connection`
- [ ] `get_price_comparison`
- [ ] 完善 `sync_adapter`（进度反馈）

**前端 Vue**：
- [ ] 新增"管理 Adapter"页面/抽屉
- [ ] 新增"查看明细"抽屉
- [ ] 同步进度展示
- [ ] 价格对比图表

---

### P2（增强功能，后续迭代）

- [ ] 批量同步多个提供商
- [ ] 定时自动同步
- [ ] 导出价格对比报告（CSV/PDF）
- [ ] 匹配置信度调整
- [ ] 手动确认模糊匹配

---

## 9. 迁移路径

### 9.1 数据库迁移

**步骤**：
1. 在 `db.rs` 中添加新表创建逻辑（已在 `open_ro()` 中）
2. 首次启动时自动创建新表
3. 现有 `price_calibration` 表保持不变（向下兼容）

**兼容性**：
- 旧版用户升级后，现有脚本保留（但不再显示在主界面）
- 新用户直接使用 Adapter 绑定功能

---

### 9.2 用户体验

**首次使用流程**：
1. 用户打开价格校准页 → 看到提供商列表，全部"未绑定"
2. 点击"绑定 Adapter" → 发现没有可用 Adapter
3. 提示："尚无可用 Adapter，请先通过 pi Agent 创建 Adapter"
4. 用户在 pi 会话中：
   ```
   用户: 帮我创建一个 OpenAI 中转站的 Adapter
   Agent: 好的，正在检测浏览器环境...
   Agent: 请输入中转站网址...
   （交互式创建 Adapter）
   ```
5. 创建完成后，回到价格校准页 → 刷新 → 看到 Adapter，进行绑定
6. 点击"立即同步" → 首次全量同步
7. 同步完成后，查看价格对比

---

## 10. 总结

### 核心调整

1. **表结构**：
   - 新增 `provider_adapter_bindings`（提供商与 Adapter 绑定）
   - 新增 `fetched_usage`（真实费用数据）
   - 保留 `price_calibration`（兼容性，可选高级功能）

2. **UI 调整**：
   - 从"配置脚本"改为"绑定 Adapter"
   - 新增"立即同步"、"查看明细"按钮
   - 新增"管理 Adapter"页面
   - 废弃自定义脚本编辑器（可选保留）

3. **功能流程**：
   - **阶段 1**：Agent + CLI 创建 Adapter（独立于 Tauri）
   - **阶段 2**：Tauri 应用绑定 Adapter、同步数据、匹配记录

4. **Adapter 规范**：
   - 输入变量：`ADAPTER_CONTEXT`（只读）
   - 输出变量：标准化 JSON 格式（必需字段）
   - 错误处理：`AdapterError` + 错误代码

### 待确认问题

1. **是否保留 provider_groups 功能**？
   - 建议：短期保留，长期评估是否用于"批量绑定"

2. **price_calibration 表是否重命名**？
   - 建议：保持原名，但调整用途说明

3. **CLI 调用方式**？
   - 当前：Rust 通过 `Command::new("node")` 调用
   - 替代：是否考虑打包成单独的可执行文件？

---

**文档版本**：v2.0  
**创建日期**：2024-02-19  
**最后更新**：2024-02-19
