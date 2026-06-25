import { Maximize2, Minimize2, Plus, X } from "lucide-react";

import { ProjectTerminal } from "../terminals/project-terminal";
import type { SessionInlineTerminalPanelState } from "./session-inline-terminal-panel-state";
import { useI18n } from "../../shared/i18n/i18n";

interface SessionInlineTerminalPanelProps {
  agentSessionId: number;
  projectId: number;
  state: SessionInlineTerminalPanelState;
  onCloseTerminal: (terminalSessionId: number) => void;
  onCreateTerminal: (agentSessionId: number) => void;
  onSelectTerminal: (terminalSessionId: number) => void;
  onToggleMaximized: () => void;
}

export function SessionInlineTerminalPanel({
  agentSessionId,
  projectId,
  state,
  onCloseTerminal,
  onCreateTerminal,
  onSelectTerminal,
  onToggleMaximized,
}: SessionInlineTerminalPanelProps) {
  const { messages } = useI18n();
  const activeTerminal =
    state.terminals.find(
      (terminal) =>
        terminal.terminalSessionId === state.activeTerminalSessionId,
    ) ??
    state.terminals[0] ??
    null;

  return (
    <section
      aria-label={messages.agentsFeature.sessionTerminals}
      className={`session-inline-terminal-panel${
        state.isMaximized ? " session-inline-terminal-panel--maximized" : ""
      }`}
    >
      <div className="session-inline-terminal-panel__tabs">
        <div
          aria-label={messages.agentsFeature.sessionInlineTabs}
          className="session-inline-terminal-panel__tab-list"
          role="tablist"
        >
          {state.terminals.map((terminal) => {
            const isActive =
              terminal.terminalSessionId === activeTerminal?.terminalSessionId;
            const isClosing = state.closingTerminalSessionIds.includes(
              terminal.terminalSessionId,
            );

            return (
              <span
                key={terminal.terminalSessionId}
                className="session-inline-terminal-panel__tab-shell"
              >
                <button
                  aria-selected={isActive}
                  className="session-inline-terminal-panel__tab"
                  role="tab"
                  title={terminal.workingDir}
                  type="button"
                  onClick={() => onSelectTerminal(terminal.terminalSessionId)}
                >
                  <span className="session-inline-terminal-panel__tab-label">
                    {terminal.name}
                  </span>
                </button>
                <button
                  aria-label={messages.agentsFeature.closeSessionTerminal(
                    terminal.name,
                  )}
                  className="session-inline-terminal-panel__close"
                  disabled={isClosing}
                  type="button"
                  onClick={() => onCloseTerminal(terminal.terminalSessionId)}
                >
                  <X aria-hidden="true" size={12} strokeWidth={1.8} />
                </button>
              </span>
            );
          })}
        </div>
        <button
          aria-label={messages.agentsFeature.newInlineTerminal}
          className="session-inline-terminal-panel__icon"
          disabled={state.isCreating}
          type="button"
          onClick={() => onCreateTerminal(agentSessionId)}
        >
          <Plus aria-hidden="true" size={14} strokeWidth={2} />
        </button>
        <span className="session-inline-terminal-panel__spacer" />
        <button
          aria-label={
            state.isMaximized
              ? messages.agentsFeature.sessionInlineRestore
              : messages.agentsFeature.sessionInlineMaximize
          }
          aria-pressed={state.isMaximized}
          className="session-inline-terminal-panel__icon"
          type="button"
          onClick={onToggleMaximized}
        >
          {state.isMaximized ? (
            <Minimize2 aria-hidden="true" size={14} strokeWidth={1.9} />
          ) : (
            <Maximize2 aria-hidden="true" size={14} strokeWidth={1.9} />
          )}
        </button>
      </div>
      {state.errorMessage ? (
        <p className="session-inline-terminal-panel__status" role="status">
          {state.errorMessage}
        </p>
      ) : null}
      {!state.isMaximized && activeTerminal ? (
        <div className="session-inline-terminal-panel__surface">
          <ProjectTerminal
            projectId={projectId}
            sessionId={activeTerminal.terminalSessionId}
          />
        </div>
      ) : null}
    </section>
  );
}
