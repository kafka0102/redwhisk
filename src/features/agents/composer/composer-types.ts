// composer 输入框的内部状态与对外 props 类型。
//
// composer 是受控组件：`turnStatus` / `usage` / `currentModelId` 由父组件
// （任务 6 的 AgentSessionView，从 useAgentMessageStream 提升）下传，避免与
// message-stream 形成双订阅。本文件只定义类型，无运行时逻辑。

import type { AgentAttachmentKindLiteral } from "../agent-stream-types";
import type { AgentUsage } from "../agent-stream-types";
import type { TurnStatus } from "../message-stream/message-stream-types";

/**
 * 附件草稿视图模型。
 *
 * 用户经 `@tauri-apps/plugin-dialog` 选定本地文件后，调 `saveAgentAttachment`
 * 落盘到 app data dir；落盘成功后 chip 状态转为 `saved`。
 *
 * 规范缺口：`SendAgentMessageInput` 目前只接受 `message: string`，无法把
 * `savedPath` 随消息发送给 codex（`TurnInput::Blocks` 变体已存在但未接线）。
 * 本任务附件仅落盘，发送时不附带路径；缺口修复推迟到任务 6 / 后续。
 */
export interface ComposerAttachment {
  /** 本地生成的 id，用于 React key 与移除定位。 */
  id: string;
  displayName: string;
  kind: AgentAttachmentKindLiteral;
  /** `saveAgentAttachment` 返回的落盘绝对路径。 */
  savedPath: string;
  status: "saving" | "saved" | "error";
  error?: string;
}

/** Think 模式（reasoning effort）取值；`null` 表示关闭。 */
export type ComposerEffort = "low" | "medium" | "high" | null;

/** AgentComposer 顶层组件的 props。 */
export interface AgentComposerProps {
  projectId: number;
  sessionId: number;
  /** 来自 message-stream state，决定发送/取消按钮切换。 */
  turnStatus: TurnStatus;
  /** 来自 message-stream state.usage，驱动上下文窗口用量条。 */
  usage: AgentUsage | null;
  /**
   * 当前模型 id（来自 message-stream state.model），用于初始化与同步模型 Select。
   * 父组件在 message-stream 收到 `model_changed` 事件时下传新值。
   */
  currentModelId?: string | null;
  /**
   * 当前 Think effort。无独立事件流，可选初始化（任务 6 可由父组件持久化）。
   */
  currentEffort?: ComposerEffort;
  /**
   * 可选：发送成功回调，供父组件做乐观用户消息合并（任务 6 用）。
   */
  onMessageSent?: (message: string) => void;
}
