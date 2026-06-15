import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
} from "../../shared/layout/sidebar-width";

export interface ProjectTerminalCardState {
  name: string;
  sessionId: number;
}

export interface ProjectTerminalsActivityState {
  selectedSessionId: number | null;
  selectedTerminalColor: string;
  sidebarWidth: number;
  terminalCards: ProjectTerminalCardState[];
}

export const DEFAULT_TERMINAL_CARD_BACKGROUND = "#ffffff";

export function getDefaultProjectTerminalsActivityState(): ProjectTerminalsActivityState {
  return {
    selectedSessionId: null,
    selectedTerminalColor: DEFAULT_TERMINAL_CARD_BACKGROUND,
    sidebarWidth: DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
    terminalCards: [],
  };
}
