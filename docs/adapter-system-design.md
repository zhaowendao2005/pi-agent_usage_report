# Adapter System Design - 中转站用量抓取系统

## 1. 概述

为 usage-report 扩展新增 **Adapter 系统**，通过控制用户浏览器抓取各 API 中转站的真实用量日志，与本地数据库记录匹配，计算实际费用。

### 1.1 核心目标

- **轻量化**：不依赖 Chromium 下载，使用 `puppeteer-core` 连接用户现有浏览器
- **免登录**：复用用户浏览器 profile，借用已登录状态
- **自包含**：Skill 内含所有脚本和 CLI，不污染全局环境
- **标准化**：定义 Adapter 接口，每个中转站一个 Adapter
- **增量同步**：首次全量，后续增量获取新记录

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────┐
│ usage-report (Pi Extension)                                 │
│  ├─ extensions/collector.ts  # 记录本地 LLM 调用            │
│  └─ skills/usage-fetcher/    # 新增：抓取中转站用量         │
│      ├─ SKILL.md             # Skill 说明文档                │
│      ├─ cli/                 # 命令行工具                    │
│      │   ├─ fetch-cli.js     # 主 CLI 入口                  │
│      │   └─ adapter-creator.js  # Adapter 脚手架生成器       │
│      ├─ lib/                 # 核心库                        │
│      │   ├─ browser-finder.js   # 检测浏览器和 Profile       │
│      │   ├─ login-checker.js    # 登录状态检测               │
│      │   ├─ traffic-analyzer.js # 网络抓包分析               │
│      │   └─ adapter-runner.js   # Adapter 运行器             │
│      ├─ templates/           # Adapter 模板                  │
│      │   └─ adapter-template.js                             │
│      └─ package.json         # 内含 puppeteer-core 依赖     │
│                                                               │
│ ~/.pi/pi-usage-report-store/  # 用户全局 Adapter 存储       │
│  ├─ openai-api/              # 示例 Adapter                 │
│  │   ├─ adapter.js           # 适配器实现                   │
│  │   ├─ config.json          # 配置（URL、选择器等）        │
│  │   └─ state.json           # 状态（最后同步时间、游标）   │
│  └─ anthropic-relay/                                         │
│      ├─ adapter.js                                           │
│      ├─ config.json                                          │
│      └─ state.json                                           │
│                                                               │
│ Tauri App                                                    │
│  └─ 价格校准页 (Price Calibration)                          │
│      ├─ 调用 Adapter 同步                                   │
│      ├─ 指纹匹配（输入/输出 token + 时间戳）                │
│      └─ 展示真实价格 vs 本地估算                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 技术选型

### 2.1 浏览器控制

**选择：`puppeteer-core` (不含 Chromium)**

```json
{
  "dependencies": {
    "puppeteer-core": "^22.0.0"  // ~2MB，不下载浏览器
  }
}
```

**优势**：
- 轻量（仅协议库）
- 通过 CDP 连接用户现有浏览器
- 支持 Edge 和 Chrome
- 自动化和抓包能力完善

**连接方式**：
```javascript
// 方式 1: 指定可执行文件路径 + User Data Dir
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  userDataDir: 'C:/Users/xxx/AppData/Local/Google/Chrome/User Data',
  headless: false  // 用户可见，便于调试和登录
});

// 方式 2: 连接已运行的浏览器（需用户启动时添加 --remote-debugging-port）
const browser = await puppeteer.connect({
  browserURL: 'http://localhost:9222'
});
```

**推荐：方式 1**，自动启动独立进程，避免用户手动配置。

### 2.2 浏览器检测

**Windows 默认路径**：
```javascript
const BROWSER_PATHS = {
  chrome: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'
  ],
  edge: [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ]
};

const USER_DATA_DIRS = {
  chrome: process.env.LOCALAPPDATA + '/Google/Chrome/User Data',
  edge: process.env.LOCALAPPDATA + '/Microsoft/Edge/User Data'
};
```

