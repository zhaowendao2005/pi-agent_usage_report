# usage-report

Pi 扩展：在多个终端同时跑 pi 时，采集每次 LLM 调用的 **token / 缓存 / 费用 / TTFT / TPS**，写入 `~/.pi/pi-usage-report-store/usage.db`，并用 **Tauri 2** 桌面窗口做实时统计仪表盘。

## 产物与平台分发

主包很小（**~17 KB**），不含二进制；桌面二进制按平台拆成独立的 npm 包，由 npm/pnpm/yarn 依据 `os`/`cpu` 字段**自动只装当前平台那一个**。

```
usage-report                                  ← 用户安装的（编译后的扩展 JS + 解析器）
└─ optionalDependencies (os/cpu 自动筛选)
   @zhaowendao2005/usage-report-darwin-arm64
   @zhaowendao2005/usage-report-darwin-x64
   @zhaowendao2005/usage-report-win32-x64
   @zhaowendao2005/usage-report-linux-x64
   @zhaowendao2005/usage-report-linux-arm64
```

平台包**必须是有 scope 的**（和 `@esbuild/darwin-arm64`、`@swc/core-darwin-arm64`、
`@rollup/rollup-darwin-arm64` 同样的做法）：scope 绑定在账号上，npm 的反滥用启发式
不会把"短时间内连续创建多个同前缀新包"当成抢注。裸名 `usage-report-<target>`
会被判定 `403 Package name triggered spam detection`。

`dist/bin/<target>/pi-usage-monitor` 与 `packages/usage-report-<target>/` 只存在于源码检出里（本地 `file:` 安装 / 调试用），**不进 npm 包**。

运行时解析顺序（`extensions/spawn.ts`，每个候选都做二进制头校验）：

```
$PI_USAGE_MONITOR_BIN → dist/bin/<target> → @scope/usage-report-<target>/bin
→ src-tauri/target/{release,debug} → dist/<bin> → ~/.pi/…/bin/<target>
→ 从 GitHub Release 下载（校验 sha256）→ 仍失败则列出全部尝试路径报错
```

不可用的原因会写清楚，例如：`mach-o arch x64, need arm64`、`sha256 mismatch`、`HTTP 404`。

环境变量：`PI_USAGE_SKIP_DOWNLOAD=1`（离线/内网）、`PI_USAGE_DOWNLOAD_BASE=<url>`（自建镜像）、`PI_USAGE_MONITOR_BIN=<path>`（强制指定）。

## 目录结构

```
extensions/           # pi 采集端源码（TS，编译进 dist/extensions）
scripts/              # build / release / set-version / postinstall
src-tauri/
  src-web/            # Vue3 + Pinia 前端源码
  web/                # 前端构建产物（vite 输出到此，已 gitignore）
  src/                # Rust（rusqlite 只读查询 + usage_config.yaml）
  tauri.macos.conf.json  # macOS 覆盖：targets=["app"]、signingIdentity
packages/             # 构建期生成的平台载荷包（gitignore）
dist/                 # 发布产物
  extensions/         # 编译后的扩展 JS
  bin/<target>/       # 分平台二进制 + .sha256
  BUILD_INFO.json
docs/                 # 中文文档
```

`package.json` 的 `pi.extensions` 指向 `./dist/extensions`，所以**装载的是编译后的 JS**，源码 `extensions/*.ts` 只是开发输入。

## 安装与使用

```bash
# 先构建（编译扩展 + tauri 原生二进制）
pnpm build              # 当前平台
pnpm build:universal    # macOS：同时供 darwin-arm64 / darwin-x64

# 临时装载测试（仅本次运行生效，不写入 settings）
pi -e ./dist

# 或正式安装（写入 settings）
pi install ./path/to/usage_report

# 在 pi 内打开仪表盘
/usage
```

辅助命令：

```
/usage-db    # 打印数据库路径
```

## 开发

环境要求：Rust stable、Node 22+、macOS 12+ / Windows 10+（WebView2）/ Linux（WebKitGTK）。

```bash
pnpm install && npm --prefix src-tauri/src-web install

pnpm seed    # 写入测试数据到 ~/.pi/pi-usage-report-store/usage.db
pnpm dev     # Tauri 开发模式（前端热更新，端口 5893）
pnpm build   # 发布构建 → dist/extensions + dist/bin/<target>
```

### 开发版 / 生产版隔离

插件会通过模块路径自动识别运行环境（新增 `extensions/env.ts`）：

- 源码仓库 / `pi -e ./dist` / `pi install ./repo` / pnpm link → **dev**（包根目录存在 `.git` 或 `src-tauri`）
- npm 安装包 → **prod**（发布包只含 `dist/` 与 `scripts/`）
- 可用 `PI_USAGE_DEV=1` / `PI_USAGE_PROD=1` 强制指定

同一个 `pi` 进程里同时加载开发版和生产版时，**开发版自动优先**：生产版不再注册
`/usage` 命令、不 attach 采集器，因此不会重复写库或出现 `/usage:2`。落选实例会
在 stderr 打印一行 “suspended”。实现见 `extensions/env.ts` 的进程内 leader 选举。

