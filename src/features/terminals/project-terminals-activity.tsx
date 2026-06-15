import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Plus, Terminal, X } from "lucide-react";

import { Button } from "../../components/ui/button";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import {
  DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  SIDEBAR_RESIZE_STEP,
} from "../../shared/layout/sidebar-width";
import { ProjectTerminal } from "./project-terminal";
import {
  closeProjectTerminal,
  createProjectTerminal,
} from "./project-terminal-commands";

interface ProjectTerminalCardState {
  name: string;
  sessionId: number;
}

interface ProjectTerminalsActivityProps {
  projectId: number;
  projectName: string;
  projectPath?: string;
}

const PROJECT_TERMINALS_SIDEBAR_MAX_WIDTH = 420;

export function ProjectTerminalsActivity({
  projectId,
  projectName,
  projectPath = "",
}: ProjectTerminalsActivityProps) {
  const { messages, theme } = useI18n();
  const [sidebarWidth, setSidebarWidth] = useState(
    DEFAULT_ACTIVITY_SIDEBAR_WIDTH,
  );
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [terminalCards, setTerminalCards] = useState<ProjectTerminalCardState[]>(
    [],
  );
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  );
  const [terminalStatusMessage, setTerminalStatusMessage] = useState<
    string | null
  >(null);
  const [closingTerminalId, setClosingTerminalId] = useState<number | null>(
    null,
  );
  const dragStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);

  const activeTerminal =
    terminalCards.find((card) => card.sessionId === selectedSessionId) ??
    terminalCards[0] ??
    null;

  const workspaceMeta = useMemo(() => {
    const trimmedPath = projectPath.trim();
    return trimmedPath.length > 0 ? trimmedPath : projectName;
  }, [projectName, projectPath]);

  const clearDragState = useCallback(() => {
    if (!dragStateRef.current) {
      return;
    }

    dragStateRef.current = null;
    window.document.body.style.cursor = "";
    window.document.body.style.userSelect = "";
  }, []);

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
  }, [clearDragState]);

  async function handleCreateTerminal() {
    if (creatingTerminal) {
      return;
    }

    setTerminalStatusMessage(null);
    setCreatingTerminal(true);

    try {
      const terminal = await createProjectTerminal({ projectId });
      setTerminalCards((currentCards) => [
        ...currentCards,
        {
          sessionId: terminal.sessionId,
          name: terminal.name,
        },
      ]);
      setSelectedSessionId(terminal.sessionId);
    } catch (error: unknown) {
      setTerminalStatusMessage(toCommandError(error).message);
    } finally {
      setCreatingTerminal(false);
    }
  }

  async function handleDeleteTerminal(sessionId: number) {
    setTerminalStatusMessage(null);
    setClosingTerminalId(sessionId);

    try {
      await closeProjectTerminal({ projectId, sessionId });
      setTerminalCards((currentCards) =>
        currentCards.filter((card) => card.sessionId !== sessionId),
      );
      setSelectedSessionId((currentSelectedSessionId) =>
        currentSelectedSessionId === sessionId ? null : currentSelectedSessionId,
      );
    } catch (error: unknown) {
      setTerminalStatusMessage(toCommandError(error).message);
    } finally {
      setClosingTerminalId(null);
    }
  }

  return (
    <main
      className="activity-surface activity-surface--terminals"
      style={
        {
          "--project-terminals-sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="project-terminals-sidebar" aria-label="Project terminals">
        <div className="project-terminals-sidebar__header">
          <div className="project-terminals-sidebar__header-copy">
            <h2>{messages.settings.terminals}</h2>
            <p>{projectName}</p>
          </div>
          <Button
            aria-label={messages.settings.newTerminal}
            className="project-terminals-sidebar__create"
            disabled={creatingTerminal}
            size="icon"
            type="button"
            variant="secondary"
            onClick={() => {
              void handleCreateTerminal();
            }}
          >
            <Plus aria-hidden="true" size={15} strokeWidth={2} />
          </Button>
        </div>

        {terminalStatusMessage ? (
          <p className="issues-status" role="status" aria-label="Terminals status">
            {terminalStatusMessage}
          </p>
        ) : null}

        {terminalCards.length === 0 ? (
          <div className="project-terminals-empty-list">
            <p>{messages.settings.noTerminals}</p>
          </div>
        ) : (
          <div className="project-terminals-card-list">
            {terminalCards.map((terminalCard) => {
              const cardPalette = getTerminalCardPalette(
                theme,
                terminalCard.sessionId,
              );
              const isActive = activeTerminal?.sessionId === terminalCard.sessionId;

              return (
                <section
                  key={terminalCard.sessionId}
                  className="project-terminals-card-shell"
                  style={
                    {
                      "--project-terminal-card-background": cardPalette.background,
                      "--project-terminal-card-border": cardPalette.border,
                      "--project-terminal-card-icon-background":
                        cardPalette.iconBackground,
                      "--project-terminal-card-icon-color": cardPalette.iconColor,
                    } as CSSProperties
                  }
                >
                  <button
                    aria-label={terminalCard.name}
                    aria-pressed={isActive}
                    className="project-terminals-card"
                    type="button"
                    onClick={() => {
                      setSelectedSessionId(terminalCard.sessionId);
                    }}
                  >
                    <span className="project-terminals-card__icon" aria-hidden="true">
                      <Terminal size={15} strokeWidth={1.9} />
                    </span>
                    <span className="project-terminals-card__copy">
                      <span className="project-terminals-card__name">
                        {terminalCard.name}
                      </span>
                      <span className="project-terminals-card__meta">
                        {projectName}
                      </span>
                    </span>
                  </button>
                  <button
                    aria-label={messages.settings.deleteTerminal(terminalCard.name)}
                    className="project-terminals-card__delete"
                    disabled={closingTerminalId === terminalCard.sessionId}
                    type="button"
                    onClick={() => {
                      void handleDeleteTerminal(terminalCard.sessionId);
                    }}
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                </section>
              );
            })}
          </div>
        )}
      </aside>

      <div
        aria-label="Resize terminals list"
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

      <section className="project-terminals-workspace" aria-label="Terminal workspace">
        {activeTerminal ? (
          <>
            <header className="project-terminals-workspace__header">
              <div className="project-terminals-workspace__copy">
                <p className="project-terminals-workspace__eyebrow">
                  {messages.settings.terminals}
                </p>
                <h3>{activeTerminal.name}</h3>
                <p className="project-terminals-workspace__meta">{workspaceMeta}</p>
              </div>
            </header>
            <div className="project-terminals-workspace__surface">
              <ProjectTerminal
                projectId={projectId}
                sessionId={activeTerminal.sessionId}
              />
            </div>
          </>
        ) : (
          <div className="project-terminals-workspace__empty">
            <div className="project-terminals-workspace__empty-copy">
              <h3>{messages.settings.terminals}</h3>
              <p>{messages.settings.noTerminals}</p>
            </div>
            <Button
              aria-label={messages.settings.newTerminal}
              type="button"
              variant="secondary"
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
  );
}

function clampProjectTerminalsSidebarWidth(width: number) {
  return Math.min(
    PROJECT_TERMINALS_SIDEBAR_MAX_WIDTH,
    Math.max(DEFAULT_ACTIVITY_SIDEBAR_WIDTH, width),
  );
}

function getTerminalCardPalette(theme: "light" | "dark", seed: number) {
  const lightPalettes = [
    {
      background: "#f7f1e7",
      border: "#dccab0",
      iconBackground: "rgba(120, 82, 38, 0.12)",
      iconColor: "#7a5226",
    },
    {
      background: "#eaf4ee",
      border: "#bfd6c5",
      iconBackground: "rgba(42, 108, 68, 0.12)",
      iconColor: "#2a6c44",
    },
    {
      background: "#edf2fb",
      border: "#c5d1ea",
      iconBackground: "rgba(44, 87, 146, 0.12)",
      iconColor: "#2c5792",
    },
    {
      background: "#f8ecef",
      border: "#e1c2cb",
      iconBackground: "rgba(138, 57, 83, 0.12)",
      iconColor: "#8a3953",
    },
  ];
  const darkPalettes = [
    {
      background: "#2a231b",
      border: "#4d3e2f",
      iconBackground: "rgba(239, 213, 180, 0.12)",
      iconColor: "#efd5b4",
    },
    {
      background: "#1c2923",
      border: "#355443",
      iconBackground: "rgba(191, 225, 206, 0.12)",
      iconColor: "#bfe1ce",
    },
    {
      background: "#1d2430",
      border: "#364660",
      iconBackground: "rgba(198, 215, 243, 0.12)",
      iconColor: "#c6d7f3",
    },
    {
      background: "#2f1e25",
      border: "#613646",
      iconBackground: "rgba(241, 204, 217, 0.12)",
      iconColor: "#f1ccd9",
    },
  ];
  const palettes = theme === "dark" ? darkPalettes : lightPalettes;
  const paletteIndex = Math.abs(seed) % palettes.length;
  return palettes[paletteIndex] ?? palettes[0];
}