**Profile 检测**：
- Chrome 默认 Profile: `Default`
- 多 Profile: `Profile 1`, `Profile 2`, ...
- 列出 User Data Dir 下所有目录，过滤包含 `Preferences` 文件的

### 2.3 网络抓包

**使用 CDP (Chrome DevTools Protocol)**：
```javascript
const client = await page.target().createCDPSession();
await client.send('Network.enable');

client.on('Network.responseReceived', async ({ requestId, response }) => {
  if (response.url.includes('/api/usage')) {
    const body = await client.send('Network.getResponseBody', { requestId });
    // 解析 JSON，提取用量数据
  }
});
```

### 2.4 登录检测

**策略**：
1. 访问目标页面
2. 检查关键元素（如用户头像、用户名、登录按钮）
3. 检查 Cookie 或 LocalStorage 中的 token

```javascript
async function checkLogin(page, config) {
  await page.goto(config.baseUrl);
  
  // 方法 1: 检查 DOM 元素
  const loginButton = await page.$('button:has-text("Login")');
  if (loginButton) return { loggedIn: false };
  
  // 方法 2: 检查 Cookie
  const cookies = await page.cookies();
  const hasAuthCookie = cookies.some(c => c.name === 'auth_token');
  
  // 方法 3: 检查 LocalStorage
  const token = await page.evaluate(() => localStorage.getItem('token'));
  
  return { 
    loggedIn: hasAuthCookie || token,
    method: hasAuthCookie ? 'cookie' : 'localStorage'
  };
}
```

---

## 3. Adapter 接口规范

### 3.1 Adapter 文件结构

```
~/.pi/pi-usage-report-store/provider-name/
├─ adapter.js         # 核心逻辑
├─ config.json        # 配置
└─ state.json         # 运行时状态
```

### 3.2 config.json 结构

```json
{
  "name": "openai-api",
  "displayName": "OpenAI API Relay",
  "version": "1.0.0",
  "browser": "chrome",
  "profile": "Default",
  
  "urls": {
    "base": "https://api.openai-relay.com",
    "login": "https://api.openai-relay.com/login",
    "usage": "https://api.openai-relay.com/api/v1/usage"
  },
  
  "loginCheck": {
    "type": "element",
    "selector": ".user-avatar",
    "expectedText": null
  },
  
  "fetchStrategy": {
    "method": "api",
    "endpoint": "/api/v1/usage",
    "params": {
      "start": "{lastSyncTime}",
      "end": "{now}"
    },
    "pagination": {
      "type": "cursor",
      "cursorField": "next_cursor",
      "dataField": "data"
    }
  },
  
  "dataMapping": {
    "timestamp": "created_at",
    "model": "model",
    "inputTokens": "prompt_tokens",
    "outputTokens": "completion_tokens",
    "cost": "cost",
    "requestId": "id"
  }
}
```

### 3.3 state.json 结构

```json
{
  "lastSyncTime": 1708320000000,
  "cursor": "abc123",
  "totalRecords": 1523,
  "lastError": null,
  "lastErrorTime": null
}
```

### 3.4 adapter.js 接口

```javascript
/**
 * Adapter 接口 - 每个中转站需实现这些方法
 */
export default class Adapter {
  /**
   * 构造函数
   * @param {object} config - config.json 内容
   * @param {object} state - state.json 内容
   * @param {object} browser - Puppeteer Browser 实例
   */
  constructor(config, state, browser) {
    this.config = config;
    this.state = state;
    this.browser = browser;
  }

  /**
   * 检查登录状态
   * @returns {Promise<{loggedIn: boolean, message?: string}>}
   */
  async checkLogin() {
    // 实现登录检测逻辑
  }

  /**
   * 提示用户登录（打开登录页，等待用户手动登录）
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async promptLogin() {
    // 打开登录页，轮询检查登录状态
  }

  /**
   * 获取用量记录（增量或全量）
   * @param {object} options
   * @param {number} options.startTime - 起始时间戳（毫秒）
   * @param {number} options.endTime - 结束时间戳（毫秒）
   * @param {boolean} options.fullSync - 是否全量同步
   * @returns {Promise<{records: Array, cursor?: string, hasMore: boolean}>}
   */
  async fetchUsage({ startTime, endTime, fullSync }) {
    // 实现抓取逻辑
  }

  /**
   * 规范化数据格式（转换为统一格式）
   * @param {object} rawRecord - 原始记录
   * @returns {object} 标准化记录
   */
  normalizeRecord(rawRecord) {
    // 转换为统一格式
  }
}
```

