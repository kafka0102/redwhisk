import { useEffect, useState } from "react";

import { getIssueDetail } from "../issue-detail/issue-detail-commands";

interface RemoteIssueUrlSnapshot {
  issueId: number;
  projectId: number;
  url: string | null;
}

export function useRemoteIssueUrl(
  projectId: number,
  issueId: number,
): string | null {
  const [snapshot, setSnapshot] = useState<RemoteIssueUrlSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getIssueDetail({ projectId, issueId })
      .then((detail) => {
        if (cancelled) {
          return;
        }
        const url = detail.projection?.externalUrl.trim() ?? "";
        setSnapshot({
          issueId,
          projectId,
          url: url.length > 0 ? url : null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot({ issueId, projectId, url: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [issueId, projectId]);

  if (
    snapshot === null ||
    snapshot.issueId !== issueId ||
    snapshot.projectId !== projectId
  ) {
    return null;
  }
  return snapshot.url;
}
