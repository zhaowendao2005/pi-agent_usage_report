# 鉴权系统 · 研究方案

> 现状：pi 用量监控（Tauri 2 + Vue3 + 采集扩展）。新增"用 Edge 登录态访问中转站"的能力：
> 打开 Edge 远程调试端口 → CDP 通道控制 → 封装为工具 → 通过 pi 扩展让 pi agent 调用。

---

## 1. 目标

```
中转站(需登录) ←──cookie── Edge(真实登录态)
                              ↑ CDP
                        EdgeBridge(桥接进程, HTTP API)
                              ↑ fetch
                  pi 扩展工具(edge_* / auth_*)   ← pi agent 调用
```

- 使用**用户真实的 Edge profile 登录态**（cookie），无需手动复制 token。
- Tauri 前端显示「中转站地址」「鉴权状态卡」，登录后默认主页为「明细」页。
- 模型侧用 **pi**：通过 `pi --list-models` 取模型列表，作为驱动 agent 的起点。

---

## 2. Edge 远程调试 · 研究结论（tavily 检索）

### 2.1 启动方式

```bash
msedge.exe --remote-debugging-port=9222 \
           --user-data-dir="<定制profile目录>" \
           --remote-allow-origins=* \
           --profile-directory=Default
```

- `GET http://127.0.0.1:9222/json/version` → `webSocketDebuggerUrl`（浏览器级 WS）
- `GET /json/list` → 标签页 targets（页面级 WS）
- CDP WebSocket 支持：`Page.navigate` / `Runtime.evaluate` / `Input.dispatchMouseEvent` /
  `Page.captureScreenshot` / `Network.getAllCookies` / `Storage` 等。
- （可选）`--headless=new` 可无头运行；交互登录场景保留有头窗口。

### 2.2 关键限制（Chrome 136+，Edge 同步受影响）

来自 [Chrome 官方博客](https://developer.chrome.com/blog/remote-debugging-port)：

> **默认数据目录不再接受 `--remote-debugging-port`，必须配合 `--user-data-dir` 指向非标准目录**。

即：直接 `--user-data-dir="%LOCALAPPDATA%\Microsoft\Edge\User Data"` 指向真实默认目录会**被拒绝**。

### 2.3 复用用户 Edge 登录态 · 三种方案对比

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. 拷贝 profile（推荐）** | 关闭 Edge 后将 `User Data` 拷贝到工作目录（如 `~/.pi/edge-profiles/`），调试端口指向拷贝 | 登录态（cookie/localstorage）完全保留；非标准目录故调试开关有效；拷贝含 `Local State` 加密 key，cookie 可直接解密 | 首次拷贝体积大（可只拷 `Default/` 关键文件 + `Local State`）；Edge 运行中拷贝有锁风险 |
| B. 专用 profile 手动登录 | 全新 `user-data-dir`，弹窗让用户手动登录一次，之后复用该目录 | 干净、稳定、无锁风险 | 不是"直接使用用户 profile"；多一次手动登录 |
| C. CDP cookie 注入 | 从真实 profile 的 sqlite 读 cookie，`Network.setCookie` 注入调试实例 | 无需拷贝 | Windows 上 cookie 被 DPAPI + App-Bound Encryption 加密，解密脆弱、易失效 |

**结论：方案 A 为主（精确拷贝 `Default` profile + `Local State`），B 做兜底**（A 失败/Edge 运行中用户不愿关闭时）。

### 2.4 轮询/保活

- 桥接进程写状态文件 `~/.pi/agent/edge-bridge.json`（host/port/pid/profile 状态），UI 与 pi 扩展共享。
- 崩溃/端口占用 → 自动换端口重启。

---

## 3. 模型与"ACP 通道" · 研究结论

### 3.1 ACP 是什么

- [Agent Client Protocol](https://github.com/agentclientprotocol)（Zed 主导）是"编辑器 ↔ 编码 agent"的标准，
  方向是 **agent 作为服务端**被客户端驱动。pi 目前**没有**内置 ACP 服务端/客户端。
- 我们需要的是反方向：**让 pi agent 能用我们的工具** → 正确通道是 **pi 扩展工具**（`pi.registerTool`），
  pi 明确**不内置 MCP**（README: "No MCP"），一切工具经扩展注册。

### 3.2 结论：通道选型

| 通道 | 是否可用 | 说明 |
|---|---|---|
| pi 扩展工具 `registerTool` | ✅ 推荐 | 本项目已有 `extensions/` 目录 + `pi -e ./dist` 装载；
  工具函数内 `fetch()` 调用 EdgeBridge HTTP API 即可让 pi agent 控制 Edge |
| MCP server | ⚠️ 需自己实现 | pi 不内置 MCP 客户端；mcporter 仅服务于终端用户场景 |
| ACP server | ❌ | pi 未实现 ACP，属编辑器驱动场景，方向不符 |

### 3.3 pi agent 驱动方式

- `pi --list-models` → 模型列表（供前端下拉选择"驱动 agent 的模型"，即 ACP 语境里的起点模型）。
- `pi --mode rpc` / `pi -p "..."` → 程序化调用 pi agent 完成任务（输入自然语言任务，agent 自动调 edge 工具）。
- 浏览器内"AI 助手"（ScriptEditorDrawer 已有示例）可升级为：选模型 → 派发任务给 pi agent → agent 用 edge 工具执行。

---

## 4. 总体架构

```
┌─ Tauri 前端 (Vue3) ─────────────────────────────┐
│ ConfigView: 中转站地址 / 鉴权状态卡(登录/断开/状态) │
│ PriceCalibration: 配置抽屉(原"添加脚本")          │
│ App: 登录后默认主页 = 明细(DetailView)            │
└───────────────┬──────────────────────────────────┘
                │ invoke / HTTP
┌─ Rust 后端 (Tauri) ──────────────────────────────┐
│ 启动/停止 EdgeBridge(Node sidecar) · 状态持久化    │
└───────────────┬──────────────────────────────────┘
┌─ EdgeBridge (Node 进程, 独立可跑) ────────────────┐
│ 1) 拷贝用户 Edge profile → ~/.pi/edge-profiles/   │
│ 2) 拉起 msedge --remote-debugging-port → CDP WS   │
│ 3) 封装工具:                                     │
│    auth/status · auth/login · auth/logout        │
│    tab/list · tab/new · navigate · click · type  │
│    screenshot · eval · cookies/get · cookies/set │
│ 4) HTTP API: 127.0.0.1:<port> (状态文件共享)      │
└───────────────┬──────────────────────────────────┘
                │ fetch
┌─ pi 扩展 (extensions/edge.ts) ───────────────────┐
│ registerTool: edge_status / edge_navigate /      │
│ edge_click / edge_type / edge_screenshot /       │
│ edge_eval / edge_cookies / auth_status ...       │
│ → pi agent 直接可用                              │
└──────────────────────────────────────────────────┘
```

---

## 5. 分阶段实施

- **Phase 1（本次）**：UI 先行 —— 中转站地址配置、鉴权状态卡（显示登录状态/开关）、
  "添加脚本→配置"改名、登录后主页=明细页。数据层先用 mock + localStorage，桥接就绪后切换。
- **Phase 2**：EdgeBridge 原型（Node: profile 拷贝 + 拉起 Edge + CDP 封装 + HTTP API；`GET /auth/status` 探测登录态）。
- **Phase 3**：pi 扩展工具注册（edge_* / auth_*），`pi --list-models` 接入模型选择。
- **Phase 4**：Rust 后端集成（Tauri command 管理桥接进程生命周期 + `usage_config.yaml` 持久化）+ 打包。