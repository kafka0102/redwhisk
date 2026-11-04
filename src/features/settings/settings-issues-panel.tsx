import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import { Button } from "../../components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  getProjectIssueSourceSettings,
  inspectProjectIssueConnection,
  updateProjectIssueSourceSettings,
  type ForgeProvider,
  type IssueSourceMode,
  type IssueSyncScope,
  type ProjectIssueConnection,
  type ProjectIssueSourceSettings,
} from "./issue-source-commands";

const MODE_OPTIONS: IssueSourceMode[] = ["local", "remote", "mixed"];
const SCOPE_OPTIONS: IssueSyncScope[] = [
  "assigned_to_me",
  "all_open",
  "label",
  "all",
];
const STANDARD_INTERVALS = [60, 90, 300];

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

  const provider = connection?.provider ?? null;
  const labelRequired = scope === "label" && label.trim().length === 0;
  const intervalOptions = intervalChoices(intervalSeconds);

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
    <form
      className="settings-card settings-issues-card"
      onSubmit={handleSubmit}
    >
      <div
        className="grid grid-cols-3 gap-2"
        role="radiogroup"
        aria-label={t("settings.issueSource.mode")}
      >
        {MODE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            className="rounded-lg border px-3 py-2 text-sm"
            onClick={() => setMode(option)}
          >
            {t(`settings.issueSource.modeValue.${option}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="issue-source-host">
          {t("settings.issueSource.host")}
        </Label>
        <Input
          id="issue-source-host"
          readOnly
          value={connection?.hostUrl ?? ""}
        />
        <Label htmlFor="issue-source-repository">
          {t("settings.issueSource.repository")}
        </Label>
        <Input
          id="issue-source-repository"
          readOnly
          value={connection?.repoPath ?? ""}
        />
        <Label htmlFor="issue-source-account">
          {t("settings.issueSource.account")}
        </Label>
        <Input
          id="issue-source-account"
          readOnly
          value={connection?.login ?? ""}
        />
        <p data-testid="issue-source-status">
          {connection ? connectionStatus(connection, provider, t) : ""}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={isInspecting || isLoading}
          onClick={() => {
            void handleRelogin();
          }}
        >
          {t("settings.issueSource.relogin")}
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label>{t("settings.issueSource.scope")}</Label>
        <Select
          value={scope}
          onValueChange={(value) => setScope(value as IssueSyncScope)}
        >
          <SelectTrigger aria-label={t("settings.issueSource.scope")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPE_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`settings.issueSource.scopeValue.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scope === "label" ? (
          <Input
            aria-label={t("settings.issueSource.label")}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="issue-source-sync"
          checked={syncEnabled}
          onCheckedChange={(checked) => setSyncEnabled(checked === true)}
        />
        <Label htmlFor="issue-source-sync">
          {t("settings.issueSource.autoSync")}
        </Label>
      </div>
      {mode === "local" ? (
        <p>{t("settings.issueSource.localOnlyHint")}</p>
      ) : null}

      <div className="grid gap-1.5">
        <Label>{t("settings.issueSource.interval")}</Label>
        <Select
          value={String(intervalSeconds)}
          onValueChange={(value) => setIntervalSeconds(Number(value))}
        >
          <SelectTrigger aria-label={t("settings.issueSource.interval")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {intervalOptions.map((seconds) => (
              <SelectItem key={seconds} value={String(seconds)}>
                {intervalLabel(seconds, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="issue-source-close-complete"
            checked={closeOnComplete}
            onCheckedChange={(checked) => setCloseOnComplete(checked === true)}
          />
          <Label htmlFor="issue-source-close-complete">
            {t("settings.issueSource.writebackClose")}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="issue-source-close-merge"
            checked={closeOnMerge}
            onCheckedChange={(checked) => setCloseOnMerge(checked === true)}
          />
          <Label htmlFor="issue-source-close-merge">
            {t(
              provider === "gitlab"
                ? "settings.issueSource.writebackMr"
                : "settings.issueSource.writebackPr",
            )}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="issue-source-writeback-comment"
            checked={writebackComment}
            onCheckedChange={(checked) => setWritebackComment(checked === true)}
          />
          <Label htmlFor="issue-source-writeback-comment">
            {t("settings.issueSource.writebackComment")}
          </Label>
        </div>
      </div>

      {errorMessage ? (
        <p className="settings-status" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <div className="settings-form__actions-row settings-form__actions-row--footer">
        <Button
          type="submit"
          className="settings-save-button"
          disabled={isLoading || isSaving || labelRequired}
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

function intervalChoices(current: number): number[] {
  const values = new Set(STANDARD_INTERVALS);
  if (current >= 60) values.add(current);
  return [...values].sort((left, right) => left - right);
}

function intervalLabel(
  seconds: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (seconds === 60) return t("settings.issueSource.interval60");
  if (seconds === 90) return t("settings.issueSource.interval90");
  if (seconds === 300) return t("settings.issueSource.interval300");
  return t("settings.issueSource.intervalSeconds", { seconds });
}

function connectionStatus(
  connection: ProjectIssueConnection,
  provider: ForgeProvider | null,
  t: (key: string) => string,
): string {
  if (connection.authStatus === "cli_missing") {
    return t("settings.issueSource.cliMissing");
  }
  if (connection.authStatus === "unauthenticated") {
    return t(
      provider === "gitlab"
        ? "settings.issueSource.unauthenticatedGitlab"
        : "settings.issueSource.unauthenticatedGithub",
    );
  }
  if (connection.authStatus === "expired")
    return t("settings.issueSource.expired");
  if (connection.authStatus === "not_forge") {
    return t("settings.issueSource.notForge");
  }
  if (connection.authStatus === "ready") return t("settings.issueSource.ready");
  return t("settings.issueSource.unknown");
}
