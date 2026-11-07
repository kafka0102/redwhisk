import { useEffect, useState, type JSX } from "react";

import {
  listProjectChangeRequests,
  type ChangeRequestFilter,
  type ChangeRequestListResponse,
} from "./change-request-commands";
import { ChangeRequestList } from "./change-request-list";

export function ChangeRequestPanel({
  projectId,
  sourceMode,
  onOpenProjectSettings,
}: {
  projectId: number;
  sourceMode: "local" | "remote" | "mixed" | null;
  onOpenProjectSettings?: () => void;
}): JSX.Element | null {
  const [filter, setFilter] = useState<ChangeRequestFilter>("review_requested");
  const [response, setResponse] = useState<ChangeRequestListResponse | null>(
    null,
  );
  const [now] = useState(Date.now);

  useEffect(() => {
    if (sourceMode !== "remote" && sourceMode !== "mixed") {
      return;
    }
    let cancelled = false;
    void listProjectChangeRequests({ projectId, filter })
      .then((next) => {
        if (!cancelled) {
          setResponse(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResponse(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filter, projectId, sourceMode]);

  return (
    <ChangeRequestList
      filter={filter}
      now={now}
      response={response}
      sourceMode={sourceMode}
      onFilterChange={setFilter}
      onOpenProjectSettings={onOpenProjectSettings}
    />
  );
}
