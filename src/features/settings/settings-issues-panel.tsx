import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import { Button } from "../../components/ui/button";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { pageCenterToastOptions, toast } from "../../shared/toast";
import {
  updateProjectSettings,
  type ProjectWorktreeLocation,
} from "../project/project-commands";
import {
  inspectProjectForge,
  type ForgeHostName,
  type ProjectCompletionAction,
  type ProjectPrTarget,
} from "../project/project-forge-commands";
import {
  getProjectIssueSourceSettings,
  inspectProjectIssueConnection,
  updateProjectIssueSourceSettings,
  type IssueSourceMode,
  type IssueSyncScope,
  type ProjectIssueConnection,
  type ProjectIssueSourceSettings,
} from "./issue-source-commands";
import { IssueSourceCompletionCard } from "./settings-issues-completion-card";
import { IssueSourceConnectionCard } from "./settings-issues-connection-card";
import { IssueSourceModeConfirmDialog } from "./settings-issue-source-mode-confirm-dialog";
import { IssueSourceModeCard } from "./settings-issues-mode-card";

interface IssuesSettingsPanelProps {
  projectId: number;
  projectName: string;
  projectPath: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
}

interface CompletionBaseline {
  action: ProjectCompletionAction;
  confirm: boolean;
  draft: boolean;
  target: ProjectPrTarget;
}

