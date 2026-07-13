# Proposal: 全局偏好新增通知提醒与 running 状态切出钩子

## Why

当前 issue 进入三审（`running` → `review`）时，前端无任何感知信号：用户若未盯屏，无法及时知道 agent 已跑完、需要自己审查。现有 agent session 通知系统只覆盖 session 级 `running` → `closed`/`crashed`，不覆盖 issue 级 `running` → `review`，且只发系统通知/应用内浮窗，无声觉提醒。

需要一个全局可控的"通知提醒"开关：开启后，issue 从 `running` 切到 `review` 时播放提示音，让用户在脱离盯屏时也能被清晰提醒。同时把"issue 从 running 切到其他状态"的切换过程封装为异步钩子，使通知音等副作用集中、可扩展，便于后续追加其他状态切出行为。

## What Changes

- **全局偏好新增"通知提醒"项**：位于 Global Settings → Preferences，紧随"内容字号"下方；label 旁带 help icon，点击/悬停显示 tooltip（"当 agent session 完成或需要用户确认时，发出声音提醒"）；下拉框选项 是/否，默认 否；通过 localStorage 持久化，跟随现有 theme/locale/contentFontSize 偏好模式。
- **issue running 状态切出钩子**：将 issue 从 `running` 切换到其他状态（`review`/`completed`/`backlog`）的副作用过程封装为异步钩子机制，在 `handleAdvanceStatus` 内于状态切换成功后调用；钩子内逻辑异步执行，便于后续扩展。
- **三审提示音**：钩子内当目标状态为 `review`（即 `running` → `review`）时，读取"通知提醒"偏好；若开启，用 Web Audio API 合成短促提示音，音量适中、清晰可闻。

## Impact

- `specs/settings-ui/spec.md`：新增 Global Preferences 通知提醒偏好 requirement（位置、tooltip、下拉框、默认值、持久化）。
- `specs/issues-ui/spec.md`：新增 issue running 状态切出异步钩子 requirement 与 running→review 提示音 requirement。
- 前端：`src/shared/i18n/`（偏好存储与常量）、`src/features/settings/global-settings-activity.tsx`（偏好 UI）、`src/features/issues/issues-activity.tsx`（钩子接入）、新增提示音与钩子模块。
- 不涉及 Rust/SQLite/migration：偏好存 localStorage，状态切换走既有 command，提示音纯前端 Web Audio。
- 非目标：不改现有 agent session 通知系统；不引入音频资源文件；不实现 `running` → `completed`/`backlog` 的提示音（仅 `running` → `review`，留作钩子后续扩展点）。
