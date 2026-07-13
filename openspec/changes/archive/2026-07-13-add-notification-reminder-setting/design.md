# Design: 全局偏好新增通知提醒与 running 状态切出钩子

## 1. 偏好存储

跟随现有全局偏好模式（theme/locale/contentFontSize），新增 `notificationReminder` 偏好：

- 类型：`boolean`，`true`=是、`false`=否，默认 `false`。
- 存储 key：`redwhisk.notification-reminder`（沿用 `redwhisk.*` 前缀），localStorage 持久化。
- 读取初值：`getInitialNotificationReminder()`，仿 `getInitialContentFontSize`，解析失败回退默认 `false`。
- 注入位置：`src/shared/i18n/i18n-provider.tsx` 的 context value，新增 `notificationReminder` 与 `setNotificationReminder`。`i18n-provider` 虽以 i18n 命名，但已承载 theme/contentFontSize 等全局应用偏好，加入此处保持单一偏好入口、避免新建 provider 的额外成本。fallback 值同 `contentFontSize` 模式补齐。
- 常量放入 `src/shared/i18n/i18n-constants.ts`：`NOTIFICATION_REMINDER_STORAGE_KEY`、`DEFAULT_NOTIFICATION_REMINDER`、`getInitialNotificationReminder`（boolean 仅 true/false，直接在函数内联解析，不引入额外类型守卫）。

不引入 Rust/SQLite：该偏好是纯前端 UI 偏好，与现有 theme/contentFontSize 同级，无需跨 Tauri 边界。

## 2. 偏好 UI

在 `global-settings-activity.tsx` 的 Preferences Card 内，"内容字号" section 之后新增"通知提醒" section，沿用 `grid-cols-[120px_minmax(0,1fr)]` 布局：

- label 列：`messages.globalSettings.notificationReminder` 文案 + help icon。
- help icon：lucide-react `HelpCircle`（跟随项目 `permission-card.tsx` 既有用法，保持图标命名一致），尺寸 14，`aria-label` 指向 tooltip 文案。
- tooltip：用 `components/ui` 的 `Tooltip`/`TooltipTrigger`/`TooltipContent`（base-ui，hover 与 focus 触发；点击 icon 不触发默认行为）。base-ui Tooltip 默认 hover/focus 显示，满足"点击或悬停显示"。tooltip 文案 = `messages.globalSettings.notificationReminderTooltip`。
- 控件列：`Select` 下拉框，选项 是/否，`w-[200px]`，与"内容字号"下拉框样式一致。option value 用 `"true"`/`"false"` 字符串，`onValueChange` 转 boolean 写入 `setNotificationReminder`。
- a11y：help icon `aria-label`、tooltip 文案经 i18n；Select `aria-label` 指向 label 文案。

i18n 文案键（`globalSettings` 命名空间下，zh/en 都补齐）：

- `notificationReminder`：zh "通知提醒" / en "Notification reminder"
- `notificationReminderTooltip`：zh "当 agent session 完成或需要用户确认时，发出声音提醒" / en "Play a sound when an agent session completes or needs your confirmation"
- `notificationReminderOn`：zh "是" / en "Yes"
- `notificationReminderOff`：zh "否" / en "No"

`messages.ts` 的 `I18nMessages.globalSettings` 接口同步新增这 4 个键。

## 3. running 状态切出钩子

### 3.1 钩子形态

封装为异步副作用钩子模块 `src/features/issues/issue-running-exit-hooks.ts`（非 React Hook，而是状态机生命周期钩子，命名避开 `use` 前缀以免误判为 React Hook）：

```ts
export interface IssueRunningExitContext {
  issueId: number;
  projectId: number;
  fromStatus: "running";
  targetStatus: IssueStatus; // review | completed | backlog
}

export async function runIssueRunningExitHooks(
  ctx: IssueRunningExitContext,
): Promise<void>;
```

- 纯 async 函数，内部按顺序 `await` 各子钩子；当前仅一个子钩子：`playReviewNotificationSound(ctx)`。
- 每个 hook 独立 `try/catch`（用 `Promise.allSettled` 或逐个 await+catch），单个 hook 失败不阻断其他 hook，也不阻断状态切换本身（状态切换已在钩子调用前完成）。
- 设计为可扩展：后续新增 `running` -> 其他状态的副作用，只需在该模块追加 hook，不改 `issues-activity.tsx` 调用点。

