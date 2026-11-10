import type { JSX } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
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
  const options: Array<{ value: IssueSourceFilter; label: string }> = [
    { value: "all", label: t("issues.sourceFilterAll") },
    { value: "local", label: t("issues.sourceFilterLocal") },
    { value: "remote", label: remoteLabel },
  ];
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next === "all" || next === "local" || next === "remote") {
          onChange(next);
        }
      }}
    >
      <SelectTrigger aria-label={t("issues.sourceFilterLabel")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
