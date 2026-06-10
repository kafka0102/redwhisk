import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

import {
  readAgentSessionTerminal,
  restoreAgentSessionTerminal,
  resizeAgentSessionTerminal,
  writeAgentSessionTerminal,
} from "./agent-session-commands";
import {
  type AgentSessionTerminalOutputEvent,
  subscribeAgentSessionTerminalOutput,
} from "./agent-terminal-events";
import { toCommandError } from "../../shared/commands/command-error";

const TERMINAL_STATUS_MAX_BYTES = 1;
const TERMINAL_STATUS_POLL_MS = 2_000;
const TERMINAL_PENDING_OUTPUT_MAX_BYTES = 64 * 1024;
const TERMINAL_WORD_SEPARATOR = " ()[]{}',\"`";

type TerminalStatusSource =
  | "boot"
  | "resize"
  | "input"
  | "output"
  | "restore"
  | "poll"
  | "inactive";

interface CodexTerminalProps {
  projectId: number;
  sessionId: number;
}

export function CodexTerminal({ projectId, sessionId }: CodexTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const latestSequenceRef = useRef(0);
  const statusSourceRef = useRef<TerminalStatusSource | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const canBootXterm = supportsXtermRuntime();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canBootXterm) {
      return;
    }

    let terminal: Terminal;
    let fitAddon: FitAddon;
    const showStatusMessage = (
      source: TerminalStatusSource,
      message: string,
    ) => {
      statusSourceRef.current = source;
      setStatusMessage(message);
    };
    const clearStatusMessage = (source?: TerminalStatusSource) => {
      if (source && statusSourceRef.current !== source) {
        return;
      }
      statusSourceRef.current = null;
      setStatusMessage(null);
    };

    try {
      terminal = new Terminal({
        allowTransparency: false,
        convertEol: false,
        cursorBlink: false,
        cursorInactiveStyle: "outline",
        cursorStyle: "block",
        disableStdin: false,
        fontFamily:
          '"SFMono-Regular", "JetBrains Mono", "IBM Plex Mono", Consolas, monospace',
        fontSize: 13,
        fontWeight: "normal",
        fontWeightBold: "bold",
        letterSpacing: 0,
        lineHeight: 1,
        rightClickSelectsWord: false,
        scrollOnEraseInDisplay: true,
        scrollOnUserInput: true,
        scrollback: 10_000,
        smoothScrollDuration: 0,
        theme: {
          background: "#ffffff",
          cursor: "#161515",
          cursorAccent: "#ffffff",
          foreground: "#161515",
          selectionBackground: "#dbeafe",
          selectionForeground: "#0f172a",
          selectionInactiveBackground: "#e5e7eb",
          black: "#0f172a",
          red: "#a12d24",
          green: "#1f6b44",
          yellow: "#9b6b16",
          blue: "#275dad",
          magenta: "#8a3b8f",
          cyan: "#1b6f78",
          white: "#d4d4d4",
          brightBlack: "#64748b",
          brightRed: "#c2410c",
          brightGreen: "#15803d",
          brightYellow: "#a16207",
          brightBlue: "#1d4ed8",
          brightMagenta: "#a21caf",
          brightCyan: "#0f766e",
          brightWhite: "#f8fafc",
        },
        wordSeparator: TERMINAL_WORD_SEPARATOR,
      });
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new ClipboardAddon());
      terminal.open(host);
      fitAddon.fit();
    } catch (error) {
      const message = toCommandError(error).message;
      const bootErrorTimer = window.setTimeout(() => {
        showStatusMessage("boot", message);
      }, 0);
      return () => {
        window.clearTimeout(bootErrorTimer);
      };
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    latestSequenceRef.current = 0;

    const syncSize = () => {
      try {
        fitAddon.fit();
      } catch (error) {
        const message = toCommandError(error).message;
        window.setTimeout(() => {
          if (!terminalRef.current) {
            return;
          }
          showStatusMessage("resize", message);
        }, 0);
        return;
      }

      const dimensions = fitAddon.proposeDimensions();
      if (!dimensions) {
        return;
      }

      void resizeAgentSessionTerminal({
        projectId,
        sessionId,
        rows: dimensions.rows,
        cols: dimensions.cols,
      }).catch(() => {
        // Resize failures should not tear down terminal rendering.
      });
    };

    syncSize();

    const disposeData = terminal.onData((data) => {
      void writeAgentSessionTerminal({ projectId, sessionId, data }).catch(
        (error) => {
          showStatusMessage("input", toCommandError(error).message);
        },
      );
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if (isCopyShortcut(event) && terminal.hasSelection()) {
        void navigator.clipboard
          ?.writeText(terminal.getSelection())
          ?.catch(() => {
            // Ignore clipboard failures; selection remains available in xterm.
          });
        return false;
      }

      return true;
    });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            syncSize();
          });
    resizeObserver?.observe(host);

    const handleWindowResize = () => {
      syncSize();
    };
    window.addEventListener("resize", handleWindowResize);

    let isDisposed = false;
    let unlistenOutput: (() => void) | null = null;
    let statusTimer: number | null = null;
    let hasRestored = false;
    const pendingOutputEvents: AgentSessionTerminalOutputEvent[] = [];
    let pendingOutputBytes = 0;

    const writeOutput = (event: AgentSessionTerminalOutputEvent) => {
      if (
        isDisposed ||
        event.projectId !== projectId ||
        event.sessionId !== sessionId ||
        event.sequence <= latestSequenceRef.current
      ) {
        return;
      }

      latestSequenceRef.current = event.sequence;
      try {
        terminal.write(new Uint8Array(event.data));
        clearStatusMessage();
      } catch (error) {
        showStatusMessage("output", toCommandError(error).message);
      }
    };

    const flushPendingOutput = () => {
      for (const event of pendingOutputEvents.splice(0)) {
        pendingOutputBytes = Math.max(
          0,
          pendingOutputBytes - event.data.length,
        );
        writeOutput(event);
      }
      pendingOutputBytes = 0;
    };

    const discardPendingOutput = () => {
      pendingOutputEvents.length = 0;
      pendingOutputBytes = 0;
    };

    const queuePendingOutput = (event: AgentSessionTerminalOutputEvent) => {
      pendingOutputEvents.push(event);
      pendingOutputBytes += event.data.length;

      while (
        pendingOutputBytes > TERMINAL_PENDING_OUTPUT_MAX_BYTES &&
        pendingOutputEvents.length > 0
      ) {
        const droppedEvent = pendingOutputEvents.shift();
        if (!droppedEvent) {
          break;
        }
        pendingOutputBytes = Math.max(
          0,
          pendingOutputBytes - droppedEvent.data.length,
        );
        showStatusMessage(
          "restore",
          "Terminal restore is taking longer than expected. Older live output was dropped while waiting for restore.",
        );
      }
    };

    const handleOutput = (event: AgentSessionTerminalOutputEvent) => {
      if (!hasRestored) {
        queuePendingOutput(event);
        return;
      }

      writeOutput(event);
    };

    const restoreTerminal = async () => {
      try {
        const result = await restoreAgentSessionTerminal({
          projectId,
          sessionId,
        });
        if (isDisposed) {
          return;
        }

        if (!result.isActive) {
          discardPendingOutput();
          showStatusMessage(
            "inactive",
            "Session terminal is no longer active. Open the session log to inspect output.",
          );
          hasRestored = true;
          return;
        }

        if (!result.isComplete) {
          showStatusMessage(
            "restore",
            "Terminal restore snapshot is unavailable. New live output will continue below.",
          );
          hasRestored = true;
          flushPendingOutput();
          return;
        }

        for (const chunk of result.chunks) {
          terminal.write(new Uint8Array(chunk));
        }
        latestSequenceRef.current = result.sequence;
        terminal.scrollToBottom();
        clearStatusMessage();
        hasRestored = true;
        flushPendingOutput();
      } catch (error) {
        if (!isDisposed) {
          showStatusMessage("restore", toCommandError(error).message);
          hasRestored = true;
          flushPendingOutput();
        }
      }
    };

    const refreshStatus = async () => {
      try {
        const result = await readAgentSessionTerminal({
          projectId,
          sessionId,
          maxBytes: TERMINAL_STATUS_MAX_BYTES,
        });
        if (isDisposed) {
          return;
        }

        if (!result.isActive) {
          showStatusMessage(
            "inactive",
            "Session terminal is no longer active. Open the session log to inspect output.",
          );
          return;
        }

        if (statusSourceRef.current === "poll") {
          clearStatusMessage("poll");
        }
      } catch (error) {
        if (!isDisposed) {
          showStatusMessage("poll", toCommandError(error).message);
        }
      }
    };

    const startTerminal = async () => {
      try {
        unlistenOutput =
          await subscribeAgentSessionTerminalOutput(handleOutput);
        if (isDisposed) {
          unlistenOutput();
          unlistenOutput = null;
          return;
        }
      } catch (error) {
        if (!isDisposed) {
          setStatusMessage(toCommandError(error).message);
        }
        return;
      }

      await restoreTerminal();
      await refreshStatus();
      if (!isDisposed) {
        statusTimer = window.setInterval(() => {
          void refreshStatus();
        }, TERMINAL_STATUS_POLL_MS);
      }
    };

    void startTerminal();

    return () => {
      isDisposed = true;
      unlistenOutput?.();
      if (statusTimer !== null) {
        window.clearInterval(statusTimer);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      disposeData.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      latestSequenceRef.current = 0;
      statusSourceRef.current = null;
    };
  }, [canBootXterm, projectId, sessionId]);

  return (
    <div className="codex-terminal-shell">
      {statusMessage ? (
        <p className="codex-terminal-shell__status" role="status">
          {statusMessage}
        </p>
      ) : null}
      <div
        ref={hostRef}
        aria-label="Codex Session terminal"
        className="codex-terminal"
      />
      {!canBootXterm ? (
        <p className="codex-terminal-shell__status" role="status">
          Terminal preview is unavailable in this environment. Runtime PTY/xterm
          behavior is verified in the desktop app.
        </p>
      ) : null}
    </div>
  );
}

function supportsXtermRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (typeof window.matchMedia !== "function") {
    return false;
  }

  return true;
}

function isCopyShortcut(event: KeyboardEvent): boolean {
  if (event.type !== "keydown") {
    return false;
  }

  const key = event.key.toLowerCase();
  if (key !== "c") {
    return false;
  }

  return isMacPlatform()
    ? event.metaKey && !event.shiftKey
    : event.ctrlKey && event.shiftKey;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}