### 3.2 接入点

`issues-activity.tsx` 的 `handleAdvanceStatus`：在状态切换成功、`updatedIssue` 回流后（即 try 块内 `setIssues`/`setLaneTotals`/`setSelectedIssueId` 之后），若 `currentIssue.status === "running"` 且 `targetStatus !== "running"`，调用：

```ts
void runIssueRunningExitHooks({
  issueId: currentIssue.id,
  projectId: requestProjectId,
  fromStatus: "running",
  targetStatus,
});
```

- `void` 调用，不 await：钩子异步执行，不阻塞 UI 与后续流程；钩子内部失败不影响已成功的状态切换。
- 触发条件覆盖三条 running 切出路径：`running` -> `review`（`markIssueReview`）、`running` -> `completed`（先 `markIssueReview` 再完成）、`running` -> `backlog`（`advanceIssueStatus` 退回）。`targetStatus === "completed"` 时也会先经 `markIssueReview`，钩子以 `targetStatus` 区分是否播提示音。
- 钩子在 `activeProjectIdRef.current === requestProjectId` 守卫通过后调用，避免切项目后误触发。

### 3.3 提示音子钩子

`playReviewNotificationSound(ctx)`：

- 仅当 `ctx.targetStatus === "review"` 时执行；其他目标状态直接返回（留作后续扩展占位）。
- 读取 `useI18n()` 的 `notificationReminder`？——钩子是模块级 async 函数，不在 React 树内，不能直接 `useI18n`。改为：调用处传入 `notificationReminder` 值，或钩子读取 localStorage。选前者：`runIssueRunningExitHooks` 入参追加 `notificationReminder: boolean`，由 `handleAdvanceStatus` 从 `useI18n()` 取值传入。保持钩子纯函数、可测、不依赖 React context。
- 若 `notificationReminder === false`，直接返回。
- 若 `true`，调用 `playNotificationSound()`（Web Audio API，见 §4）。

## 4. 提示音实现

`src/shared/audio/notification-sound.ts`：

```ts
export function playNotificationSound(): void {
  const AudioContextCtor =
    window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextCtor) return;
  const ctx = new AudioContextCtor();
  // 短促两音 beep：880Hz -> 1175Hz，各 120ms，音量 0.18（适中清晰）
  ...
  ctx.close();
}
```

- 用 `OscillatorNode` + `GainNode` 合成，无需音频资源文件。
- 音量 gain 约 `0.15-0.2`（适中、清晰可闻，不刺耳），两音上行（880Hz->1175Hz）增强识别度。
- `AudioContext` 在某些浏览器需用户手势激活；Tauri webview 内点击状态切换按钮即用户手势，`AudioContext` 可正常创建。若 `suspended`，调用 `ctx.resume()`。
- 失败静默：`AudioContext` 不支持或抛错时 `try/catch` 返回，不影响状态切换。
- 纯前端，不跨 Tauri 边界。

## 5. 测试策略

- `i18n-constants`/`i18n-provider`：偏好默认值、localStorage 读写、回退。
- `global-settings-activity`：偏好 section 渲染位置（在内容字号下方）、tooltip 文案存在、下拉框选项与默认值、切换写入偏好。
- `issue-running-exit-hooks`：`targetStatus` 为 `review` 且开启偏好时调用 `playNotificationSound`；其他目标状态或关闭偏好时不调用；单个 hook 失败不阻断。
- `notification-sound`：`AudioContext` 不存在时静默返回；存在时调用 oscillator（mock AudioContext 验证节点连接与 gain 值）。
- `issues-activity`：`handleAdvanceStatus` 在 running 切出成功后触发钩子（传入正确 `notificationReminder` 与 `targetStatus`）。

## 6. 非目标

- 不改现有 agent session 通知系统（session 级 running->closed/crashed）。
- 不实现 running->completed/backlog 的提示音（仅 review，钩子留扩展点）。
- 不引入系统级声音或 Tauri 通知 API（纯 Web Audio）。
- 不新增 Rust command 或 SQLite migration。