**标准化记录格式**：
```javascript
{
  timestamp: 1708320000000,     // Unix 毫秒
  provider: 'openai',
  model: 'gpt-4-turbo',
  inputTokens: 1500,
  outputTokens: 800,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 0.0234,                 // USD
  requestId: 'req_abc123',      // 中转站的请求 ID
  rawData: { /* 原始 JSON */ }  // 保留原始数据供调试
}
```

---

## 4. CLI 命令设计

### 4.1 命令列表

```bash
# 1. 创建新 Adapter（脚手架）
node cli/fetch-cli.js create <provider-name>

# 2. 列出所有 Adapter
node cli/fetch-cli.js list

# 3. 检测浏览器和 Profile
node cli/fetch-cli.js detect-browser

# 4. 测试登录状态
node cli/fetch-cli.js check-login <provider-name>

# 5. 同步用量数据（增量）
node cli/fetch-cli.js sync <provider-name>

# 6. 全量同步（首次使用）
node cli/fetch-cli.js sync <provider-name> --full

# 7. 验证 Adapter 配置
node cli/fetch-cli.js validate <provider-name>
```

### 4.2 Skill 内 Agent 可用的简化命令

在 `skills/usage-fetcher/SKILL.md` 中定义：

```bash
# Agent 通过 cd 到 skill 目录后执行
node cli/fetch-cli.js <command>

# 或者定义 npm scripts（推荐）
npm run create -- openai-relay
npm run sync -- openai-relay
npm run check-login -- openai-relay
```

---

## 5. 工作流程设计

### 5.1 Agent 引导用户的标准流程

**步骤 1：环境检测**
```
Agent: "正在检测您的浏览器环境..."
执行: node cli/fetch-cli.js detect-browser
输出: 
  ✓ 检测到 Chrome (C:/Program Files/Google/Chrome/Application/chrome.exe)
  ✓ User Data Dir: C:/Users/zhaowendao/AppData/Local/Google/Chrome/User Data
  ✓ 找到 3 个 Profiles: Default, Profile 1, Profile 2
  
Agent: "请问您通常使用哪个 Profile 访问 API 中转站？"
用户: "Default"
```

**步骤 2：创建 Adapter**
```
Agent: "正在为 openai-relay 创建 Adapter..."
执行: node cli/fetch-cli.js create openai-relay
输入提示:
  - 中转站网址: https://api.openai-relay.com
  - 登录页 URL: https://api.openai-relay.com/login
  - 用量 API URL: （留空则自动抓包检测）
  
输出:
  ✓ 已创建 ~/.pi/pi-usage-report-store/openai-relay/
  ✓ 请手动编辑 config.json 完善配置
```

**步骤 3：登录检测**
```
Agent: "正在检查 openai-relay 登录状态..."
执行: node cli/fetch-cli.js check-login openai-relay
输出:
  ✗ 未检测到登录状态
  → 正在打开登录页，请在浏览器中登录...
  （自动打开浏览器窗口，导航到登录页）
  
Agent: "请在打开的浏览器窗口中登录，完成后按回车..."
用户: （登录完成，按回车）

重新检测:
  ✓ 登录成功！检测到用户: user@example.com
```

**步骤 4：抓包分析（可选，首次配置）**
```
Agent: "正在分析 API 调用，请在浏览器中访问用量页面..."
执行: 内部运行 traffic-analyzer
输出:
  → 监听网络请求中...
  ✓ 捕获到 API 调用: GET /api/v1/usage?start=...&limit=50
  ✓ 响应格式: { data: [...], next_cursor: "..." }
  ✓ 已自动更新 config.json
```

