import {
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pencil, Plus, X } from "lucide-react";

import { Button } from "../../components/ui/button";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";
import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
} from "../../shared/layout/sidebar-width";
import { formatHomePathForDisplay } from "../../shared/paths/home-path";
import { ProjectTerminalEditDialog } from "./project-terminal-edit-dialog";
import { ProjectTerminal } from "./project-terminal";
import {
  createProjectTerminal,
  deleteProjectTerminalConfig,
  listProjectTerminals,
} from "./project-terminal-commands";
import type {
  ProjectTerminalCardState,
  ProjectTerminalsActivityState,
} from "./project-terminals-activity-state";

interface ProjectTerminalsActivityProps {
  onStateChange: Dispatch<SetStateAction<ProjectTerminalsActivityState>>;
  projectId: number;
  projectName: string;
  projectPath?: string;
  state: ProjectTerminalsActivityState;
}

const PROJECT_TERMINALS_SIDEBAR_MAX_WIDTH = 420;
const ACTIVE_TERMINAL_CARD_BACKGROUND =
  "color-mix(in srgb, var(--color-accent) 14%, var(--color-surface))";
const ACTIVE_TERMINAL_CARD_BORDER =
  "color-mix(in srgb, var(--color-accent) 52%, var(--color-border-strong))";
const INACTIVE_TERMINAL_CARD_BACKGROUND = "var(--color-surface)";
const INACTIVE_TERMINAL_CARD_BORDER = "var(--color-border)";

function formatTerminalPathForDisplay(path: string): string {
  return formatHomePathForDisplay(path);
}

