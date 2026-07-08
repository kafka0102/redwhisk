import type { SessionSidePanelTab } from "./session-workspace-types";

interface SessionReturnState {
  selectedSessionId: number;
  isSidePanelOpen: boolean;
  sidePanelTab: SessionSidePanelTab;
}

const sessionReturnStateByProjectId = new Map<number, SessionReturnState>();

export function getSessionReturnState(
  projectId: number,
): SessionReturnState | null {
  return sessionReturnStateByProjectId.get(projectId) ?? null;
}

export function setSessionReturnState(
  projectId: number,
  state: SessionReturnState,
) {
  sessionReturnStateByProjectId.set(projectId, state);
}

export function clearSessionReturnState(projectId: number) {
  sessionReturnStateByProjectId.delete(projectId);
}
