import { useId, type ReactElement } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useI18n } from "../../shared/i18n/i18n";
import {
  type ForgeAuthStatus,
  type ForgeProvider,
  type IssueSyncScope,
  type ProjectIssueConnection,
} from "./issue-source-commands";

const SCOPE_OPTIONS: IssueSyncScope[] = [
  "assigned_to_me",
  "all_open",
  "label",
  "all",
];
const HOST_OPTIONS: ForgeProvider[] = ["github", "gitlab"];
const STANDARD_INTERVALS = [60, 90, 300];

interface IssueSourceConnectionCardProps {
  closeOnComplete: boolean;
  closeOnMerge: boolean;
  connection: ProjectIssueConnection | null;
  intervalSeconds: number;
  isInspecting: boolean;
  isLoading: boolean;
  label: string;
  onCloseOnCompleteChange: (checked: boolean) => void;
  onCloseOnMergeChange: (checked: boolean) => void;
  onIntervalChange: (seconds: number) => void;
  onLabelChange: (label: string) => void;
  onRelogin: () => void;
  onScopeChange: (scope: IssueSyncScope) => void;
  onSyncEnabledChange: (enabled: boolean) => void;
  onWritebackCommentChange: (checked: boolean) => void;
  scope: IssueSyncScope;
  syncEnabled: boolean;
  writebackComment: boolean;
  disabled?: boolean;
}

