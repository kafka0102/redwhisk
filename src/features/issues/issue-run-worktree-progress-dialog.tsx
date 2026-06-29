import type { I18nMessages } from "../../shared/i18n/messages";

export type WorktreeStartProgressStepId = "creating" | "setup" | "completed";

interface WorktreeStartProgressStep {
  id: WorktreeStartProgressStepId;
  label: string;
  status: "pending" | "active" | "done";
}

interface WorktreeStartProgressState {
  title: string;
  steps: WorktreeStartProgressStep[];
}

interface IssueRunWorktreeProgressDialogProps {
  activeStep: WorktreeStartProgressStepId;
  issueId: number;
  messages: I18nMessages["issues"];
  setupCommand: string;
}

export function IssueRunWorktreeProgressDialog({
  activeStep,
  issueId,
  messages,
  setupCommand,
}: IssueRunWorktreeProgressDialogProps) {
  const progress = buildWorktreeStartProgress({
    activeStep,
    messages,
    setupCommand,
    worktreeName: `issue-${issueId}`,
  });

  return (
    <div className="issue-dialog-overlay issue-dialog-overlay--nested">
      <div
        aria-label={progress.title}
        aria-modal="true"
        className="issue-dialog issue-dialog--progress"
        role="dialog"
      >
        <div className="issue-dialog__header">
          <h3>{progress.title}</h3>
        </div>
        <div className="issue-dialog__body issue-dialog__body--single">
          <ol className="issue-completion-progress" role="status">
            {progress.steps.map((step) => (
              <li
                className={`issue-completion-progress__step issue-completion-progress__step--${step.status}`}
                key={step.id}
              >
                <span className="issue-completion-progress__marker" />
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function buildWorktreeStartProgress({
  activeStep,
  messages,
  setupCommand,
  worktreeName,
}: {
  activeStep: WorktreeStartProgressStepId;
  messages: I18nMessages["issues"];
  setupCommand: string;
  worktreeName: string;
}): WorktreeStartProgressState {
  const stepOrder: WorktreeStartProgressStepId[] =
    setupCommand.length > 0
      ? ["creating", "setup", "completed"]
      : ["creating", "completed"];
  const activeStepIndex = stepOrder.indexOf(activeStep);

  return {
    title: messages.worktreeStartProgressTitle,
    steps: stepOrder.map((stepId, stepIndex) => ({
      id: stepId,
      label: worktreeProgressStepLabel({
        messages,
        setupCommand,
        stepId,
        worktreeName,
      }),
      status:
        stepIndex < activeStepIndex
          ? "done"
          : stepIndex === activeStepIndex
            ? "active"
            : "pending",
    })),
  };
}

function worktreeProgressStepLabel({
  messages,
  setupCommand,
  stepId,
  worktreeName,
}: {
  messages: I18nMessages["issues"];
  setupCommand: string;
  stepId: WorktreeStartProgressStepId;
  worktreeName: string;
}): string {
  switch (stepId) {
    case "creating":
      return messages.worktreeCreatingProgress(worktreeName);
    case "setup":
      return messages.worktreeSetupProgress(setupCommand);
    case "completed":
      return messages.worktreeCreatedProgress;
  }
}
