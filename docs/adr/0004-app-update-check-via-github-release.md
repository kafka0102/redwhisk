# ADR 0004：应用版本检测走 GitHub Release 外链引导

## 状态

已采纳。

## 背景

RedWhisk 通过 tag（`v*.*.*`）触发 GitHub Actions 构建 macOS Universal 包，并创建 **draft** Release；人工审核后 Publish 才对外可见。需要「版本检测与更新」能力，但当前产物 **未配置 Apple 签名与公证**，且产品阶段仍为 `0.0.x`。

可选路径包括：仅检测并打开 Release 页、应用内下载安装包、以及 Tauri Updater 应用内替换二进制。

## 决定

1. **只做检测 + 外链引导，不做应用内安装或自动替换。** 发现可用更新后，用系统浏览器打开已发布的 GitHub Release 页，由用户自行下载 `.dmg` / `.app.zip`。
2. **「可用更新」的唯一事实源是** `GET /repos/kafka0102/redwhisk/releases/latest`（仅已 Publish 的 latest；draft 与未 Publish 的 tag **不**构成可用更新）。生产环境仓库标识写死，测试可注入。
3. **版本比较使用 SemVer**（比较前去掉 tag 的 `v` 前缀）。仅当 `latest > current` 时存在可用更新；本地版本 ≥ latest 时视为无更新。
4. **检测与偏好策略集中在 Rust command + SQLite**，前端只展示与触发操作：启动时异步检查（失败静默）、全局设置「关于」页可强制刷新；结果缓存 TTL 默认 1 小时。
5. **版本提醒**仅出现在 Workbench 顶栏右侧（非模态 tag）；支持「7 天内不再提醒」与「忽略此版本」。多窗口通过 Tauri event 同步 UI 状态。Project Home 不展示版本提醒。
6. **本阶段不引入** `tauri-plugin-updater`，也不以签名/公证作为检测能力的前置条件。

## 后果

- 发版流程可保持「CI 出 draft → 人工 Publish」；Publish 之前用户不会被提示更新。
- 用户更新体验依赖手动安装；Gatekeeper / 未签名包问题仍按现有发布说明处理，不由更新模块解决。
- 日后若升级到应用内自动更新，可复用「可用更新」判定、提醒 UI 与忽略/冷却偏好，主要替换「打开 Release」为下载校验安装，并需补签名与 updater 产物。
- 新增 SQLite 状态（冷却、忽略版本、检查缓存）与 command/event 边界，须同步 migration、DTO 与测试。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 应用内下载并协助安装 | 复杂度高于当前阶段收益；仍非静默替换 |
| Tauri Updater 自动替换 | 强依赖签名与 updater 产物；未签名 macOS 体验差 |
| 以最新 git tag 为事实源 | 与 draft 人工审核流程冲突，会提示未对外版本 |
| 自建 `update.json` manifest | 路径 A 多余运维面 |
| 仅设置页手动检查 | 多数用户长期看不到更新 |

## 事实来源

- 发版约定：`docs/standards/release-workflow.md`、`.github/workflows/release.yml`
- 领域语言：`CONTEXT.md`（可用更新、版本提醒、版本提醒冷却、忽略版本）
- 顶栏锚点：`src/app/app-shell.tsx`（`workbench__header` + `ProjectSwitcher`）
- 全局设置：`src/features/settings/global-settings-activity.tsx`
