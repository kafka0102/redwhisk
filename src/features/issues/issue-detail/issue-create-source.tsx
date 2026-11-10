import { useEffect, useState, type JSX } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useI18n } from "../../../shared/i18n/i18n";
import {
  getProjectIssueSourceSettings,
  updateProjectIssueSourceSettings,
  type IssueCreateSource,
  type ProjectIssueSourceSettings,
} from "../../settings/issue-source-commands";
import { isIssueConnectionReady } from "../issue-connection";

interface IssueCreateSourceProps {
  projectId: number;
  active: boolean;
  onOpenSettings: () => void;
  onBlockedChange: (blocked: boolean) => void;
  onChoiceChange: (choice: IssueCreateSource | null) => void;
  children: (sourceControl: JSX.Element | null) => JSX.Element;
}

function knownProvider(
  provider: ProjectIssueSourceSettings["connection"]["provider"],
): "github" | "gitlab" | null {
  if (provider === "github" || provider === "gitlab") {
    return provider;
  }
  return null;
}

export function IssueCreateSource({
  projectId,
  active,
  onOpenSettings,
  onBlockedChange,
  onChoiceChange,
  children,
}: IssueCreateSourceProps): JSX.Element {
  const { t } = useI18n();
  const [settings, setSettings] = useState<ProjectIssueSourceSettings | null>(
    null,
  );
  const [choice, setChoice] = useState<IssueCreateSource>("local");

  function layout(
    sourceControl: JSX.Element | null,
    status: JSX.Element | null = null,
  ): JSX.Element {
    return (
      <>
        {status}
        {children(sourceControl)}
      </>
    );
  }

  // active 关闭时在渲染期清空。未返回或已关闭都不渲染来源，且不在 effect 里 setState。
  if (!active && settings !== null) {
    setSettings(null);
  }

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    void getProjectIssueSourceSettings(projectId)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setSettings(loaded);
        const remoteSelectable =
          loaded.issueSourceMode === "mixed" &&
          knownProvider(loaded.connection.provider) !== null &&
          isIssueConnectionReady(loaded);
        setChoice(
          loaded.issueCreateSource === "remote" && remoteSelectable
            ? "remote"
            : "local",
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSettings(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, projectId]);

  useEffect(() => {
    if (!active || settings === null) {
      onBlockedChange(false);
      onChoiceChange(null);
      return;
    }
    const ready = isIssueConnectionReady(settings);
    if (settings.issueSourceMode === "remote") {
      onBlockedChange(!ready);
      onChoiceChange(ready ? "remote" : null);
      return;
    }
    if (settings.issueSourceMode !== "mixed") {
      onBlockedChange(false);
      onChoiceChange(null);
      return;
    }
    onBlockedChange(false);
    onChoiceChange(choice);
  }, [active, choice, onBlockedChange, onChoiceChange, settings]);

  if (!active || settings === null) {
    return layout(null);
  }
  if (
    settings.issueSourceMode === "remote" &&
    !isIssueConnectionReady(settings)
  ) {
    return layout(
      null,
      <div
        className="issue-page__status"
        role="status"
        aria-label={t("issues.dialogStatus")}
      >
        <button
          type="button"
          className="issue-create-source__settings"
          onClick={onOpenSettings}
        >
          {t("issues.createSourceOpenSettings")}
        </button>
      </div>,
    );
  }
  if (settings.issueSourceMode !== "mixed") {
    return layout(null);
  }

  const provider = knownProvider(settings.connection.provider);
  const remoteDisabled = !isIssueConnectionReady(settings);
  const remoteLabel =
    provider === "gitlab"
      ? t("issues.createSourceGitlab")
      : t("issues.createSourceGithub");
  const items: Array<{ value: IssueCreateSource; label: string }> = [
    { value: "local", label: t("issues.createSourceLocal") },
  ];
  if (provider !== null) {
    items.push({ value: "remote", label: remoteLabel });
  }

  async function select(next: IssueCreateSource): Promise<void> {
    if (next === "remote" && (provider === null || remoteDisabled)) {
      return;
    }
    const previous = choice;
    setChoice(next);
    try {
      await updateProjectIssueSourceSettings({
        projectId,
        issueCreateSource: next,
      });
    } catch {
      setChoice(previous);
    }
  }

  return layout(
    <div className="issue-create-source">
      <Select
        items={items}
        value={choice}
        onValueChange={(next) => {
          if (next === "local" || next === "remote") {
            void select(next);
          }
        }}
      >
        <SelectTrigger
          aria-label={t("issues.createSourceLabel")}
          className="issue-create-source__trigger"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem
              key={item.value}
              disabled={item.value === "remote" && remoteDisabled}
              value={item.value}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>,
  );
}
