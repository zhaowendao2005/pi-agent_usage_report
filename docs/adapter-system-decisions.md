# Adapter System - 关键决策与待确认项

## ✅ 已确定的设计决策

### 1. 技术栈
- **浏览器控制**：`puppeteer-core`（~2MB，不含 Chromium）
- **连接方式**：指定可执行文件路径 + User Data Dir
- **抓包方式**：Chrome DevTools Protocol (CDP)
- **脚本语言**：JavaScript（假设用户有 Node.js）

**理由**：
- puppeteer-core 轻量，不需要下载 Chromium
- 直接连接用户现有浏览器（Edge/Chrome）
- CDP 原生支持网络抓包，无需额外依赖

### 2. 目录结构

```
usage-report/
├─ skills/usage-fetcher/           # Skill 自包含目录
│   ├─ SKILL.md                    # Agent 使用说明
│   ├─ package.json                # 依赖：puppeteer-core
│   ├─ cli/                        # 命令行工具
│   ├─ lib/                        # 核心库
│   └─ templates/                  # Adapter 模板
│
~/.pi/pi-usage-report-store/       # 用户全局 Adapter 存储
├─ openai-relay/
│   ├─ adapter.js
│   ├─ config.json
│   └─ state.json
└─ anthropic-relay/
    ├─ adapter.js
    ├─ config.json
    └─ state.json
```

**理由**：
- Skill 包含所有工具，不污染全局环境
- Adapter 存储在 pi 全局目录，跨项目共享
- 配置与代码分离，便于修改

### 3. Adapter 接口

**标准方法**：
- `checkLogin()` - 检查登录状态
- `promptLogin()` - 引导用户登录
- `fetchUsage()` - 获取用量记录（增量/全量）
- `normalizeRecord()` - 规范化数据格式

**配置驱动**：
- `config.json` - URL、选择器、API 参数
- `state.json` - 运行时状态（最后同步时间、游标）

**理由**：
- 接口统一，易于扩展新中转站
- 配置驱动降低代码复杂度
- 状态持久化支持断点续传

### 4. 数据匹配策略

**指纹**：
- 时间戳（分钟级，±1 分钟容差）
- Model 名称
- 输入/输出 Token 数

**新增表**：`fetched_usage`
- 存储从中转站获取的真实费用
- 通过 `matched_call_id` 关联到 `llm_calls`

**理由**：
- 多条件匹配提高准确性
- 保留原始数据便于调试
- 不修改现有表结构，向下兼容

### 5. 操作流程（Agent 引导）

```
1. 环境检测 → 自动识别浏览器和 Profile
2. 创建 Adapter → 交互式填写配置
3. 登录检测 → 自动打开浏览器，用户手动登录
4. 首次全量同步 → Agent 执行 CLI 命令
5. 增量同步 → 后续自动化
```

**关键点**：
- 步骤少（5 步）
- 自动化程度高（Agent 执行 CLI）
- 用户仅需：选择 Profile + 手动登录

---

## ❓ 需要确认的问题

### 问题 1：Adapter 存储位置

**当前方案**：`~/.pi/pi-usage-report-store/`

**替代方案**：
- `~/.pi/agent/usage-report/adapters/`
- `~/.pi/extensions/usage-report/adapters/`

**考虑因素**：
- 是否应该放在 `.pi/agent/` 下，与 `usage.db` 在同一层级？
- 目录名是否合适？（`pi-usage-report-store` vs `usage-adapters`）

**你的选择**：_______________当前 且所有的pi-usage依赖的持久化相关文件都放在这个里面 计划包含移动和相关路径变动 不保留兼容

---

### 问题 2：浏览器窗口可见性

**当前方案**：`headless: false`（窗口可见）

**理由**：
- 用户可看到操作过程，增加信任
- 登录时需要用户交互
- 便于调试

**替代方案**：
- 登录时可见，抓取时隐藏
- 提供配置选项（高级用户可选 headless）

**你的选择**：_______________没问题

---

### 问题 3：Agent 命令注册

**当前方案**：Agent 通过 CLI 执行
```bash
cd skills/usage-fetcher
node cli/fetch-cli.js sync openai-relay
```

**替代方案**：注册为 pi 命令 
```
/sync-usage openai-relay
/create-adapter openai-relay
/check-login openai-relay
```