**步骤 5：首次全量同步**
```
Agent: "开始首次全量同步..."
执行: node cli/fetch-cli.js sync openai-relay --full
输出:
  → 连接浏览器...
  → 访问用量 API...
  → 获取第 1 页: 50 条记录
  → 获取第 2 页: 50 条记录
  ...
  ✓ 共同步 237 条记录
  ✓ 已保存到 ~/.pi/pi-usage-report-store/usage_fetched.db
```

**步骤 6：增量同步（后续使用）**
```
Agent: "开始增量同步..."
执行: node cli/fetch-cli.js sync openai-relay
输出:
  → 上次同步时间: 2024-02-19 10:30:00
  → 获取增量记录...
  ✓ 新增 12 条记录
  ✓ 已更新 state.json
```

### 5.2 错误处理流程

```
情况 1: 浏览器未安装
  → Agent: "未检测到 Chrome 或 Edge，请先安装浏览器"
  → 提示安装链接

情况 2: 登录超时
  → Agent: "登录等待超时（2 分钟），请重新尝试"
  → 提供重试命令

情况 3: API 格式变化
  → Agent: "抓取失败，API 响应格式与配置不符"
  → 建议重新运行抓包分析

情况 4: 网络错误
  → Agent: "网络请求失败，请检查网络连接"
  → 保存失败状态到 state.json，下次从断点恢复
```

---

## 6. 数据匹配与价格校准

### 6.1 匹配策略

**指纹生成**：
```javascript
function generateFingerprint(record) {
  return {
    timestamp: Math.floor(record.timestamp / 60000) * 60000, // 分钟级
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    tolerance: 60000  // ±1 分钟容差
  };
}
```

**匹配逻辑**：
```sql
-- 从本地 usage.db 查找匹配记录
SELECT * FROM llm_calls
WHERE model = :model
  AND input_tokens = :inputTokens
  AND output_tokens = :outputTokens
  AND ABS(started_at - :timestamp) < 60000
ORDER BY ABS(started_at - :timestamp)
LIMIT 1;
```

### 6.2 新增表结构

**usage.db 新增表**：
```sql
CREATE TABLE fetched_usage (
  id            INTEGER PRIMARY KEY,
  provider      TEXT NOT NULL,
  request_id    TEXT,           -- 中转站 request ID
  timestamp     INTEGER NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,  -- 真实费用（浮点）
  matched_call_id INTEGER,      -- 关联到 llm_calls.id
  raw_data      TEXT,           -- JSON 字符串，保留原始数据
  created_at    INTEGER NOT NULL,
  FOREIGN KEY(matched_call_id) REFERENCES llm_calls(id)
);

CREATE INDEX idx_fetched_timestamp ON fetched_usage(timestamp);
CREATE INDEX idx_fetched_matched ON fetched_usage(matched_call_id);
```

### 6.3 Tauri 价格校准页功能

**新增 Rust Command**：
```rust
#[tauri::command]
async fn sync_adapter(adapter_name: String) -> Result<SyncResult, String> {
  // 调用 CLI: node .../fetch-cli.js sync <adapter_name>
}

#[tauri::command]
async fn get_price_comparison(
  start_time: i64,
  end_time: i64
) -> Result<PriceComparison, String> {
  // 查询 llm_calls 和 fetched_usage，对比估算价格 vs 实际价格
}
```

