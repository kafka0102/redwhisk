import { useEffect, useState, type RefObject } from "react";
import type { TFunction } from "i18next";

import { getCommandErrorMessage } from "../../shared/commands/command-error";
import {
  isGlobalLabelOverridden,
  listProjectLabels,
  type ProjectLabelRecord,
} from "../settings/settings-commands";

export function useIssueLabelCatalog(
  projectId: number,
  activeProjectIdRef: RefObject<number>,
  t: TFunction,
): {
  availableLabels: ProjectLabelRecord[];
  labelsErrorMessage: string | null;
  isLoadingLabels: boolean;
} {
  const [availableLabels, setAvailableLabels] = useState<ProjectLabelRecord[]>(
    [],
  );
  const [labelsProjectId, setLabelsProjectId] = useState(projectId);
  const [labelsLoadState, setLabelsLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [labelsErrorMessage, setLabelsErrorMessage] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let isMounted = true;

    void Promise.all([
      listProjectLabels({ scope: "project", projectId }),
      listProjectLabels({ scope: "global", projectId: null }),
    ])
      .then(([projectResponse, globalResponse]) => {
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        const projectLabels = projectResponse.labels;
        const visibleLabels = [
          ...projectLabels,
          ...globalResponse.labels.filter(
            (label) => !isGlobalLabelOverridden(label, projectLabels),
          ),
        ].sort((left, right) => {
          if (left.scope !== right.scope) {
            return left.scope === "project" ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        });
        setAvailableLabels(visibleLabels);
        setLabelsProjectId(projectId);
        setLabelsErrorMessage(null);
        setLabelsLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!isMounted || activeProjectIdRef.current !== projectId) {
          return;
        }

        setAvailableLabels([]);
        setLabelsProjectId(projectId);
        setLabelsErrorMessage(getCommandErrorMessage(error, t));
        setLabelsLoadState("error");
      });

    return () => {
      isMounted = false;
    };
  }, [activeProjectIdRef, projectId, t]);

  return {
    availableLabels: labelsProjectId === projectId ? availableLabels : [],
    labelsErrorMessage:
      labelsProjectId === projectId ? labelsErrorMessage : null,
    isLoadingLabels:
      labelsProjectId !== projectId || labelsLoadState === "loading",
  };
}