export function ProjectTerminalsActivity({
  onStateChange,
  projectId,
  projectPath,
  state,
}: ProjectTerminalsActivityProps) {
  const { messages, t } = useI18n();
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [closingConfigId, setClosingConfigId] = useState<number | null>(null);
  const [hydratingTerminals, setHydratingTerminals] = useState(false);
  const [terminalStatusMessage, setTerminalStatusMessage] = useState<
    string | null
  >(null);
  const [editingTerminal, setEditingTerminal] =
    useState<ProjectTerminalCardState | null>(null);
  const dragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);
  const { hasHydrated, selectedConfigId, sidebarWidth, terminalCards } = state;

  const activeTerminal = useMemo(() => {
    const selectedTerminal =
      terminalCards.find((card) => card.configId === selectedConfigId) ?? null;
    return selectedTerminal ?? terminalCards[0] ?? null;
  }, [selectedConfigId, terminalCards]);

  const activeSessionId =
    activeTerminal && activeTerminal.sessionId !== 0
      ? activeTerminal.sessionId
      : null;

  const selectTerminal = useCallback(
    (configId: number) => {
      onStateChange((currentState) => ({
        ...currentState,
        selectedConfigId: configId,
      }));
    },
    [onStateChange],
  );

  const setSidebarWidth = useCallback(
    (width: SetStateAction<number>) => {
      onStateChange((currentState) => ({
        ...currentState,
        sidebarWidth:
          typeof width === "function"
            ? width(currentState.sidebarWidth)
            : width,
      }));
    },
    [onStateChange],
  );

  const hydrateTerminals = useCallback(async () => {
    setHydratingTerminals(true);
    setTerminalStatusMessage(null);

    try {
      const result = await listProjectTerminals({ projectId });
      onStateChange((currentState) => {
        const selectedStillExists = result.terminals.some(
          (terminal) => terminal.configId === currentState.selectedConfigId,
        );
        return {
          ...currentState,
          hasHydrated: true,
          selectedConfigId: selectedStillExists
            ? currentState.selectedConfigId
            : (result.terminals[0]?.configId ?? null),
          terminalCards: result.terminals.map((terminal) => ({
            configId: terminal.configId,
            sessionId: terminal.sessionId,
            name: terminal.name,
            workingDir: terminal.workingDir,
            launchCommand: terminal.launchCommand,
          })),
        };
      });
    } catch (error: unknown) {
      setTerminalStatusMessage(getCommandErrorMessage(error, t));
      onStateChange((currentState) => ({
        ...currentState,
        hasHydrated: true,
      }));
    } finally {
      setHydratingTerminals(false);
    }
  }, [onStateChange, projectId, t]);

  const clearDragState = useCallback(() => {
    if (!dragStateRef.current) {
      return;
    }

    dragStateRef.current = null;
    window.document.body.style.cursor = "";
    window.document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void hydrateTerminals();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hydrateTerminals]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (!dragStateRef.current) {
        return;
      }

      const nextWidth =
        dragStateRef.current.startWidth +
        event.clientX -
        dragStateRef.current.startX;
      setSidebarWidth(clampProjectTerminalsSidebarWidth(nextWidth));
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", clearDragState);
    window.addEventListener("blur", clearDragState);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", clearDragState);
      window.removeEventListener("blur", clearDragState);
      clearDragState();
    };
  }, [clearDragState, setSidebarWidth]);

  async function handleCreateTerminal() {
    if (creatingTerminal) {
      return;
    }

    setTerminalStatusMessage(null);
    setCreatingTerminal(true);

    try {
      const terminal = await createProjectTerminal({ projectId });
      onStateChange((currentState) => ({
        ...currentState,
        hasHydrated: true,
        selectedConfigId: terminal.configId,
        terminalCards: [
          ...currentState.terminalCards,
          {
            configId: terminal.configId,
            sessionId: terminal.sessionId,
            name: terminal.name,
            workingDir: terminal.workingDir,
            launchCommand: terminal.launchCommand,
          },
        ],
      }));
    } catch (error: unknown) {
      setTerminalStatusMessage(getCommandErrorMessage(error, t));
    } finally {
      setCreatingTerminal(false);
    }
  }

  async function handleDeleteTerminal(configId: number) {
    setTerminalStatusMessage(null);
    setClosingConfigId(configId);

    try {
      await deleteProjectTerminalConfig({ projectId, configId });
      onStateChange((currentState) => {
        const remainingCards = currentState.terminalCards.filter(
          (card) => card.configId !== configId,
        );
        const nextSelectedConfigId =
          currentState.selectedConfigId === configId
            ? (remainingCards[0]?.configId ?? null)
            : currentState.selectedConfigId;

        return {
          ...currentState,
          selectedConfigId: nextSelectedConfigId,
          terminalCards: remainingCards,
        };
      });
      if (editingTerminal?.configId === configId) {
        setEditingTerminal(null);
      }
      toast.success(messages.toast.deleteSuccess);
    } catch (error: unknown) {
      setTerminalStatusMessage(getCommandErrorMessage(error, t));
    } finally {
      setClosingConfigId(null);
    }
  }

  function handleTerminalSaved(terminal: ProjectTerminalCardState) {
    onStateChange((currentState) => ({
      ...currentState,
      terminalCards: currentState.terminalCards.map((card) =>
        card.configId === terminal.configId ? terminal : card,
      ),
    }));
    setEditingTerminal(null);
  }

  const showEmptyState =
    hasHydrated && terminalCards.length === 0 && !hydratingTerminals;

  if (!hasHydrated || hydratingTerminals) {
    return (
      <main className="activity-surface activity-surface--terminals-empty">
        <p className="project-terminals-loading" role="status">
          {messages.settings.loadingTerminals}
        </p>
      </main>
    );
  }

  if (showEmptyState) {
    return (
      <main className="activity-surface activity-surface--terminals-empty">
        <Button
          disabled={creatingTerminal}
          type="button"
          variant="outline"
          onClick={() => {
            void handleCreateTerminal();
          }}
        >
          <span>+ {messages.settings.newTerminal}</span>
        </Button>
      </main>
    );
  }

  return (
    <>
      <main
        className="activity-surface activity-surface--terminals"
        style={
          {
            "--project-terminals-sidebar-width": `${sidebarWidth}px`,
          } as CSSProperties
        }
      >
        <aside
          className="project-terminals-sidebar"
          aria-label={messages.settings.projectTerminals}
        >
          <div className="project-terminals-sidebar__header">
            <div className="project-terminals-sidebar__header-copy">
              <h2>{messages.settings.terminals}</h2>
            </div>
            <Button
              aria-label={messages.settings.newTerminal}
              className="project-terminals-sidebar__create"
              disabled={creatingTerminal}
              size="icon"
              type="button"
              variant="outline"
              onClick={() => {
                void handleCreateTerminal();
              }}
            >
              <Plus aria-hidden="true" size={15} strokeWidth={2} />
            </Button>
          </div>

          {terminalStatusMessage ? (
            <p
              className="issues-status"
              role="status"
              aria-label={messages.settings.terminalsStatus}
            >
              {terminalStatusMessage}
            </p>
          ) : null}

          <div className="project-terminals-card-list">
            {terminalCards.map((terminalCard) => {
              const isActive =
                activeTerminal?.configId === terminalCard.configId;
              const displayPath = formatTerminalPathForDisplay(
                terminalCard.workingDir || projectPath || "",
              );

              return (
                <section
                  key={terminalCard.configId}
                  className="project-terminals-card-shell"
                  style={
                    {
                      "--project-terminal-card-background": isActive
                        ? ACTIVE_TERMINAL_CARD_BACKGROUND
                        : INACTIVE_TERMINAL_CARD_BACKGROUND,
                      "--project-terminal-card-border": isActive
                        ? ACTIVE_TERMINAL_CARD_BORDER
                        : INACTIVE_TERMINAL_CARD_BORDER,
                    } as CSSProperties
                  }
                >
                  <button
                    aria-label={terminalCard.name}
                    aria-pressed={isActive}
                    className="project-terminals-card"
                    type="button"
                    onClick={() => {
                      selectTerminal(terminalCard.configId);
                    }}
                  >
                    <span className="project-terminals-card__copy">
                      <span className="project-terminals-card__name">
                        {terminalCard.name}
                      </span>
                      <span className="project-terminals-card__meta">
                        {displayPath}
                      </span>
                    </span>
                  </button>
                  <div className="project-terminals-card__actions">
                    <button
                      aria-label={messages.settings.editTerminal(
                        terminalCard.name,
                      )}
                      className="project-terminals-card__edit"
                      type="button"
                      onClick={() => {
                        setEditingTerminal(terminalCard);
                      }}
                    >
                      <Pencil size={12} strokeWidth={2} />
                    </button>
                    <button
                      aria-label={messages.settings.deleteTerminal(
                        terminalCard.name,
                      )}
                      className="project-terminals-card__delete"
                      disabled={closingConfigId === terminalCard.configId}
                      type="button"
                      onClick={() => {
                        void handleDeleteTerminal(terminalCard.configId);
                      }}
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </aside>

        <div
          aria-label={messages.settings.splitterLabel}
          aria-orientation="vertical"
          aria-valuemax={PROJECT_TERMINALS_SIDEBAR_MAX_WIDTH}
          aria-valuemin={DEFAULT_ACTIVITY_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          className="project-terminals-splitter"
          role="separator"
          tabIndex={0}
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            event.preventDefault();
            dragStateRef.current = {
              startWidth: sidebarWidth,
              startX: event.clientX,
            };
            window.document.body.style.cursor = "col-resize";
            window.document.body.style.userSelect = "none";
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setSidebarWidth((currentWidth) =>
                clampProjectTerminalsSidebarWidth(
                  currentWidth - SIDEBAR_RESIZE_STEP,
                ),
              );
            }

            if (event.key === "ArrowRight") {
              event.preventDefault();
              setSidebarWidth((currentWidth) =>
                clampProjectTerminalsSidebarWidth(
                  currentWidth + SIDEBAR_RESIZE_STEP,
                ),
              );
            }

            if (event.key === "Home") {
              event.preventDefault();
              setSidebarWidth(DEFAULT_ACTIVITY_SIDEBAR_WIDTH);
            }

            if (event.key === "End") {
              event.preventDefault();
              setSidebarWidth(PROJECT_TERMINALS_SIDEBAR_MAX_WIDTH);
            }
          }}
        />

        <section
          className="project-terminals-workspace"
          aria-label={messages.agentsFeature.workspaceLabel}
        >
          {activeTerminal && activeSessionId !== null ? (
            <div className="project-terminals-workspace__surface">
              <ProjectTerminal
                projectId={projectId}
                sessionId={activeSessionId}
              />
            </div>
          ) : (
            <div className="project-terminals-workspace__empty">
              <div className="project-terminals-workspace__empty-copy">
                <h3>{activeTerminal?.name ?? messages.settings.terminals}</h3>
                <p>{messages.settings.terminalUnavailable}</p>
              </div>
              <Button
                aria-label={messages.settings.newTerminal}
                disabled={creatingTerminal}
                type="button"
                variant="outline"
                onClick={() => {
                  void handleCreateTerminal();
                }}
              >
                <Plus aria-hidden="true" size={14} strokeWidth={2} />
                <span>{messages.settings.newTerminal}</span>
              </Button>
            </div>
          )}
        </section>
      </main>

      {editingTerminal ? (
        <ProjectTerminalEditDialog
          projectId={projectId}
          terminal={editingTerminal}
          onClose={() => {
            setEditingTerminal(null);
          }}
          onSaved={handleTerminalSaved}
        />
      ) : null}
    </>
  );
}

function clampProjectTerminalsSidebarWidth(width: number) {
  return Math.min(
    PROJECT_TERMINALS_SIDEBAR_MAX_WIDTH,
    Math.max(DEFAULT_ACTIVITY_SIDEBAR_WIDTH, width),
  );
}
