export interface SessionInlineTerminal {
  terminalSessionId: number;
  name: string;
  workingDir: string;
  launchCommand: string;
}

export interface SessionInlineTerminalPanelState {
  activeTerminalSessionId: number | null;
  closingTerminalSessionIds: number[];
  errorMessage: string | null;
  height: number;
  isCreating: boolean;
  isMaximized: boolean;
  terminals: SessionInlineTerminal[];
}

export const DEFAULT_SESSION_TERMINAL_PANEL_HEIGHT = 200;
export const SESSION_TERMINAL_PANEL_MIN_HEIGHT = 120;
export const SESSION_TERMINAL_PANEL_MAX_HEIGHT = 520;

export function createDefaultSessionInlineTerminalPanelState(): SessionInlineTerminalPanelState {
  return {
    activeTerminalSessionId: null,
    closingTerminalSessionIds: [],
    errorMessage: null,
    height: DEFAULT_SESSION_TERMINAL_PANEL_HEIGHT,
    isCreating: false,
    isMaximized: false,
    terminals: [],
  };
}

export function clampSessionTerminalPanelHeight(height: number): number {
  return Math.min(
    SESSION_TERMINAL_PANEL_MAX_HEIGHT,
    Math.max(SESSION_TERMINAL_PANEL_MIN_HEIGHT, height),
  );
}
