import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import type { ProjectIssueConnection } from "../settings/issue-source-commands";
import {
  issueFormFromProject,
  newIssueForm,
  type CreateProjectIssueForm,
} from "./create-project-issue-form";
import { CreateProjectIssuesStep } from "./create-project-issues-step";
import { ProjectDetailsForm } from "./project-details-form";
import {
  validateProjectRepoPath,
  type CreateProjectInput,
  type ProjectWorktreeLocation,
  type ValidateProjectRepoPathResponse,
  type ValidatedExistingProject,
} from "./project-commands";
import type {
  ForgeHostName,
  ProjectCompletionAction,
} from "./project-forge-commands";
import { detectWorktreeSetupCommand } from "./worktree-setup-command";

export interface CreateProjectDialogDraft {
  name: string;
  repoPath: string;
  suggestedName: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
  host: ForgeHostName | "";
  completionAction: ProjectCompletionAction;
  confirmCompletionAction: boolean;
  existingProject?: ValidatedExistingProject | null;
  repoDefaultBranch?: string | null;
}

interface CreateProjectDialogProps {
  initialDraft: CreateProjectDialogDraft;
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => Promise<void>;
}

function knownForgeHost(host: string): host is "github" | "gitlab" {
  return host === "github" || host === "gitlab";
}

