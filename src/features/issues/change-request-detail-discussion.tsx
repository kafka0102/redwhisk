import type { JSX } from "react";

import { useI18n } from "../../shared/i18n/i18n";
import type { ChangeRequestDetail } from "./change-request-commands";
import { discussionsOf } from "./change-request-detail-model";

export function ChangeRequestDetailDiscussion({
  detail,
}: {
  detail: ChangeRequestDetail;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section className="change-request-panel">
      <h3>{t("issues.changeRequests.discussionTab")}</h3>
      <ul className="change-request-discussion">
        {discussionsOf(detail).map((item, index) => (
          <li key={`${item.author}-${item.createdAt}-${index}`}>
            <p className="change-request-discussion__meta">
              <strong>{item.author}</strong>
              <span>
                {item.kind === "review"
                  ? t("issues.changeRequests.reviewKind")
                  : t("issues.changeRequests.commentKind")}
              </span>
              {item.state ? <span>{item.state}</span> : null}
              <time dateTime={new Date(item.createdAt).toISOString()}>
                {new Date(item.createdAt).toLocaleString()}
              </time>
            </p>
            {item.body ? <p>{item.body}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