export function IssuesSettingsPanel({
  projectId,
  projectName,
  projectPath,
  worktreeLocation,
  worktreeSetupCommand,
}: IssuesSettingsPanelProps): ReactElement {
  const { messages, t } = useI18n();
  const [mode, setMode] = useState<IssueSourceMode>("local");
  const [scope, setScope] = useState<IssueSyncScope>("assigned_to_me");
  const [label, setLabel] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(90);
  const [closeOnComplete, setCloseOnComplete] = useState(true);
  const [closeOnMerge, setCloseOnMerge] = useState(true);
  const [writebackComment, setWritebackComment] = useState(true);
  const [connection, setConnection] = useState<ProjectIssueConnection | null>(
    null,
  );
  const [sourceBaseline, setSourceBaseline] =
    useState<ProjectIssueSourceSettings | null>(null);
  const [host, setHost] = useState<ForgeHostName>("none");
  const [repoDefaultBranch, setRepoDefaultBranch] = useState<string | null>(
    null,
  );
  const [completionAction, setCompletionAction] =
    useState<ProjectCompletionAction>("merge_to_base");
  const [prTarget, setPrTarget] = useState<ProjectPrTarget>("issue_base");
  const [prDraft, setPrDraft] = useState(true);
  const [confirmCompletionAction, setConfirmCompletionAction] = useState(false);
  const [completionBaseline, setCompletionBaseline] =
    useState<CompletionBaseline | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [pendingMode, setPendingMode] = useState<IssueSourceMode | null>(null);
  const [isConfirmingMode, setIsConfirmingMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await getProjectIssueSourceSettings(projectId);
        if (cancelled) return;
        applySettings(settings, {
          setMode,
          setScope,
          setLabel,
          setSyncEnabled,
          setIntervalSeconds,
          setCloseOnComplete,
          setCloseOnMerge,
          setWritebackComment,
          setConnection,
        });
        setSourceBaseline(settings);
        const inspected = await inspectProjectIssueConnection(projectId);
        if (cancelled) return;
        setConnection(inspected.connection);
        setSourceBaseline({ ...settings, connection: inspected.connection });
      } catch (error: unknown) {
        if (!cancelled) setErrorMessage(getCommandErrorMessage(error, t));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  useEffect(() => {
    let cancelled = false;
    void inspectProjectForge(projectId)
      .then((inspection) => {
        if (cancelled) return;
        const nextHost =
          inspection.host === "github" || inspection.host === "gitlab"
            ? inspection.host
            : "none";
        setHost(nextHost);
        setRepoDefaultBranch(inspection.repoDefaultBranch);
        setCompletionAction(inspection.completionAction);
        setPrTarget(inspection.prTarget);
        setPrDraft(inspection.prDraft);
        setConfirmCompletionAction(inspection.confirmCompletionAction);
        setCompletionBaseline({
          action: inspection.completionAction,
          confirm: inspection.confirmCompletionAction,
          draft: inspection.prDraft,
          target: inspection.prTarget,
        });
      })
      .catch(() => {
        if (!cancelled) setHost("none");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const showRemote = mode !== "local";
  const showCompletion = host === "github" || host === "gitlab";
  const labelRequired =
    showRemote && scope === "label" && label.trim().length === 0;
  const completionDirty =
    showCompletion &&
    completionBaseline != null &&
    (completionAction !== completionBaseline.action ||
      prTarget !== completionBaseline.target ||
      prDraft !== completionBaseline.draft ||
      confirmCompletionAction !== completionBaseline.confirm);

  async function handleRelogin(): Promise<void> {
    setErrorMessage(null);
    setIsInspecting(true);
    try {
      const inspected = await inspectProjectIssueConnection(projectId);
      setConnection(inspected.connection);
    } catch (error: unknown) {
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsInspecting(false);
    }
  }

  function requestModeChange(next: IssueSourceMode): void {
    if (next === mode) return;
    setPendingMode(next);
  }

  async function confirmModeChange(): Promise<void> {
    if (pendingMode === null || sourceBaseline === null || isConfirmingMode) {
      return;
    }
    const saved = sourceBaseline;
    setIsConfirmingMode(true);
    setErrorMessage(null);
    try {
      const refreshed = await updateProjectIssueSourceSettings({
        projectId,
        issueSourceMode: pendingMode,
        issueSyncScope: saved.issueSyncScope,
        issueSyncEnabled: saved.issueSyncEnabled,
        issueSyncIntervalSeconds: saved.issueSyncIntervalSeconds,
        issueWritebackCloseOnComplete: saved.issueWritebackCloseOnComplete,
        issueWritebackCloseOnPrMerge: saved.issueWritebackCloseOnPrMerge,
        issueWritebackComment: saved.issueWritebackComment,
        ...(saved.issueSyncScope === "label" && saved.issueSyncLabel
          ? { issueSyncLabel: saved.issueSyncLabel }
          : {}),
      });
      setMode(refreshed.issueSourceMode);
      setSourceBaseline({
        ...saved,
        issueSourceMode: refreshed.issueSourceMode,
        issueCreateSource: refreshed.issueCreateSource,
        connection: refreshed.connection,
      });
      setPendingMode(null);
    } catch (error: unknown) {
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsConfirmingMode(false);
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (labelRequired || isSaving) return;
    setErrorMessage(null);
    setIsSaving(true);
    try {
      const refreshed = await updateProjectIssueSourceSettings({
        projectId,
        issueSourceMode: mode,
        issueSyncScope: scope,
        issueSyncEnabled: syncEnabled,
        issueSyncIntervalSeconds: intervalSeconds,
        issueWritebackCloseOnComplete: closeOnComplete,
        issueWritebackCloseOnPrMerge: closeOnMerge,
        issueWritebackComment: writebackComment,
        ...(scope === "label" ? { issueSyncLabel: label.trim() } : {}),
      });
      applySettings(refreshed, {
        setMode,
        setScope,
        setLabel,
        setSyncEnabled,
        setIntervalSeconds,
        setCloseOnComplete,
        setCloseOnMerge,
        setWritebackComment,
        setConnection,
      });
      setSourceBaseline(refreshed);
      if (completionDirty) {
        await updateProjectSettings({
          projectId,
          name: projectName,
          repoPath: projectPath,
          worktreeLocation,
          worktreeSetupCommand,
          completionAction,
          prTarget,
          prDraft,
          confirmCompletionAction,
        });
        setCompletionBaseline({
          action: completionAction,
          confirm: confirmCompletionAction,
          draft: prDraft,
          target: prTarget,
        });
      }
      toast.success(t("settings.saved"), pageCenterToastOptions);
    } catch (error: unknown) {
      const message = getCommandErrorMessage(error, t);
      setErrorMessage(message);
      toast.error(message, pageCenterToastOptions);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void handleSubmit(event)}>
      {sourceBaseline ? (
        <IssueSourceModeCard mode={mode} onModeChange={requestModeChange} />
      ) : null}
      <IssueSourceModeConfirmDialog
        targetMode={pendingMode}
        localIssueCount={sourceBaseline?.localIssueCount ?? 0}
        remoteIssueCount={sourceBaseline?.remoteIssueCount ?? 0}
        repoPath={
          connection?.repoPath ?? sourceBaseline?.connection.repoPath ?? null
        }
        onCancel={() => {
          setPendingMode(null);
        }}
        onConfirm={() => {
          void confirmModeChange();
        }}
      />
      {showRemote ? (
        <IssueSourceConnectionCard
          closeOnComplete={closeOnComplete}
          closeOnMerge={closeOnMerge}
          connection={connection}
          intervalSeconds={intervalSeconds}
          isInspecting={isInspecting}
          isLoading={isLoading}
          label={label}
          scope={scope}
          syncEnabled={syncEnabled}
          writebackComment={writebackComment}
          onCloseOnCompleteChange={setCloseOnComplete}
          onCloseOnMergeChange={setCloseOnMerge}
          onIntervalChange={setIntervalSeconds}
          onLabelChange={setLabel}
          onRelogin={() => {
            void handleRelogin();
          }}
          onScopeChange={setScope}
          onSyncEnabledChange={setSyncEnabled}
          onWritebackCommentChange={setWritebackComment}
        />
      ) : null}
      {showCompletion ? (
        <IssueSourceCompletionCard
          action={completionAction}
          confirmCompletionAction={confirmCompletionAction}
          draft={prDraft}
          host={host}
          repoDefaultBranch={repoDefaultBranch}
          target={prTarget}
          onActionChange={setCompletionAction}
          onConfirmCompletionActionChange={setConfirmCompletionAction}
          onDraftChange={setPrDraft}
          onTargetChange={setPrTarget}
        />
      ) : null}
      {errorMessage ? (
        <p className="settings-status" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <div className="settings-form__actions-row settings-form__actions-row--footer">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (sourceBaseline) {
              applySettings(sourceBaseline, {
                setMode,
                setScope,
                setLabel,
                setSyncEnabled,
                setIntervalSeconds,
                setCloseOnComplete,
                setCloseOnMerge,
                setWritebackComment,
                setConnection,
              });
            }
            if (completionBaseline) {
              setCompletionAction(completionBaseline.action);
              setPrTarget(completionBaseline.target);
              setPrDraft(completionBaseline.draft);
              setConfirmCompletionAction(completionBaseline.confirm);
            }
          }}
        >
          {messages.settings.cancel}
        </Button>
        <Button
          className="settings-save-button"
          disabled={isLoading || isSaving || labelRequired}
          type="submit"
        >
          {isSaving ? messages.settings.saving : messages.settings.save}
        </Button>
      </div>
    </form>
  );
}

interface SettingsSetters {
  setMode: (value: IssueSourceMode) => void;
  setScope: (value: IssueSyncScope) => void;
  setLabel: (value: string) => void;
  setSyncEnabled: (value: boolean) => void;
  setIntervalSeconds: (value: number) => void;
  setCloseOnComplete: (value: boolean) => void;
  setCloseOnMerge: (value: boolean) => void;
  setWritebackComment: (value: boolean) => void;
  setConnection: (value: ProjectIssueConnection) => void;
}

function applySettings(
  settings: ProjectIssueSourceSettings,
  setters: SettingsSetters,
): void {
  setters.setMode(settings.issueSourceMode);
  setters.setScope(settings.issueSyncScope);
  setters.setLabel(settings.issueSyncLabel ?? "");
  setters.setSyncEnabled(settings.issueSyncEnabled);
  setters.setIntervalSeconds(settings.issueSyncIntervalSeconds);
  setters.setCloseOnComplete(settings.issueWritebackCloseOnComplete);
  setters.setCloseOnMerge(settings.issueWritebackCloseOnPrMerge);
  setters.setWritebackComment(settings.issueWritebackComment);
  setters.setConnection(settings.connection);
}
