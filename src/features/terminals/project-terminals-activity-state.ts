import { DEFAULT_ACTIVITY_SIDEBAR_WIDTH } from "../../shared/layout/sidebar-width";

export interface ProjectTerminalCardState {
  configId: number;
  launchCommand: string;
  name: string;
  sessionId: number;
  workingDir: string;
}

export interface ProjectTerminalsActivityState {
  hasHydrated: boolean;
  selectedConfigId: number | null;
  sidebarWidth: number;
  terminalCards: ProjectTerminalCardState[];
}

export function getDefaultProjectTerminalsActivityState(): ProjectTerminalsActivityState {
  return {
    hasHydrated: false,
    selectedConfigId: null,
    sidebarWidth: DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
    terminalCards: [],
  };
}
