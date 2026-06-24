// composer 输入框的内部状态与对外 props 类型。
//
// composer 是受控组件：`turnStatus` / `usage` / `currentModelId` 由父组件
// （任务 6 的 AgentSessionView，从 useAgentMessageStream 提升）下传，避免与
// message-stream 形成双订阅。本文件只定义类型，无运行时逻辑。

import type { AgentCapabilities } from "../agent-capabilities";
import type { AgentAttachmentKindLiteral } from "../agent-stream-types";
import type { AgentUsage } from "../agent-stream-types";
import type { TurnStatus } from "../message-stream/message-stream-types";

/**
 * 附件草稿视图模型。
 *
 * 用户经 `@tauri-apps/plugin-dialog` 选定本地文件后，调 `saveAgentAttachment`
 * 落盘到 app data dir；落盘成功后 chip 状态转为 `saved`。
 *
 * 提交时 `useAgentComposer.handleSubmit` 收集 `status === "saved"` 的附件，
 * 映射为 `AgentMessageAttachment` 随消息一起发送；`saving` 状态的附件会阻止
 * 提交并提示用户等待。后端把附件编码为 `TurnInput::Blocks` 的 text 块路径引用。
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

/** Think 模式（reasoning effort）取值；来自模型声明，常见值为 low/medium/high/xhigh。 */
export type ComposerEffort = string | null;

/** AgentComposer 顶层组件的 props。 */
export interface AgentComposerProps {
  projectId: number;
  sessionId: number;
  /**
   * 当前 agent 的能力声明，决定模型等控件是否渲染。
   * 父组件按 session 的 agentType 经 `getAgentCapabilities` 取得。
   */
  capabilities: AgentCapabilities;
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
  /** 只读时禁用输入和发送；用于 completed issue 等不可继续的 session。 */
  isReadOnly?: boolean;
  /** 只读原因文案，显示在 composer 内部状态区。 */
  readOnlyReason?: string;
  /** 发送前执行的恢复动作；失败时阻止发送并保留输入。 */
  onBeforeSend?: () => Promise<void>;
  /** 切换模型前执行的恢复动作；失败时阻止模型切换。 */
  onBeforeSelectModel?: () => Promise<void>;
  /** 切换 Think effort 前执行的恢复动作；失败时阻止 effort 切换。 */
  onBeforeSetEffort?: () => Promise<void>;
  /**
   * 可选：发送成功回调，供父组件做乐观用户消息合并（任务 6 用）。
   */
  onMessageSent?: (message: string) => void;
}
