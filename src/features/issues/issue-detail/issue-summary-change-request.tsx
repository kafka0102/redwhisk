import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { useI18n } from "../../../shared/i18n/i18n";
import {
  viewProjectChangeRequest,
  type ChangeRequestStatus,
} from "../../project/project-forge-commands";

interface IssueSummaryChangeRequestProps {
  projectId: number;
  url: string;
}

export function IssueSummaryChangeRequest({
  projectId,
  url,
}: IssueSummaryChangeRequestProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ChangeRequestStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void viewProjectChangeRequest({ projectId, reference: url })
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, url]);

  return (
    <>
      <p>
        {`${t("issueSummary.pullRequestUrl")}: `}
        <button
          type="button"
          className="underline"
          onClick={() => {
            void openUrl(url);
          }}
        >
          {url}
        </button>
      </p>
      {status ? (
        <>
          <p>{`${t("issueSummary.pullRequestTitle")}: ${status.title}`}</p>
          <p>{`${t("issueSummary.pullRequestState")}: ${requestStateLabel(status.state, t)}`}</p>
          {status.checks.length > 0 ? (
            <p>
              {`${t("issueSummary.pullRequestChecks")}: ${status.checks
                .map((check) =>
                  check.status.length > 0
                    ? `${check.name} ${check.status}`
                    : check.name,
                )
                .join(", ")}`}
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function requestStateLabel(
  state: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (state) {
    case "OPEN":
      return t("issueSummary.requestStateOpen");
    case "DRAFT":
      return t("issueSummary.requestStateDraft");
    case "CLOSED":
      return t("issueSummary.requestStateClosed");
    case "MERGED":
      return t("issueSummary.requestStateMerged");
    default:
      return state;
  }
}
