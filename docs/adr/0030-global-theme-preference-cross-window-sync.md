# 0030. 应用主题偏好跨窗口同步与运行中 PTY 颜色尽力跟随

**状态**：提议（grill 共识，待实现）

## 背景

全局 Settings 的 Light / Dark / System 主题偏好存于本机 `localStorage`，由各窗口的 `I18nProvider` 在挂载时读取。多项目多窗口时，某一窗口修改主题只更新本窗 React 状态与 `document.documentElement.dataset.theme`，其它已打开窗口不会同步。

终端路径上，解析后的主题经 `set_app_theme` 写入进程内 `PtySessionManager`，仅影响后续 spawn 的 `COLORFGBG` 与 OSC 10/11/12 应答；已运行的 Codex/Claude TUI 不会自动重探颜色，底部 composer 等自适应 truecolor 区域常落后于 UI 主题。

## 决定

1. **单一写入路径**：扩展 `set_app_theme`，入参同时携带 `themePreference`（light/dark/system）与已解析 `theme`（light/dark）。一次调用完成：更新 PTY 主题状态、尽力向已运行 PTY 推送颜色变更通知、并 `app.emit` 主题偏好变更事件。
2. **跨窗同步**：所有带 `I18nProvider` 的应用窗口（项目窗、会话监控窗等）订阅该事件；接收方以 `themePreference` 更新本地状态与 localStorage 展示一致性，本地再解析 `system`。发送方与接收方须避免环路（同值不重发）。
3. **范围本期只做主题**：语言 / 字号 / 通知提醒不在本 ADR 范围，即使它们有相同的「只改当前窗」形态。
4. **运行中 session**：xterm 主题随各窗 `theme` 更新；后端对已运行 PTY 尽力写回 OSC 10/11/12 颜色报告。不重建 terminal surface，不承诺所有 TUI 必重绘；新开 session 必须完全正确。

## 后果

- `set_app_theme` 从「仅终端背景」升级为应用级主题同步入口（契约表已提示语义属应用级）。
- 新增全局事件须登记 `docs/architecture-design/tauri-contract.md`，并补前端 listener 释放与序列测试。
- OSC 主动推送与仅应答查询并存；若某 CLI 忽略非查询路径报告，composer 仍可能滞后直至其自行重探。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 仅 `storage` 事件 | Tauri 多 webview 可靠性差，且不覆盖 PTY 侧 |
| 主题与 PTY 拆成两个 command | 双写易漏窗、漏终端 |
| 切换主题时重建 xterm | 闪屏 / 丢缓冲 / 体验差 |
| 同批修全部全局偏好跨窗 | 超出本 issue 范围 |

## 代码事实来源

- 本决策：`docs/adr/0030-global-theme-preference-cross-window-sync.md`
- 现有：`src/shared/i18n/i18n-provider.tsx`、`src/shared/commands/app-commands.ts`、`src-tauri/src/features/project_terminal/commands.rs`、`src-tauri/src/agent/pty_osc_color_reply.rs`
- 契约：`docs/architecture-design/tauri-contract.md`
