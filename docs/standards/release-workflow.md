# 发布与打包规范

## 目标

本文档定义 RedWhisk 的版本号管理、本地 Mac 打包与 tag 触发自动发布流程，适用于人工发版、本地构建产物与 GitHub Actions 自动发布。

本文档只负责"发布与打包流程"，不负责 commit message、分支模型或编码风格。提交规范以 [Git 工作流规范](./git-workflow.md) 为准。

当前仓库已包含以下发版基础设施：

- `scripts/build-macos.sh`：本地构建 Universal Mac 安装包。
- `scripts/bump-version.mjs`：统一同步多文件版本号。
- `package.json` 暴露 `build:macos` 与 `bump-version` 两个根脚本入口。
- `.github/workflows/release.yml`：tag 触发的自动发布工作流。
- `src-tauri/tauri.conf.json` 的 `bundle.targets` 配置为 `["app", "dmg"]`。
- `src-tauri/Cargo.toml` 配置了 `[profile.release]` 体积优化。

## 适用范围

适用于以下操作：

- 升级 RedWhisk 版本号
- 在本地构建 Mac 安装包
- 创建并推送 tag 触发自动发布
- 审核 GitHub Release 与发布产物

不自动授权以下操作（与 [Git 工作流规范](./git-workflow.md) 一致）：

- `git tag`
- `git push` 推送 tag
- 在 GitHub 上 Publish Release

以上操作仅在用户明确要求时执行。

## 版本号管理

### 版本号位置

RedWhisk 的版本号当前在以下文件中维护：

- `package.json` 的 `version` 字段
- `src-tauri/tauri.conf.json` 的 `version` 字段
- `src-tauri/Cargo.toml` 的 `[package].version` 字段
- `src-tauri/Cargo.lock` 中 `redwhisk` 条目的 `version`（由 cargo 自动同步，不要手改）

### 统一升级

必须遵守：

- 升级版本号时使用 `pnpm bump-version <version>`，一次性同步三处源文件版本号
- 脚本内部会调用 `cargo update -p redwhisk --precise <version>` 自动同步 `Cargo.lock`
- 不得只手改其中一处文件，避免多处版本号漂移

版本号格式必须匹配 `x.y.z` 或 `x.y.z-后缀`（如 `0.2.0`、`1.0.0-rc.1`）。脚本对非法格式会报错退出。

示例：

```bash
pnpm bump-version 0.2.0
```

## 本地构建 Mac 安装包

### 命令

```bash
pnpm build:macos
# 或直接调用脚本
./scripts/build-macos.sh
```

### 产物

`pnpm build:macos` 构建的是 Universal 包，单个产物同时支持 Intel（x86_64）与 Apple Silicon（aarch64）：

- `src-tauri/target/universal-apple-darwin/release/bundle/dmg/RedWhisk_<version>_universal.dmg`
- `src-tauri/target/universal-apple-darwin/release/bundle/macos/RedWhisk.app`

### 脚本流程

`scripts/build-macos.sh` 按顺序执行：

1. `rustup target add aarch64-apple-darwin x86_64-apple-darwin`（幂等，已安装会跳过）
2. `pnpm install --frozen-lockfile`
3. `pnpm tauri build --target universal-apple-darwin`（Tauri 自动编译双架构并 `lipo` 合并）
4. 打印产物路径

任意步骤失败脚本立即退出。首次执行需要编译两份 Rust 产物，耗时较长（通常 15–25 分钟），后续增量构建会显著加快。

### 本地构建的限制

当前本地构建产出的是 **ad-hoc 签名** 包：

- 不带 Apple Developer 证书签名
- 未经过 notarization
- 用户首次打开需右键 → 打开，或执行 `xattr -dr com.apple.quarantine /Applications/RedWhisk.app`

需要完整签名与公证的版本请通过 tag 触发 CI 发布（见下文），并在 GitHub Secrets 中配置 Apple 凭据（当前未配置，CI 同样产出未签名包）。

## Tag 触发自动发布

### 触发条件

向 GitHub 推送符合 `v*.*.*` 格式的 tag 会触发 `.github/workflows/release.yml` 的 `release-macos` job：

- 例：`v0.1.0`、`v1.2.3`、`v0.2.0-rc.1`
- 不符合 `v*.*.*` 前缀的 tag 不会触发

### 发布流程

发版操作按 [Git 工作流规范](./git-workflow.md) 属于"不自动授权"操作，必须由用户明确要求。完整流程：

```bash
# 1. 升级版本号（同步 package.json / tauri.conf.json / Cargo.toml / Cargo.lock）
pnpm bump-version 0.1.0

# 2. 提交版本号改动
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: 升级版本号至 0.1.0"

# 3. 创建并推送 tag（这一步触发 GitHub Actions）
git tag v0.1.0
git push origin v0.1.0
```

### CI 行为

`release-macos` job 在 `macos-latest` 上执行：

1. 安装 pnpm 9、Node 20、Rust stable 与两个 Apple target
2. `pnpm install --frozen-lockfile`
3. `pnpm tauri build --target universal-apple-darwin`
4. 上传构建产物为 workflow artifact（保留构建历史）
5. 通过 `softprops/action-gh-release@v2` 创建 **draft** Release 并附带 `.dmg`
6. 启用 `generate_release_notes: true`，自动按 commit 历史生成 changelog

发布后产物为 **draft** 状态，需要人工审核 changelog 与产物后，在 GitHub Releases 页面点 Publish 才对外可见。

### PR 构建检查

`.github/workflows/release.yml` 还配置了 `check` job，在 PR 到 `main` / `devlop` 时触发：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`（前端构建）
- `cd src-tauri && cargo check --all-targets`

PR 检查不产出 dmg，主要用于防止发版前出现基础构建回归。

## 核心原则

### 1. 版本号单一来源

必须遵守：

- 升级版本号只通过 `pnpm bump-version <version>`，不手改多处
- tag 命名必须与 `package.json` 的 `version` 一致（tag 带 `v` 前缀，version 不带）
- tag 推送前确认版本号已同步至所有文件

禁止：

- 手动单点修改某个文件版本号
- tag 与 `package.json` 版本号不一致
- 复用已存在的 tag 名

### 2. 产物对外可见操作需显式授权

必须遵守：

- 推送 tag 前需用户明确要求（创建 Release 属于对外可见操作）
- CI 产出的 Release 默认是 draft，需人工审核后发布
- 未签名包首次发布时，应在 Release 描述中写明 Gatekeeper 提示

禁止：

- 未经用户授权推送 tag 或发布 Release
- 在未配置 Apple 签名凭据时声称产物"已签名"或"已公证"

### 3. 产物格式固定为 Universal

必须遵守：

- 本地构建与 CI 发布都使用 `universal-apple-darwin` target
- 单个 dmg 同时支持 Intel 与 Apple Silicon，不让用户选架构

如未来需要分架构产出（减小体积），应作为独立任务更新本文档。

## 升级签名与公证（未来计划）

当前未配置 Apple Developer 证书，所有产物为未签名包。未来升级到完整签名 + 公证时：

1. 在 GitHub Secrets 配置 `APPLE_CERTIFICATE`、`APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_PASSWORD`
2. 在 `release-macos` job 的 build 步骤后追加 `codesign --deep --options runtime` 与 `xcrun notarytool submit` 步骤
3. workflow 整体结构不变，无需重新设计
4. 升级完成后更新本文档"本地构建的限制"与"产物对外可见操作"小节
