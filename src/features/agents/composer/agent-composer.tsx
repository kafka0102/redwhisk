// Agent composer 顶层组件：组合 textarea + 附件行 + 控制行。
//
// 布局：底部固定输入栏，flex column。textarea 在上（Enter 发送 / Shift+Enter
// 换行，IME 合成期不触发发送），附件行居中（有附件时），控制行在下。
//
// 规范遵循（agent-development-rules.md）：
// - L188：composer 是 Codex Session View 底部固定输入框
// - L196：Enter 提交消息，Shift+Enter 换行
// - L213：模型/Think 前端只发 command
// - L214：上下文窗口用量来自 usage_updated 事件 → props.usage

import { useMemo, type KeyboardEvent } from "react";

import { Textarea } from "@/components/ui";
import { useAgentComposer } from "./use-agent-composer";
import { useAgentModels } from "./use-agent-models";
import { ComposerAttachments } from "./composer-attachments";
import { ComposerControls } from "./composer-controls";
import type { AgentComposerProps } from "./composer-types";

/** textarea 最大高度（px），超过后内部滚动而非无限撑高。 */
const TEXTAREA_MAX_HEIGHT_PX = 160;
const THINK_OPTIONS = ["low", "medium", "high", "xhigh"] as const;

export function AgentComposer({
  projectId,
  sessionId,
  capabilities,
  turnStatus,
  usage,
  currentModelId,
  currentEffort,
  onMessageSent,
}: AgentComposerProps) {
  const {
    models,
    selectedModelId,
    isLoading: isLoadingModels,
    error: modelsError,
    selectModel,
  } = useAgentModels({ projectId, sessionId, currentModelId });

  const {
    text,
    setText,
    attachments,
    effort,
    submitError,
    isSending,
    handleSubmit,
    handleCancel,
    handleAddAttachment,
    handleRemoveAttachment,
    handleSetEffort,
  } = useAgentComposer({
    projectId,
    sessionId,
    turnStatus,
    currentEffort,
    onMessageSent,
  });

  // UI 固定展示四档 Think 模式，不提供 off。
  const thinkOptions = useMemo(() => {
    return [...THINK_OPTIONS];
  }, []);

  const canSend = text.trim() !== "" && !isSending;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 发送，Shift+Enter 换行；IME 合成期（中文输入选词）不触发发送。
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (canSend) {
        void handleSubmit();
      }
    }
  }

  return (
    <form
      className="agents-composer"
      aria-label="Agent 消息输入"
      onSubmit={(event) => {
        // 阻止 form 默认提交；实际发送由按钮/Enter 触发。
        event.preventDefault();
        if (canSend) {
          void handleSubmit();
        }
      }}
    >
      <ComposerAttachments
        attachments={attachments}
        onRemove={handleRemoveAttachment}
      />
      <Textarea
        className="agents-composer__textarea"
        aria-label="输入消息"
        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        style={{ maxHeight: TEXTAREA_MAX_HEIGHT_PX }}
      />
      {submitError ? (
        <p className="agents-composer__error" role="status">
          {submitError}
        </p>
      ) : null}
      {modelsError ? (
        <p className="agents-composer__error" role="status">
          {`模型加载失败：${modelsError}`}
        </p>
      ) : null}
      <ComposerControls
        capabilities={capabilities}
        models={models}
        selectedModelId={selectedModelId}
        isLoadingModels={isLoadingModels}
        modelsError={modelsError}
        onSelectModel={(modelId) => {
          void selectModel(modelId);
        }}
        effort={effort}
        thinkOptions={thinkOptions}
        onSelectEffort={(nextEffort) => {
          void handleSetEffort(nextEffort);
        }}
        isSending={isSending}
        canSend={canSend}
        onSubmit={() => {
          void handleSubmit();
        }}
        onCancel={() => {
          void handleCancel();
        }}
        onAddAttachment={() => {
          void handleAddAttachment();
        }}
        usage={usage}
      />
    </form>
  );
}
