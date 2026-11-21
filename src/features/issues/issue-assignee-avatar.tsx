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
      <circle cx="8" cy="6.2" fill="currentColor" r="2.1" />
      <path
        d="M5.2 11.2c.45-1.7 1.4-2.5 2.8-2.5s2.35.8 2.8 2.5c.08.3-.14.55-.42.55H5.62c-.28 0-.5-.25-.42-.55z"
        fill="currentColor"
      />
    </svg>
  );
}
