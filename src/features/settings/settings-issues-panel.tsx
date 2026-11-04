import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import { Button } from "../../components/ui/button";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  getProjectIssueSourceSettings,
  inspectProjectIssueConnection,
  updateProjectIssueSourceSettings,
  type IssueSourceMode,
  type IssueSyncScope,
  type ProjectIssueConnection,
  type ProjectIssueSourceSettings,
} from "./issue-source-commands";
import { IssueSourceConnectionCard } from "./settings-issues-connection-card";
import { IssueSourceModeCard } from "./settings-issues-mode-card";

interface IssuesSettingsPanelProps {
  projectId: number;
}

export function IssuesSettingsPanel({
  projectId,
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);

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
        const inspected = await inspectProjectIssueConnection(projectId);
        if (cancelled) return;
        setConnection(inspected.connection);
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

  const labelRequired = scope === "label" && label.trim().length === 0;

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

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (labelRequired || isSaving) return;
    setErrorMessage(null);
    setIsSaving(true);
    try {
      await updateProjectIssueSourceSettings({
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
      const refreshed = await getProjectIssueSourceSettings(projectId);
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
    } catch (error: unknown) {
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void handleSubmit(event)}>
      <IssueSourceModeCard mode={mode} onModeChange={setMode} />
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
      {errorMessage ? (
        <p className="settings-status" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <div className="settings-form__actions-row settings-form__actions-row--footer">
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
