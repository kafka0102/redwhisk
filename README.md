# RedWhisk

> **警告**
> RedWhisk 目前仍处于开发阶段，功能、数据结构和工作流都可能发生变化。请勿将本软件用于正式环境或关键生产项目。

RedWhisk(红拂) 是一款以 Issue 为核心的 AI Coding 本地工作台。它支持通过 Git Worktree 并行执行多个开发任务，并可接入 Codex、Claude Code 等 AI Coding 工具，让不同 Issue 在隔离的工作区中同时推进，从而提升开发效率。

## 系统支持

当前主要支持 macOS。

## 直接下载

若只需使用应用、无需本地编译，请到 [GitHub Releases](https://github.com/kafka0102/redwhisk/releases) 下载最新版本。

首次打开未签名应用时，请参考下方「Release 安装提示」。

## 安装依赖

```bash
pnpm install --frozen-lockfile
```

## 本地开发

```bash
pnpm tauri dev
```

## 本地 Build

推荐使用项目内置的 macOS 打包命令：

```bash
pnpm build:macos
```

构建完成后，可执行文件位于：

```text
src-tauri/target/universal-apple-darwin/release/bundle/macos/RedWhisk.app
```

`macos/` 目录包含构建出的 Universal `RedWhisk.app`，同时支持 Intel 与 Apple Silicon。安装包（dmg）实测存在问题，已从构建流程中移除。

## Release 安装提示

从 Release 下载的应用目前未进行 Apple 开发者签名。首次打开时，macOS 可能会拦截直接双击启动；请在 Finder 中右键点击应用，选择“打开”，再在系统提示中确认打开。
