import type { JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";

export type IssueSourceFilter = "all" | "local" | "remote";

export function IssueSourceFilter({
  value,
  onChange,
}: {
  value: IssueSourceFilter;
  onChange: (value: IssueSourceFilter) => void;
}): JSX.Element {
  const { t } = useI18n();
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
      <option value="remote">{t("issues.sourceFilterRemote")}</option>
    </select>
  );
}
