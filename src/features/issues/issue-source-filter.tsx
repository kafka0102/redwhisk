import type { JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { ForgeProvider } from "../settings/issue-source-commands";

export type IssueSourceFilter = "all" | "local" | "remote";

export function IssueSourceFilter({
  provider,
  value,
  onChange,
}: {
  provider: ForgeProvider | null;
  value: IssueSourceFilter;
  onChange: (value: IssueSourceFilter) => void;
}): JSX.Element {
  const { t } = useI18n();
  const remoteLabel =
    provider === "gitlab"
      ? t("issues.gitlabBadge")
      : provider === "github"
        ? t("issues.githubBadge")
        : t("issues.sourceFilterRemoteUnknown");
  return (
    <select
      aria-label={t("issues.sourceFilterLabel")}
      className="issue-source-filter"
      value={value}
      onChange={(event) => {
        onChange(event.target.value as IssueSourceFilter);
      }}
    >
      <option value="all">{t("issues.sourceFilterAll")}</option>
      <option value="local">{t("issues.sourceFilterLocal")}</option>
      <option value="remote">{remoteLabel}</option>
    </select>
  );
}
