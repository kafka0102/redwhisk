import type { Dispatch, SetStateAction } from "react";

import { type LaneTotalsMap, deriveLaneTotals } from "./issue-lane-helpers";
import { ISSUE_PAGE_SIZE } from "./issue-activity-types";
import { issueBoardListInput } from "./issue-board-query";
import { listIssues } from "./issue-commands";
import type { IssueBoardRecord } from "./issue-mirror-commands";
import { toBoardIssues } from "./issue-mirror-fields";
import type { IssueSourceFilter } from "./issue-source-filter";

export function reloadIssueBoard(
  projectId: number,
  sourceFilter: IssueSourceFilter,
  setIssues: Dispatch<SetStateAction<IssueBoardRecord[]>>,
  setLaneTotals: Dispatch<SetStateAction<LaneTotalsMap>>,
): void {
  void listIssues(
    issueBoardListInput(projectId, sourceFilter, {
      perStatusLimit: ISSUE_PAGE_SIZE,
    }),
  ).then((response) => {
    setIssues(toBoardIssues(response.issues));
    setLaneTotals(deriveLaneTotals(response.statusTotals, response.issues));
  });
}
