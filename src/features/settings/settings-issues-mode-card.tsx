import { useId, type ReactElement } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import { cn } from "../../lib/utils";
import type { IssueSourceMode } from "./issue-source-commands";

const MODE_OPTIONS: IssueSourceMode[] = ["local", "remote", "mixed"];

interface IssueSourceModeCardProps {
  mode: IssueSourceMode;
  onModeChange: (mode: IssueSourceMode) => void;
  disabled?: boolean;
}

export function IssueSourceModeCard({
  mode,
  onModeChange,
  disabled = false,
}: IssueSourceModeCardProps): ReactElement {
  const { t } = useI18n();
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="settings-card">
      <div className="settings-card__header">
        <h4 id={titleId}>{t("settings.issueSource.mode")}</h4>
      </div>
      <div
        aria-label={t("settings.issueSource.mode")}
        className="grid grid-cols-3 gap-2"
        role="radiogroup"
      >
        {MODE_OPTIONS.map((option) => {
          const selected = mode === option;
          return (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                selected
                  ? "border-[var(--color-text)]"
                  : "border-[var(--color-border)]",
              )}
              data-mode-card=""
              data-selected={selected ? "true" : undefined}
            >
              <input
                checked={selected}
                className="size-3.5 shrink-0"
                disabled={disabled}
                name="issue-source-mode"
                type="radio"
                onClick={(event) => {
                  event.preventDefault();
                  onModeChange(option);
                }}
                onChange={() => {
                  onModeChange(option);
                }}
              />
              {t(`settings.issueSource.modeValue.${option}`)}
            </label>
          );
        })}
      </div>
    </section>
  );
}