**前端 UI 布局**：
```
┌─────────────────────────────────────────────────────┐
│ 价格校准 (Price Calibration)                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│ 已配置 Adapter:                                      │
│  ☑ openai-relay     [同步] [配置] 最后同步: 10:30   │
│  ☑ anthropic-relay  [同步] [配置] 最后同步: 昨天     │
│  ☐ gemini-api       [未配置]                        │
│                                                      │
│ [+ 添加新 Adapter]                                   │
│                                                      │
├─────────────────────────────────────────────────────┤
│ 价格对比 (过去 7 天):                                │
│                                                      │
│  估算总费用:  $12.34                                 │
│  实际总费用:  $13.56  (+9.9%)                        │
│  匹配率:      87%                                    │
│                                                      │
│  [查看明细]  [导出报告]                              │
│                                                      │
├─────────────────────────────────────────────────────┤
│ 未匹配记录 (23 条):                                  │
│  2024-02-19 10:15  gpt-4-turbo  1500/800  $0.05     │
│  2024-02-19 09:30  claude-3     2000/1200 $0.08     │
│  ...                                                 │
└─────────────────────────────────────────────────────┘
```

---

## 7. 安全与隐私

### 7.1 安全措施

1. **不存储敏感信息**：
   - 不保存密码、Token、Cookie
   - 仅借用浏览器 Profile，不导出凭据

2. **本地运行**：
   - 所有脚本在用户本地执行
   - 不上传数据到第三方服务器

3. **用户可见**：
   - 浏览器窗口默认可见（`headless: false`）
   - 用户可随时关闭浏览器中止操作

4. **数据隔离**：
   - `usage_fetched.db` 仅存储数字指标
   - 不记录对话内容、Prompt、工具输出

### 7.2 用户控制

- 用户可随时删除 `~/.pi/pi-usage-report-store/` 目录
- Adapter 状态可手动编辑 `state.json` 重置
- 提供命令清除匹配关联：`node cli/fetch-cli.js reset <provider>`

---

## 8. 开发计划

### 8.1 第一阶段：基础框架（Week 1）

- [x] 设计文档（本文档）
- [ ] 创建 `skills/usage-fetcher/` 目录结构
- [ ] 实现 `browser-finder.js`（浏览器检测）
- [ ] 实现 `fetch-cli.js` 基础框架
- [ ] 实现 `adapter-creator.js`（脚手架生成）
- [ ] 编写 Adapter 模板

### 8.2 第二阶段：核心功能（Week 2）

- [ ] 实现 `login-checker.js`（登录检测）
- [ ] 实现 `traffic-analyzer.js`（网络抓包）
- [ ] 实现 `adapter-runner.js`（Adapter 运行器）
- [ ] 实现示例 Adapter（OpenAI Relay）
- [ ] 编写单元测试

### 8.3 第三阶段：数据匹配（Week 3）

- [ ] 修改 `usage.db` Schema，添加 `fetched_usage` 表
- [ ] 实现指纹匹配算法
- [ ] 添加 Rust Command：`sync_adapter`, `get_price_comparison`
- [ ] 前端：价格校准页 UI

### 8.4 第四阶段：优化与文档（Week 4）

- [ ] 错误处理优化
- [ ] 断点续传功能
- [ ] 用户文档（SKILL.md）
- [ ] 演示视频
- [ ] 发布 v1.0

---

## 9. 技术难点与解决方案

### 9.1 难点 1：多 Profile 支持

**问题**：用户可能有多个 Chrome Profile，需选择正确的。

**解决方案**：
1. 列出所有 Profile（读取 `Local State` 文件）
2. Agent 询问用户选择
3. 在 `config.json` 中记录 `profile` 字段

### 9.2 难点 2：不同中转站的 API 差异

**问题**：每个中转站的 API 格式、分页方式不同。

**解决方案**：
1. 定义灵活的 `config.json` 配置
2. 支持多种抓包方式：
   - **方式 A**：直接调用已知 API（需 URL 和参数）
   - **方式 B**：抓包分析（用户手动触发，自动捕获）
3. Adapter 实现自定义解析逻辑

### 9.3 难点 3：登录状态失效

**问题**：用户 Cookie 过期，导致同步失败。

**解决方案**：
1. 每次同步前检查登录状态
2. 失败时提示用户重新登录
3. 支持自动重试（最多 3 次）

### 9.4 难点 4：指纹匹配准确性

