import type { JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useI18n } from "../../shared/i18n/i18n";
import type { ChangeRequestDetail } from "./change-request-commands";

export function ChangeRequestDetailOverview({
  detail,
  onOpenIssue,
}: {
  detail: ChangeRequestDetail;
  onOpenIssue?: (issueId: number) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="change-request-detail__stack">
      <section className="change-request-panel">
        <h3>{t("issues.changeRequests.description")}</h3>
        <div className="change-request-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {detail.body}
          </ReactMarkdown>
        </div>
      </section>
      {detail.linkedIssues.length === 0 ? null : (
        <section className="change-request-panel">
          <h3>{t("issues.changeRequests.linkedIssues")}</h3>
          <ul>
            {detail.linkedIssues.map((issue) => (
              <li key={issue.issueId}>
                <button
                  type="button"
                  onClick={() => onOpenIssue?.(issue.issueId)}
                >
                  {issue.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {detail.reviewers.length === 0 ? null : (
        <section className="change-request-panel">
          <h3>{t("issues.changeRequests.reviewers")}</h3>
          <div className="change-request-chip-row">
            {detail.reviewers.map((reviewer) => (
              <span key={reviewer.login} className="change-request-chip">
                {reviewer.state
                  ? `${reviewer.login} · ${reviewer.state}`
                  : reviewer.login}
              </span>
            ))}
          </div>
        </section>
      )}
      {detail.labels.length === 0 ? null : (
        <section className="change-request-panel">
          <h3>{t("issues.changeRequests.labels")}</h3>
          <div className="change-request-chip-row">
            {detail.labels.map((label) => (
              <span key={label} className="change-request-chip">
                {label}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