**考虑因素**：
- CLI 方式更灵活，Agent 可完全控制
- 注册命令更用户友好，但需要在 `extensions/index.ts` 中实现
- 命令较多（7 个），可能占用命名空间

**你的选择**：_______________就cli执行 使用js

---

### 问题 4：Tauri 价格校准页集成

**当前方案**：在 Tauri 应用中新增 Tab "价格校准" 当前已有价格校准页 我们计划调整为符合我们需求并废弃一部分 你需要观察对应vue来决策

**功能**：
- 列出已配置 Adapter
- 一键同步按钮
- 价格对比图表（估算 vs 实际）
- 未匹配记录列表

**替代方案**：
- 独立窗口（不影响现有 Dashboard）
- 命令行输出（纯终端，不修改 Tauri）

**考虑因素**：
- 是否需要可视化界面？
- Tauri 集成工作量（新增 Rust Command + 前端页面）

**你的选择**：_______________

---

### 问题 5：错误重试策略  

**当前方案**：
- 登录检测失败：提示用户重新登录，不自动重试
- 网络请求失败：自动重试 3 次，指数退避（1s, 2s, 4s）
- API 格式错误：记录错误，提示重新配置

**替代方案**：
- 更激进：所有错误都自动重试
- 更保守：所有错误都停止，等待用户确认

**你的选择**：_______________就这样

---

### 问题 6：Profile 选择方式

**场景**：用户有多个 Chrome Profile

**当前方案**：
1. 列出所有 Profile
2. Agent 询问用户：「您通常使用哪个 Profile 访问中转站？」
3. 用户输入：`Default` 或 `Profile 1` 

**替代方案**：
- 尝试所有 Profile，自动检测哪个已登录
- 让用户手动编辑 `config.json` 的 `profile` 字段

**考虑因素**：
- 交互次数（用户操作多少步）
- 准确性（自动检测可能误判）

**你的选择**：_______________

---

### 问题 7：首次配置复杂度

**场景**：新用户首次创建 Adapter

**当前方案（交互式）**：
```
Agent: 请输入中转站网址
用户: https://api.openai-relay.com
Agent: 请输入登录页 URL（留空则使用 /login）
用户: （直接回车）
Agent: 是否需要自动抓包分析 API？(y/n)
用户: y
Agent: 正在打开浏览器，请访问用量页面...
（自动捕获 API 调用，生成 config.json）
```

**替代方案（模板驱动）**：
```
Agent: 请选择中转站类型：
  1. OpenAI 兼容（通用）
  2. Anthropic 兼容
  3. 自定义（需手动配置）
用户: 1
Agent: 已创建配置，请编辑 config.json 填写 URL
```

**考虑因素**：
- 交互式：用户体验好，但实现复杂
- 模板驱动：快速启动，但灵活性差
 
**你的选择**：_______________ 交互式 当然用户一口气提供所有的信息也可以直接工作

---

## 📋 实现优先级建议

### P0（核心功能，必须实现）
1. ✅ 浏览器检测（`browser-finder.js`）
2. ✅ Adapter 创建脚手架（`adapter-creator.js`）
3. ✅ 登录检测（`login-checker.js`）
4. ✅ 基础 CLI（`fetch-cli.js`）
5. ✅ Adapter 运行器（`adapter-runner.js`）
6. ✅ 示例 Adapter（OpenAI Relay）

### P1（重要功能，第一版应包含）
1. ⏱ 网络抓包分析（`traffic-analyzer.js`）
2. ⏱ 数据匹配算法
3. ⏱ `fetched_usage` 表创建和写入
4. ⏱ 增量同步（基于 `state.json`）

### P2（增强功能，后续迭代）
1. 📦 Tauri 价格校准页 UI
2. 📦 断点续传（网络中断恢复）
3. 📦 自动定时同步
4. 📦 多 Adapter 并行同步

---

## 🎯 下一步行动

**请确认以上 7 个问题的答案**，然后我们开始实现：

1. **如果全部确认**：
   - 我将创建完整的目录结构
   - 实现 P0 核心功能
   - 提供测试用例

2. **如果有修改**：
   - 请指出需要调整的设计
   - 我将更新设计文档
   - 然后再开始实现

3. **如果需要更多细节**：
   - 请提出具体问题
   - 我将补充设计文档相应章节

---

**备注**：
- 完整设计参见 [`adapter-system-design.md`](./adapter-system-design.md)
- 数据模型参见 [`data-model.md`](./data-model.md)
