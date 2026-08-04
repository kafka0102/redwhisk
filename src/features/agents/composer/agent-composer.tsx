// Agent composer 顶层组件：组合 textarea + 附件行 + 控制行。
//
// 布局：底部固定输入栏，flex column。textarea 在上，附件行居中（有附件时），
// 控制行在下。
//
// 规范遵循（agent-development-rules.md）：
// - L188：composer 是 Codex Session View 底部固定输入框
// - L213：模型前端只发 command；不可用时只展示只读模型信息
// - L214：上下文窗口用量来自 usage_updated 事件 → props.usage

import { useMemo } from "react";

import { Textarea } from "@/components/ui";
import { useI18n } from "../../../shared/i18n/i18n";
import { useAgentComposer } from "./use-agent-composer";
import { useAgentModels } from "./use-agent-models";
import { ComposerAttachments } from "./composer-attachments";
import { ComposerControls } from "./composer-controls";
import type { AgentComposerProps } from "./composer-types";

/** textarea 最大高度（px），超过后内部滚动而非无限撑高。 */
const TEXTAREA_MAX_HEIGHT_PX = 160;

/**
 * 判断 keydown 是否属于 IME 处理中的按键。
 * 与终端 IME guard 一致：isComposing / keyCode 229 / Process / Unidentified。
 */
function isImeKeyboardEvent(event: {
  isComposing?: boolean;
  keyCode?: number;
  key?: string;
}): boolean {
  return (
    event.isComposing === true ||
    event.keyCode === 229 ||
    event.key === "Process" ||
    event.key === "Unidentified"
  );
}

export function AgentComposer({
  projectId,
  sessionId,
  turnStatus,
  usage,
  currentModelId,
  currentEffort,
  isReadOnly = false,
  readOnlyReason,
  onBeforeSend,
  onBeforeSelectModel,
  onBeforeSetEffort,
  onMessageSent,
}: AgentComposerProps) {
  const { messages } = useI18n();
  const {
    models,
    selectedModelId,
    isLoading: isLoadingModels,
    error: modelsError,
    isReadOnly: isModelReadOnly,
    capabilities,
    selectModel,
  } = useAgentModels({
    projectId,
    sessionId,
    currentModelId,
    // 始终拉取：capabilities 与 models 同由 list_agent_models 返回；
    // 实际控件显隐由 capabilities 决定，切换权由 isReadOnly 决定。
    enabled: true,
    onBeforeSelectModel,
  });

  const {
    text,
    setText,
    attachments,
    effort,
    submitError,
    cancelToastMessage,
    isSending,
    isSubmitting,
    isCancelling,
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
    isReadOnly,
    onBeforeSend,
    onBeforeSetEffort,
    onMessageSent,
  });

  // Think 选项取当前模型的 supportedReasoningEfforts，空则回退常见取值。
  const thinkOptions = useMemo(() => {
    const currentModel = models.find(
      (model) => model.modelId === selectedModelId,
    );
    const supported = currentModel?.supportedReasoningEfforts ?? [];
    if (supported.length > 0) {
      return supported;
    }
    return ["low", "medium", "high", "xhigh"];
  }, [models, selectedModelId]);

  const canSend = text.trim() !== "" && !isReadOnly;

  return (
    <form
      className="agents-composer"
      aria-label={messages.agentsFeature.messageInputForm}
      onSubmit={(event) => {
        // 防御：拦截表单默认提交，提交统一走 handleSubmit
        // （发送按钮或 textarea 快捷键，见 onKeyDown）。
        event.preventDefault();
      }}
    >
      <ComposerAttachments
        attachments={attachments}
        onRemove={handleRemoveAttachment}
      />
      <Textarea
        className="agents-composer__textarea"
        aria-label={messages.agentsFeature.messageInput}
        placeholder={messages.agentsFeature.messagePlaceholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // IME 合成 / 选词确认：交由输入法处理，不触发提交。
          // 仅查 isComposing 不够——部分 WebKit（含 Tauri WKWebView）在确认候选时
          // isComposing=false，但 keyCode 仍为 229（或 key 为 Process / Unidentified）。
          if (isImeKeyboardEvent(event.nativeEvent)) {
            return;
          }
          // Enter 提交；Shift+Enter 保持换行。
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void handleSubmit();
          }
        }}
        disabled={isReadOnly}
        rows={3}
        style={{ maxHeight: TEXTAREA_MAX_HEIGHT_PX }}
      />
      {isReadOnly && readOnlyReason ? (
        <p className="agents-composer__notice" role="status">
          {readOnlyReason}
        </p>
      ) : null}
      {submitError ? (
        <p className="agents-composer__error" role="status">
          {submitError}
        </p>
      ) : null}
      {modelsError ? (
        <p className="agents-composer__error" role="status">
          {messages.agentsFeature.modelLoadFailed(modelsError)}
        </p>
      ) : null}
      {cancelToastMessage ? (
        <div
          className="agents-composer__toast"
          role="status"
          aria-live="polite"
        >
          {cancelToastMessage}
        </div>
      ) : null}
      <ComposerControls
        capabilities={capabilities}
        models={models}
        selectedModelId={selectedModelId}
        isLoadingModels={isLoadingModels}
        modelsError={modelsError}
        isModelReadOnly={isModelReadOnly}
        onSelectModel={(modelId) => {
          void selectModel(modelId);
        }}
        effort={effort}
        thinkOptions={thinkOptions}
        onSelectEffort={(nextEffort) => {
          void handleSetEffort(nextEffort);
        }}
        isSending={isSending}
        isSubmitting={isSubmitting}
        isCancelling={isCancelling}
        canSend={canSend}
        isReadOnly={isReadOnly}
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
