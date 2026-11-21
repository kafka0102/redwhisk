import type { JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { IssueRecord } from "./issue-commands";
import { toBoardRecord } from "./issue-mirror-fields";

export function IssueAssigneeAvatar({
  issue,
}: {
  issue: IssueRecord;
}): JSX.Element | null {
  const { t } = useI18n();
  const record = toBoardRecord(issue);
  if (record.source !== "remote") {
    const label = t("issues.assignToMe");
    return (
      <span className="issue-assignee">
        <span
          aria-label={label}
          className="issue-assignee__avatar"
          role="img"
          tabIndex={0}
          title={label}
        >
          <DefaultAvatar />
        </span>
      </span>
    );
  }

  const assignee = record.remoteAssignee;
  if (assignee == null || assignee.login.trim() === "") {
    return null;
  }
  const name = assignee.name.trim() || assignee.login;
  const identity = `${name} @${assignee.login}`;
  return (
    <span className="issue-assignee">
      <span
        aria-label={`${t("issues.assigneeLabel")} ${identity}`}
        className="issue-assignee__avatar"
        role="img"
        tabIndex={0}
        title={identity}
      >
        {assignee.avatarUrl ? (
          <img alt="" src={assignee.avatarUrl} />
        ) : (
          <DefaultAvatar />
        )}
      </span>
      <span className="issue-assignee__tip">
        <span>{t("issues.assigneeLabel")}</span>
        <span>{identity}</span>
      </span>
    </span>
  );
}

function DefaultAvatar(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="issue-assignee__glyph"
      viewBox="0 0 16 16"
    >
      <circle cx="8" cy="6.1" fill="currentColor" r="2.05" />
      <path
        d="M4.1 12.4c.55-2.05 2-3.05 3.9-3.05s3.35 1 3.9 3.05c.1.35-.18.7-.55.7H4.65c-.37 0-.65-.35-.55-.7z"
        fill="currentColor"
      />
    </svg>
  );
}
