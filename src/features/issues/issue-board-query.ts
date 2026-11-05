import type { ListIssuesInput } from "./issue-commands";
import type { IssueSourceFilter } from "./issue-source-filter";

export function issueBoardListInput(
  projectId: number,
  sourceFilter: IssueSourceFilter,
  page: Omit<ListIssuesInput, "projectId" | "sourceFilter">,
): ListIssuesInput {
  if (sourceFilter === "all") {
    return { projectId, ...page };
  }
  return { projectId, sourceFilter, ...page };
}