export function IssueSourceConnectionCard({
  closeOnComplete,
  closeOnMerge,
  connection,
  intervalSeconds,
  isInspecting,
  isLoading,
  label,
  onCloseOnCompleteChange,
  onCloseOnMergeChange,
  onIntervalChange,
  onLabelChange,
  onRelogin,
  onScopeChange,
  onSyncEnabledChange,
  onWritebackCommentChange,
  scope,
  syncEnabled,
  writebackComment,
  disabled = false,
}: IssueSourceConnectionCardProps): ReactElement {
  const { t } = useI18n();
  const titleId = useId();
  const provider = connection?.provider ?? null;
  const tone = connection ? connectionTone(connection.authStatus) : null;
  const providerItems = labeledItems(HOST_OPTIONS, (option) =>
    t(`settings.issueSource.providerValue.${option}`),
  );
  const scopeItems = labeledItems(SCOPE_OPTIONS, (option) =>
    t(`settings.issueSource.scopeValue.${option}`),
  );
  const intervalOptions = intervalChoices(intervalSeconds);
  const intervalItems = labeledItems(intervalOptions.map(String), (option) =>
    intervalLabel(Number(option), t),
  );

  return (
    <section aria-labelledby={titleId} className="settings-card">
      <div className="settings-card__header">
        <h4 id={titleId}>{t("settings.issueSource.connectionTitle")}</h4>
      </div>
      <div className="grid grid-cols-2 gap-3" data-row="host-repository">
        <div className="grid min-w-0 gap-1.5">
          <Label>{t("settings.issueSource.host")}</Label>
          <Select
            items={providerItems}
            value={provider}
            onValueChange={() => undefined}
          >
            <SelectTrigger
              aria-label={t("settings.issueSource.host")}
              className="w-full"
              disabled={disabled}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOST_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {providerItems[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor="issue-source-repository">
            {t("settings.issueSource.repository")}
          </Label>
          <Input
            id="issue-source-repository"
            readOnly
            disabled={disabled}
            value={connection?.repoPath ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="issue-source-account">
          {t("settings.issueSource.account")}
        </Label>
        <div className="flex items-center gap-2" data-row="account">
          <Input
            className="min-w-0 flex-1"
            id="issue-source-account"
            readOnly
            disabled={disabled}
            value={connection?.login ?? ""}
          />
          {connection && tone ? (
            <Badge
              className={
                tone === "ready"
                  ? "bg-[rgba(36,148,71,0.1)] text-[var(--color-lane-review-marker)]"
                  : "bg-muted text-muted-foreground"
              }
              data-testid="issue-source-status"
              data-tone={tone}
              variant="outline"
            >
              {connectionStatus(connection, t)}
            </Badge>
          ) : null}
          <Button
            disabled={disabled || isInspecting || isLoading}
            type="button"
            variant="outline"
            onClick={onRelogin}
          >
            {t("settings.issueSource.relogin")}
          </Button>
        </div>
      </div>

      <hr className="m-0 h-px w-full border-0 bg-[var(--color-border)]" />

      <div className="grid gap-1.5">
        <Label>{t("settings.issueSource.scope")}</Label>
        <Select
          items={scopeItems}
          value={scope}
          onValueChange={(value) => {
            if (isIssueSyncScope(value)) onScopeChange(value);
          }}
        >
          <SelectTrigger
            aria-label={t("settings.issueSource.scope")}
            className="w-full"
            disabled={disabled}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPE_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {scopeItems[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {scope === "label" ? (
          <Input
            aria-label={t("settings.issueSource.label")}
            disabled={disabled}
            value={label}
            onChange={(event) => onLabelChange(event.target.value)}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3" data-row="sync-interval">
        <div className="grid gap-1.5">
          <p className="text-sm leading-none font-medium">
            {t("settings.issueSource.autoSyncTitle")}
          </p>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={syncEnabled}
              id="issue-source-sync"
              disabled={disabled}
              onCheckedChange={(checked) =>
                onSyncEnabledChange(checked === true)
              }
            />
            <Label htmlFor="issue-source-sync">
              {t("settings.issueSource.autoSync")}
            </Label>
          </div>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label>{t("settings.issueSource.interval")}</Label>
          <Select
            items={intervalItems}
            value={String(intervalSeconds)}
            onValueChange={(value) => {
              if (typeof value !== "string") return;
              const seconds = Number(value);
              if (Number.isInteger(seconds) && seconds >= 60) {
                onIntervalChange(seconds);
              }
            }}
          >
            <SelectTrigger
              aria-label={t("settings.issueSource.interval")}
              className="w-full"
              disabled={disabled}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {intervalOptions.map((seconds) => (
                <SelectItem key={seconds} value={String(seconds)}>
                  {intervalItems[String(seconds)]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-sm leading-none font-medium">
          {t("settings.issueSource.writebackTitle")}
        </p>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={closeOnComplete}
            id="issue-source-close-complete"
            disabled={disabled}
            onCheckedChange={(checked) =>
              onCloseOnCompleteChange(checked === true)
            }
          />
          <Label htmlFor="issue-source-close-complete">
            {t("settings.issueSource.writebackClose")}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={closeOnMerge}
            id="issue-source-close-merge"
            disabled={disabled}
            onCheckedChange={(checked) =>
              onCloseOnMergeChange(checked === true)
            }
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
            checked={writebackComment}
            id="issue-source-writeback-comment"
            disabled={disabled}
            onCheckedChange={(checked) =>
              onWritebackCommentChange(checked === true)
            }
          />
          <Label htmlFor="issue-source-writeback-comment">
            {t("settings.issueSource.writebackComment")}
          </Label>
        </div>
      </div>
    </section>
  );
}

function labeledItems(
  values: readonly string[],
  labelFor: (value: string) => string,
): Record<string, string> {
  return Object.fromEntries(values.map((value) => [value, labelFor(value)]));
}

function isIssueSyncScope(value: unknown): value is IssueSyncScope {
  return (
    value === "assigned_to_me" ||
    value === "all_open" ||
    value === "label" ||
    value === "all"
  );
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

function connectionTone(
  status: ForgeAuthStatus,
): "ready" | "signed-out" | "muted" {
  if (status === "ready") return "ready";
  if (status === "unauthenticated") return "signed-out";
  return "muted";
}

function connectionStatus(
  connection: ProjectIssueConnection,
  t: (key: string) => string,
): string {
  if (connection.authStatus === "cli_missing") {
    return t("settings.issueSource.cliMissing");
  }
  if (connection.authStatus === "unauthenticated") {
    return t("settings.issueSource.signedOut");
  }
  if (connection.authStatus === "expired") {
    return t("settings.issueSource.expired");
  }
  if (connection.authStatus === "not_forge") {
    return t("settings.issueSource.notForge");
  }
  if (connection.authStatus === "ready") return t("settings.issueSource.ready");
  return t("settings.issueSource.unknown");
}
