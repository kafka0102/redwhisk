# RedWhisk

> **警告**
> RedWhisk 目前仍处于开发阶段，功能、数据结构和工作流都可能发生变化。请勿将本软件用于正式环境或关键生产项目。

RedWhisk(红拂) 是一款以 Issue 为核心的 AI Coding 本地工作台。它支持通过 Git Worktree 并行执行多个开发任务，并可接入 Codex、Claude Code 等 AI Coding 工具，让不同 Issue 在隔离的工作区中同时推进，从而提升开发效率。

## 系统支持

当前主要支持 macOS。

## 直接下载

若只需使用应用、无需本地编译，请到 [GitHub Releases](https://github.com/kafka0102/redwhisk/releases) 下载最新版本。

Release 附件同时提供：

- **DMG**（推荐）：`RedWhisk_<version>_universal.dmg`
- **`.app.zip`**：解压后得到 `RedWhisk.app`

产物为 **Universal** 包：同一份同时支持 Apple Silicon（aarch64）与 Intel（x86_64）。

## 安装与首次打开

当前发布产物 **未配置 Apple 开发者证书签名，也未经过 notarization（公证）**。macOS Gatekeeper 可能拦截首次打开，这是预期行为，不等于安装包损坏。

### 推荐：使用 DMG

1. 打开下载的 `RedWhisk_<version>_universal.dmg`
2. 将 `RedWhisk.app` 拖到「应用程序」
3. 弹出 DMG 镜像（可选）

### 首次打开（未签名包）

按下列顺序尝试：

1. **右键打开**：在 Finder 中右键 `RedWhisk.app` → 选择「打开」→ 在对话框中再次确认打开。
2. **系统设置放行**：若仍被拦截，打开「系统设置」→「隐私与安全性」，在下方找到被阻止的 RedWhisk，点击「仍要打开」。
3. **清除隔离属性（quarantine）**：若提示「已损坏，无法打开」或持续无法启动，在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/RedWhisk.app
```

然后再从「应用程序」启动。

> 上述步骤适用于没有 Apple 开发者账号、无法完成正式签名与公证的分发场景。配置签名与公证后，多数用户将不再需要这些绕过步骤。

## 源码安装

### 安装依赖

```bash
pnpm install --frozen-lockfile
```

### 本地开发

```bash
pnpm tauri dev
```

### 本地 Build

推荐使用项目内置的 macOS 打包命令：

```bash
pnpm build:macos
```

该命令会先构建 Universal `.app`，再基于 `.app` 生成 Universal DMG。构建完成后产物位于：

```text
src-tauri/target/universal-apple-darwin/release/bundle/macos/RedWhisk.app
src-tauri/target/universal-apple-darwin/release/bundle/dmg/RedWhisk_<version>_universal.dmg
```

其中 `<version>` 与 `src-tauri/tauri.conf.json` 的 `version` 一致。

日常 `pnpm tauri build` 默认仍只产出 `.app`（`bundle.targets` 仅含 `app`），避免默认路径踩 macOS 上 Tauri 原生 DMG bundler 的问题。完整安装包请使用 `pnpm build:macos`。发版流程与未签名限制见 [发布与打包规范](docs/standards/release-workflow.md)；为何用仓库脚本打 DMG 见 [ADR 0026](docs/adr/0026-macos-dmg-via-repo-script.md)。