开发模式下 `/usage` 只使用本地二进制（`src-tauri/target/debug` → `target/release`），
**不会下载线上发布版**。推荐直接用 `pnpm dev` 启动带热更新的仪表盘；若单独启动
`target/debug` 二进制，需要 Vite 5893 端口在运行。

### macOS 打包说明

- 只产出 `.app`（不产 dmg）：插件是 `spawn` 直接启动二进制，不需要安装步骤。
- 默认 **ad-hoc 签名**，`codesign -d -r-` 会看到 `designated => cdhash ...`，即每次重编都是一张“新身份”。本应用不申请任何 TCC 权限，因此无影响；若将来需要（摄像头/屏幕/自动化等），用稳定证书构建：
  ```bash
  APPLE_SIGNING_IDENTITY="<证书 CN>" pnpm build
  ```
  这样 DR 变成 `identifier + certificate leaf`，重编不再丢失授权。
- 数据全部在 `~/.pi/pi-usage-report-store/`（**不在 app 内、不在 node_modules**），升级/卸载/换安装方式都不会丢。

## 发布流程（本地 push → 云端构建 → 人工闸门 → npm）

**版本号只由 `package.json` 决定**，CI 永不改版本；CI 只校验 `tag vX.Y.Z == package.json.version`。

```bash
# 0) 一次性配置（GitHub 网页）
#    Settings → Secrets and variables → Actions → NPM_TOKEN（Automation 类型）
#    （不需要 Environment、不需要人工批准：tag 推上去就自动构建并发布）

# 1) 改代码、提交、推送（手动）
git add -A && git commit -m "feat: ..." && git push
#    → 触发 .github/workflows/ci.yml（typecheck + 前端构建 + cargo check）

# 2) 定版本（仅改版本号，三处同步：主包 / optionalDependencies / 平台包）
pnpm set-version 0.1.2
git add -A && git commit -m "chore(release): v0.1.2" && git push

# 3) 一条命令发布
pnpm release            # 预检 → 打 tag → push tag（CI 构建 + 自动发布，无需点击）
pnpm release --dry-run  # 只跑预检
pnpm release --watch    # 顺便跟踪 Actions（需 gh）
```

预检会拦住：工作区脏、有未推送的 commit、**HEAD 的 CI 不是绿的**、tag 已存在、该版本已在 npm 上（npm 版本不可覆盖）、tarball 里出现意外的文件。

云端流水线（`.github/workflows/release.yml`，tag 触发）：

```
guard   tag == package.json && 该版本未发布
  └─ build   matrix: macos-14(universal) / windows-latest / ubuntu-22.04
  │          只上传 artifacts（全世界唯一的二进制产地）
  └─ publish 下载 build 的 artifacts → 扩展 JS 从本 tag 重编
  │          → npm publish 5 个平台包 → 再发主包（顺序不可反）
  └─         → gh release create（同样的二进制，给下载兜底用）
```

只重发、不重编（npm 半途失败时）：

```bash
pnpm release --publish-only v0.1.2      # = gh workflow run publish-retry.yml -f tag=v0.1.2
```

`scripts/publish.mjs` 是幂等的：已发布的包自动跳过，所以可以放心重跑。

### 发错了怎么办（npm 版本不可覆盖）

```bash
npm dist-tag add usage-report@<上一个好版本> latest   # 立刻让所有人都装回旧版
pnpm set-version <新版本> && git commit -am "fix: ..." && git push && pnpm release
```

### 首次发布前必做

- 把 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 提交（CI 用 `--frozen-lockfile`）；
- 配好 `NPM_TOKEN`；
- `package.json` 的 version 必须是 npm 上尚未发布的版本。

## 架构

```
多个 pi 终端
  └─ extensions/ 采集 ──写入──► ~/.pi/pi-usage-report-store/usage.db
                                      ▲ 只读
Tauri 窗口（Rust invoke + 系统 WebView2）
  └─ 前端：src-tauri/src-web 构建进 src-tauri/web
  └─ UI 选项：~/.pi/pi-usage-report-store/usage_config.yaml
```

| 组件 | 路径 | 运行时 |
|---|---|---|
| 采集扩展 | `extensions/` | pi 进程内 Node（`node:sqlite`） |
| 桌面壳 | `src-tauri/` | Tauri 2 + rusqlite |
| 前端 | `src-tauri/src-web/` → `src-tauri/web` | Vue3 + Pinia + ECharts |
| 数据库 | `~/.pi/pi-usage-report-store/usage.db` | SQLite WAL |
| UI 配置 | `~/.pi/pi-usage-report-store/usage_config.yaml` | 统计页小选项持久化 |

默认 UI：时间范围 **过去 24h → 实时**，**LIVE 模式开启**。

## 文档

- [数据模型](docs/data-model.md) — 表结构、字段来源、写入策略
- [API 契约](docs/api-contract.md) — Tauri 命令与数据结构

## 许可证

MIT