export function CreateProjectDialog({
  initialDraft,
  onClose,
  onCreate,
}: CreateProjectDialogProps): ReactElement {
  const { messages, t } = useI18n();
  const matched = initialDraft.existingProject ?? null;
  const initialHost = knownForgeHost(initialDraft.host)
    ? initialDraft.host
    : initialDraft.host === ""
      ? ""
      : "none";
  const listed = matched != null && !matched.removed;
  const [step, setStep] = useState<1 | 2>(1);
  const [projectNameValue, setProjectNameValue] = useState(
    listed ? matched.name : initialDraft.name,
  );
  const [projectPathValue, setProjectPathValue] = useState(
    initialDraft.repoPath,
  );
  const [worktreeLocationValue, setWorktreeLocationValue] =
    useState<ProjectWorktreeLocation>(
      listed ? matched.worktreeLocation : initialDraft.worktreeLocation,
    );
  const [worktreeSetupCommandValue, setWorktreeSetupCommandValue] = useState(
    listed ? matched.worktreeSetupCommand : initialDraft.worktreeSetupCommand,
  );
  const [suggestedName, setSuggestedName] = useState(
    initialDraft.suggestedName,
  );
  const [host, setHost] = useState<ForgeHostName | "">(initialHost);
  const [issue, setIssue] = useState<CreateProjectIssueForm>(
    matched ? issueFormFromProject(matched) : newIssueForm(),
  );
  const [completionAction, setCompletionAction] =
    useState<ProjectCompletionAction>(
      matched
        ? matched.completionAction
        : knownForgeHost(initialHost)
          ? initialDraft.completionAction
          : "merge_to_base",
    );
  const [confirmCompletionAction, setConfirmCompletionAction] = useState(
    matched
      ? matched.confirmCompletionAction
      : knownForgeHost(initialHost)
        ? initialDraft.confirmCompletionAction
        : false,
  );
  const [repoDefaultBranch, setRepoDefaultBranch] = useState<string | null>(
    initialDraft.repoDefaultBranch ?? null,
  );
  const [connection, setConnection] = useState<ProjectIssueConnection | null>(
    null,
  );
  const [locked, setLocked] = useState(listed);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChoosingRepoPath, setIsChoosingRepoPath] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const issueTouchedRef = useRef(false);
  const completionTouchedRef = useRef(false);
  const trimmedProjectName = projectNameValue.trim();
  const trimmedProjectPath = projectPathValue.trim();
  const labelRequired =
    issue.mode !== "local" &&
    issue.scope === "label" &&
    issue.label.trim().length === 0;
  const nextDisabled =
    isSubmitting ||
    trimmedProjectName.length === 0 ||
    trimmedProjectPath.length === 0;
  const createDisabled = nextDisabled || isChoosingRepoPath || labelRequired;

  useEffect(() => {
    if (
      step !== 2 ||
      issue.mode === "local" ||
      host === "" ||
      trimmedProjectPath.length === 0
    ) {
      return;
    }
    let cancelled = false;
    void Promise.resolve(
      validateProjectRepoPath({
        repoPath: trimmedProjectPath,
        probeConnection: true,
      }),
    )
      .then((result) => {
        if (!cancelled && result?.connection) setConnection(result.connection);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [host, issue.mode, step, trimmedProjectPath]);

  function updateIssue(patch: Partial<CreateProjectIssueForm>): void {
    issueTouchedRef.current = true;
    setIssue((current) => ({ ...current, ...patch }));
  }

  function applyValidated(validated: ValidateProjectRepoPathResponse): void {
    const nextHost = knownForgeHost(validated.host) ? validated.host : "none";
    setHost(nextHost);
    setRepoDefaultBranch(validated.repoDefaultBranch ?? null);
    if (validated.connection) setConnection(validated.connection);
    const existing = validated.existingProject ?? null;
    if (existing) {
      issueTouchedRef.current = false;
      completionTouchedRef.current = false;
      setLocked(!existing.removed);
      if (!existing.removed) {
        setProjectNameValue(existing.name);
        setWorktreeLocationValue(existing.worktreeLocation);
        setWorktreeSetupCommandValue(existing.worktreeSetupCommand);
      }
      setIssue(issueFormFromProject(existing));
      setCompletionAction(existing.completionAction);
      setConfirmCompletionAction(existing.confirmCompletionAction);
      return;
    }
    setLocked(false);
    if (!issueTouchedRef.current) setIssue(newIssueForm());
    if (completionTouchedRef.current) return;
    if (!knownForgeHost(nextHost)) {
      setCompletionAction("merge_to_base");
      setConfirmCompletionAction(false);
      return;
    }
    setCompletionAction(validated.completionAction);
    setConfirmCompletionAction(validated.confirmCompletionAction);
  }

  function clearRepoPath(): void {
    setProjectPathValue("");
    setHost("none");
    setLocked(false);
    setConnection(null);
    setRepoDefaultBranch(null);
    setCompletionAction("merge_to_base");
    setConfirmCompletionAction(false);
    if (!issueTouchedRef.current) setIssue(newIssueForm());
  }

  async function handleChooseRepoPath(): Promise<void> {
    setErrorMessage(null);
    setIsChoosingRepoPath(true);
    const previousHost = host;
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: messages.createProject.selectGitRepository,
      });
      if (typeof selectedPath !== "string") return;
      if (selectedPath.trim().length === 0) {
        clearRepoPath();
        return;
      }
      setHost("");
      const validatedProject = await validateProjectRepoPath({
        repoPath: selectedPath,
      });
      const shouldReplaceName =
        trimmedProjectName.length === 0 || trimmedProjectName === suggestedName;
      const currentDetectedCommand =
        detectWorktreeSetupCommand(projectPathValue);
      const nextDetectedCommand = detectWorktreeSetupCommand(
        validatedProject.repoPath,
      );
      setProjectPathValue(validatedProject.repoPath);
      setSuggestedName(validatedProject.suggestedName);
      if (shouldReplaceName && !locked) {
        setProjectNameValue(validatedProject.suggestedName);
      }
      if (
        !locked &&
        (worktreeSetupCommandValue.trim().length === 0 ||
          worktreeSetupCommandValue === currentDetectedCommand)
      ) {
        setWorktreeSetupCommandValue(nextDetectedCommand ?? "");
      }
      applyValidated(validatedProject);
    } catch (error: unknown) {
      setHost(previousHost);
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsChoosingRepoPath(false);
    }
  }

  function goNext(): void {
    if (nextDisabled) return;
    setStep(2);
  }

  async function handleCreate(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (createDisabled) return;
    setErrorMessage(null);
    setIsSubmitting(true);
    const forge = knownForgeHost(host);
    try {
      await onCreate({
        name: trimmedProjectName,
        repoPath: trimmedProjectPath,
        worktreeLocation: worktreeLocationValue,
        worktreeSetupCommand: worktreeSetupCommandValue.trim(),
        completionAction: forge ? completionAction : "merge_to_base",
        confirmCompletionAction: forge ? confirmCompletionAction : false,
        prTarget: issue.prTarget,
        prDraft: issue.prDraft,
        issueSourceMode: issue.mode,
        issueSyncScope: issue.scope,
        ...(issue.scope === "label"
          ? { issueSyncLabel: issue.label.trim() }
          : {}),
        issueSyncEnabled: issue.syncEnabled,
        issueSyncIntervalSeconds: issue.intervalSeconds,
        issueWritebackCloseOnComplete: issue.closeOnComplete,
        issueWritebackCloseOnPrMerge: issue.closeOnMerge,
        issueWritebackComment: issue.writebackComment,
      });
    } catch (error: unknown) {
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    if (event.defaultPrevented) return;
    const target = event.target;
    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLButtonElement
    ) {
      return;
    }
    event.preventDefault();
    if (step === 1) {
      goNext();
      return;
    }
    void handleCreate({
      preventDefault() {
        return undefined;
      },
    } as FormEvent<HTMLFormElement>);
  }

  async function handleRelogin(): Promise<void> {
    setIsInspecting(true);
    try {
      const result = await validateProjectRepoPath({
        repoPath: trimmedProjectPath,
        probeConnection: true,
      });
      if (result.connection) setConnection(result.connection);
    } catch (error: unknown) {
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsInspecting(false);
    }
  }

  return (
    <div className="issue-dialog-overlay" role="presentation">
      <div
        aria-label={messages.createProject.dialogTitle}
        aria-modal="true"
        className={
          step === 2
            ? "issue-dialog issue-dialog--compact issue-dialog--create-issues"
            : "issue-dialog issue-dialog--compact"
        }
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="issue-dialog__header">
          <h3>{messages.createProject.dialogTitle}</h3>
        </div>
        <div className="issue-dialog__body issue-dialog__body--single">
          {step === 1 ? (
            <ProjectDetailsForm
              ariaStatusLabel={messages.createProject.status}
              cancelLabel={messages.settings.cancel}
              chooseFolderLabel={messages.projectHome.chooseFolder}
              className="settings-card settings-general-card project-details-card"
              errorMessage={errorMessage}
              fieldsDisabled={locked}
              isChoosingRepoPath={isChoosingRepoPath}
              isSubmitting={isSubmitting}
              projectName={projectNameValue}
              projectNameLabel={messages.settings.projectName}
              repoPath={projectPathValue}
              repoPathLabel={messages.settings.repositoryPath}
              submitDisabled={nextDisabled}
              submitLabel={t("createProject.next")}
              submittingLabel={messages.createProject.creating}
              worktreeLocation={worktreeLocationValue}
              worktreeLocationLabel={messages.settings.worktreePath}
              worktreeSetupCommand={worktreeSetupCommandValue}
              worktreeSetupCommandLabel={
                messages.settings.worktreeSetupAfterCreation
              }
              worktreeSetupCommandPlaceholder={
                messages.createProject.worktreeSetupPlaceholder
              }
              onCancel={onClose}
              onChooseRepoPath={() => {
                void handleChooseRepoPath();
              }}
              onNameChange={setProjectNameValue}
              onSubmit={(event) => {
                event.preventDefault();
                goNext();
              }}
              onWorktreeLocationChange={setWorktreeLocationValue}
              onWorktreeSetupCommandChange={setWorktreeSetupCommandValue}
            />
          ) : (
            <CreateProjectIssuesStep
              completionAction={completionAction}
              confirmCompletionAction={confirmCompletionAction}
              connection={connection}
              createDisabled={createDisabled || isSubmitting}
              errorMessage={errorMessage}
              form={issue}
              host={host}
              isInspecting={isInspecting}
              locked={locked}
              repoDefaultBranch={repoDefaultBranch}
              showCards={host !== ""}
              statusLabel={messages.createProject.status}
              onBack={() => setStep(1)}
              onCancel={onClose}
              onCompletionActionChange={(value) => {
                completionTouchedRef.current = true;
                setCompletionAction(value);
              }}
              onConfirmCompletionActionChange={(value) => {
                completionTouchedRef.current = true;
                setConfirmCompletionAction(value);
              }}
              onFormChange={updateIssue}
              onRelogin={() => {
                void handleRelogin();
              }}
              onSubmit={(event) => {
                void handleCreate(event);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