**问题**：时间戳可能有偏差，Token 数可能不完全一致。

**解决方案**：
1. 使用模糊匹配（±1 分钟容差）
2. 多条件联合匹配（时间 + Model + Token）
3. 记录匹配置信度（confidence score）
4. 允许用户手动确认模糊匹配

---

## 10. 示例配置

### 10.1 OpenAI Relay Adapter

**config.json**：
```json
{
  "name": "openai-relay",
  "displayName": "OpenAI API 中转站",
  "version": "1.0.0",
  "browser": "chrome",
  "profile": "Default",
  
  "urls": {
    "base": "https://api.openai-relay.com",
    "login": "https://api.openai-relay.com/login",
    "usage": "https://api.openai-relay.com/dashboard/usage"
  },
  
  "loginCheck": {
    "type": "cookie",
    "cookieName": "session_token"
  },
  
  "fetchStrategy": {
    "method": "api",
    "endpoint": "/api/v1/billing/usage",
    "headers": {
      "Authorization": "Bearer {extractFromPage}"
    },
    "params": {
      "start_date": "{YYYY-MM-DD}",
      "end_date": "{YYYY-MM-DD}"
    },
    "pagination": {
      "type": "offset",
      "limitParam": "limit",
      "offsetParam": "offset",
      "pageSize": 100
    }
  },
  
  "dataMapping": {
    "timestamp": "timestamp",
    "model": "model",
    "inputTokens": "n_context_tokens_total",
    "outputTokens": "n_generated_tokens_total",
    "cost": "cost_in_usd"
  }
}
```

### 10.2 Claude API Adapter

**config.json**：
```json
{
  "name": "anthropic-relay",
  "displayName": "Claude API 中转",
  "version": "1.0.0",
  "browser": "edge",
  "profile": "Profile 1",
  
  "urls": {
    "base": "https://console.anthropic-relay.com",
    "login": "https://console.anthropic-relay.com/login",
    "usage": "https://console.anthropic-relay.com/usage"
  },
  
  "loginCheck": {
    "type": "element",
    "selector": ".user-menu",
    "expectedText": null
  },
  
  "fetchStrategy": {
    "method": "traffic",
    "capturePattern": "/api/usage*",
    "triggerAction": {
      "type": "click",
      "selector": "#load-more-button"
    }
  },
  
  "dataMapping": {
    "timestamp": "created_at",
    "model": "model",
    "inputTokens": "input_tokens",
    "outputTokens": "output_tokens",
    "cost": "cost_usd"
  }
}
```

---

## 11. 总结

### 11.1 核心优势

1. **轻量化**：仅依赖 `puppeteer-core`（~2MB），不下载 Chromium
2. **免登录**：复用用户浏览器 Profile，零额外配置
3. **自包含**：Skill 内含所有依赖，不污染全局环境
4. **可扩展**：Adapter 模式支持任意中转站
5. **Agent 友好**：简化操作为标准步骤，易于 Agent 引导

### 11.2 关键交互点

- **环境检测** → Agent 自动完成，用户仅确认 Profile
- **创建 Adapter** → Agent 引导填写配置
- **登录检测** → 自动打开浏览器，用户手动登录
- **首次同步** → 全量抓取，Agent 进度反馈
- **增量同步** → 自动化，无需用户干预

### 11.3 待确认问题

1. **存储位置确认**：`~/.pi/pi-usage-report-store/` 是否合适？
2. **Tauri 集成方式**：价格校准页是否作为独立 Tab？
3. **Agent 命令注册**：是否注册为 `/sync-usage <provider>` 命令？
4. **错误重试策略**：自动重试次数和间隔？

### 11.4 后续扩展

- 支持更多浏览器（Firefox、Safari）
- 支持 macOS 和 Linux
- 支持 Headless 模式（高级用户）
- 导出价格报告为 CSV/PDF
- 设置自动定时同步（cron-like）

---

**文档版本**：v1.0  
**创建日期**：2024-02-19  
**最后更新**：2024-02-19
