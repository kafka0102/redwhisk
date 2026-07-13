# Tasks: 全局偏好新增通知提醒与 running 状态切出钩子

## 1. 偏好存储层

- [ ] 1.1 在 `src/shared/i18n/i18n-constants.ts` 新增 `NotificationReminder` 类型（`boolean`）、`NOTIFICATION_REMINDER_STORAGE_KEY`（`redwhisk.notification-reminder`）、`DEFAULT_NOTIFICATION_REMINDER = false`、`getInitialNotificationReminder()`、`isNotificationReminder()`。
- [ ] 1.2 在 `src/shared/i18n/i18n-provider.tsx` 的 context value 注入 `notificationReminder` 与 `setNotificationReminder`（localStorage 持久化，失败静默）；补 fallback 值。
- [ ] 1.3 在 `src/shared/i18n/messages.ts` 的 `I18nMessages.globalSettings` 接口新增 `notificationReminder`、`notificationReminderTooltip`、`notificationReminderOn`、`notificationReminderOff` 四个键。

## 2. i18n 文案

- [ ] 2.1 在 `src/shared/i18n/locales/zh.json` 的 `globalSettings` 新增四键：`notificationReminder`="通知提醒"、`notificationReminderTooltip`="当 agent session 完成或需要用户确认时，发出声音提醒"、`notificationReminderOn`="是"、`notificationReminderOff`="否"。
- [ ] 2.2 在 `src/shared/i18n/locales/en.json` 同步四键英文文案。
- [ ] 2.3 运行 `src/shared/i18n/locales.test.ts`（或等价 locale 完整性测试）确认 zh/en 键一致。

## 3. 偏好 UI

- [ ] 3.1 在 `src/features/settings/global-settings-activity.tsx` 的 Preferences Card 内，"内容字号" section 之后新增"通知提醒" section，沿用 `grid-cols-[120px_minmax(0,1fr)]` 布局。
- [ ] 3.2 label 旁加 `CircleHelp` help icon，包 `Tooltip`/`TooltipTrigger`/`TooltipContent`，tooltip 文案用 `notificationReminderTooltip`；icon `aria-label` 指向同文案。
- [ ] 3.3 控件用 `Select`，选项 是/否（值 `"true"`/`"false"`），`w-[200px]`，`aria-label` 指向 `notificationReminder`；`onValueChange` 转 boolean 写 `setNotificationReminder`。
- [ ] 3.4 从 `useI18n()` 取 `notificationReminder`/`setNotificationReminder`。

## 4. 提示音模块

- [ ] 4.1 新建 `src/shared/audio/notification-sound.ts`，导出 `playNotificationSound()`，用 Web Audio API `OscillatorNode`+`GainNode` 合成两音上行 beep，音量约 0.18，`AudioContext` 不存在或失败时静默返回。
- [ ] 4.2 新建 `src/shared/audio/notification-sound.test.ts`：mock AudioContext 验证节点连接、gain 值、无 AudioContext 时静默。

## 5. running 状态切出钩子

- [ ] 5.1 新建 `src/features/issues/issue-running-exit-hooks.ts`，导出 `IssueRunningExitContext` 与 `runIssueRunningExitHooks(ctx)`；入参含 `notificationReminder: boolean`、`fromStatus: "running"`、`targetStatus`。内部异步执行子钩子，单 hook 失败不阻断。
- [ ] 5.2 实现 `playReviewNotificationSound(ctx)` 子钩子：仅 `targetStatus === "review"` 且 `notificationReminder === true` 时调 `playNotificationSound()`。
- [ ] 5.3 新建 `issue-running-exit-hooks.test.ts`：review+开 -> 调用 sound；review+关 -> 不调；completed/backlog -> 不调；sound 抛错不抛出。

## 6. 接入状态切换

- [ ] 6.1 在 `src/features/issues/issues-activity.tsx` 的 `handleAdvanceStatus` 内，状态切换成功、`updatedIssue` 回流且 `activeProjectIdRef` 守卫通过后，若 `currentIssue.status === "running"` 且 `targetStatus !== "running"`，`void runIssueRunningExitHooks({...})`，`notificationReminder` 从 `useI18n()` 取值传入。
- [ ] 6.2 在 `issues-activity` 相关测试中补充：running->review 成功后触发钩子（mock 钩子模块验证调用参数）。

## 7. 验证

- [ ] 7.1 `pnpm format` 后复查 `git status --short`。
- [ ] 7.2 `pnpm lint`。
- [ ] 7.3 `pnpm typecheck`。
- [ ] 7.4 `pnpm test`（聚焦新增/改动测试）。
