import { useEffect, useState, type ReactNode } from "react";

import {
  getProjectIssueSourceSettings,
  type IssueSourceMode,
} from "../settings/issue-source-commands";
import { IssueSyncToolbar } from "./issue-sync-toolbar";

export function useIssueSyncChrome(
  projectId: number,
  onReload: () => void,
): {
  sourceMode: IssueSourceMode | null;
  toolbar: ReactNode;
} {
  const [sourceMode, setSourceMode] = useState<IssueSourceMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProjectIssueSourceSettings(projectId)
      .then((settings) => {
        if (!cancelled) {
          setSourceMode(settings.issueSourceMode);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSourceMode(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return {
    sourceMode,
    toolbar: <IssueSyncToolbar projectId={projectId} onReload={onReload} />,
  };
}
