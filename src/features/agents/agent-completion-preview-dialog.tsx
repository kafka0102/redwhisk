import type { AgentCommitCompletionPreview } from "../issues/issue-commands";
import type { useI18n } from "../../shared/i18n/i18n";

type Messages = ReturnType<typeof useI18n>["messages"];

interface AgentCompletionPreviewDialogProps {
  preview: AgentCommitCompletionPreview;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCompleteManually: () => void;
  messages: Messages;
}

/**
 * agent-commit 完成预览弹窗：展示 commit head / 变更文件，并提供「提交代码 / 手动
 * 完成 / 取消」三个入口。从 agents-activity 抽出，消费 useAgentSessionCompletionFlow
 * 返回的 preview / 派生与 handler。
 */
export function AgentCompletionPreviewDialog({
  preview,
  isPending,
  onClose,
  onConfirm,
  onCompleteManually,
  messages,
}: AgentCompletionPreviewDialogProps) {
  return (
    <div className="issue-dialog-overlay">
      <div
        aria-label={messages.agentsFeature.completionConfirmation}
        aria-modal="true"
        className="issue-dialog issue-dialog--compact"
        role="dialog"
      >
        <div className="issue-dialog__header">
          <h3>{messages.agentsFeature.completionConfirmation}</h3>
          <button
            aria-label={messages.agentsFeature.closeCompletionConfirmation}
            className="issue-dialog__close"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="issue-dialog__body issue-dialog__body--single">
          <div className="issue-dialog__editor">
            <section className="issue-dialog__panel">
              <h4>{messages.agentsFeature.gitSummary}</h4>
              <p>{messages.agentsFeature.head(preview.head)}</p>
              <p>
                {messages.agentsFeature.changedFilesCount(
                  preview.changedFilesCount,
                )}
              </p>
              <p>{messages.agentsFeature.completionOption(preview.option)}</p>
            </section>
            <section className="issue-dialog__panel">
              <h4>{messages.agentsFeature.changedFiles}</h4>
              {preview.changedFiles.length > 0 ? (
                <ul className="completion-preview__files">
                  {preview.changedFiles.map((file) => (
                    <li key={`${file.status}:${file.path}`}>
                      <span>{file.status}</span>
                      <code>{file.path}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{messages.agentsFeature.noChangedFiles}</p>
              )}
            </section>
          </div>
        </div>
        <div className="issue-dialog__footer issue-dialog__footer--end">
          <button
            className="issues-button issues-button--primary"
            disabled={isPending}
            type="button"
            onClick={() => void onConfirm()}
          >
            {messages.agentsFeature.completionSubmitCode}
          </button>
          <button
            className="issues-button"
            disabled={isPending}
            type="button"
            onClick={() => void onCompleteManually()}
          >
            {messages.agentsFeature.completionMarkDone}
          </button>
          <button
            className="issues-button"
            disabled={isPending}
            type="button"
            onClick={onClose}
          >
            {messages.agentsFeature.completionCancel}
          </button>
        </div>
      </div>
    </div>
  );
}
