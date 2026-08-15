# usage-report

Pi 扩展：在多个终端同时跑 pi 时，采集每次 LLM 调用的 **token / 缓存 / 费用 / TTFT / TPS**，写入 `~/.pi/agent/usage.db`，并用 **Tauri 2** 桌面窗口做实时统计仪表盘。

## 产物体积

`dist/pi-usage-monitor.exe` 约 **4.4MB**（使用系统 WebView2，不内嵌 Bun / Chromium）。`dist/` 是自包含产物：**编译后的扩展 JS + 桌面 exe**，直接可作为 pi 包安装/临时装载。

## 目录结构

```
extensions/     # pi 采集端源码（TS，编译进 dist/extensions）
demo/           # Vue3 前端源码
src-tauri/      # Tauri 桌面壳
  web/          # 前端构建产物（vite 输出到此，已 gitignore）
  src/          # Rust（rusqlite 只读查询）
dist/           # 发布产物（自包含）
  extensions/   # 编译后的扩展 JS（index/collector/db/spawn）
  pi-usage-monitor.exe
  BUILD_INFO.json
docs/           # 中文文档
```

`package.json` 的 `pi.extensions` 指向 `./dist/extensions`，所以**装载的是编译后的 JS**，源码 `extensions/*.ts` 只是开发输入。

## 安装与使用

```bash
# 先构建（编译扩展 + tauri exe）
npm run build

# 临时装载测试（仅本次运行生效，不写入 settings）
pi -e ./dist

# 或正式安装（写入 settings）
pi install ./path/to/usage_report

# 在 pi 内打开仪表盘
/usage

# 或直接双击
dist/pi-usage-monitor.exe
```

辅助命令：

```
/usage-db    # 打印数据库路径
```

## 开发

环境要求：Rust stable、Node 22+、Windows WebView2 Runtime（Win11 一般自带）。

```bash
npm install && npm --prefix demo install

npm run seed    # 写入测试数据到 ~/.pi/agent/usage.db
npm run dev     # Tauri 开发模式（前端热更新）
npm run build   # 发布构建 → dist/extensions（编译）+ dist/pi-usage-monitor.exe
```

## 架构

```
多个 pi 终端
  └─ extensions/ 采集 ──写入──► ~/.pi/agent/usage.db
                                      ▲ 只读
Tauri 窗口（Rust invoke + 系统 WebView2）
  └─ 前端：demo/ 构建进 src-tauri/web
```

| 组件 | 路径 | 运行时 |
|---|---|---|
| 采集扩展 | `extensions/` | pi 进程内 Node（`node:sqlite`） |
| 桌面壳 | `src-tauri/` | Tauri 2 + rusqlite |
| 前端 | `demo/` → `src-tauri/web` | Vue3 + ECharts |
| 数据库 | `~/.pi/agent/usage.db` | SQLite WAL |

## 文档

- [数据模型](docs/data-model.md) — 表结构、字段来源、写入策略
- [API 契约](docs/api-contract.md) — Tauri 命令与数据结构

## 许可证

MIT
