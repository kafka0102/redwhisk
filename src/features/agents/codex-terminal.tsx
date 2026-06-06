import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

import {
  readAgentSessionTerminal,
  resizeAgentSessionTerminal,
  writeAgentSessionTerminal,
} from "./agent-session-commands";
import { toCommandError } from "../../shared/commands/command-error";

const TERMINAL_POLL_INTERVAL_MS = 450;
const TERMINAL_MAX_BYTES = 32_768;

interface CodexTerminalProps {
  projectId: number;
  sessionId: number;
}

export function CodexTerminal({ projectId, sessionId }: CodexTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const latestSnapshotRef = useRef("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const canBootXterm = supportsXtermRuntime();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canBootXterm) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        '"SFMono-Regular", "JetBrains Mono", "IBM Plex Mono", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 2000,
      theme: {
        background: "#f8f6f1",
        foreground: "#161515",
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
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setStatusMessage("Connecting terminal…");

    const syncSize = () => {
      fitAddon.fit();
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
        // Resize failures are surfaced through the polling status instead.
      });
    };

    syncSize();

    const disposeData = terminal.onData((data) => {
      void writeAgentSessionTerminal({ projectId, sessionId, data }).catch(
        (error) => {
          setStatusMessage(toCommandError(error).message);
        },
      );
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

    const refreshSnapshot = async () => {
      try {
        const result = await readAgentSessionTerminal({
          projectId,
          sessionId,
          maxBytes: TERMINAL_MAX_BYTES,
        });
        if (isDisposed) {
          return;
        }

        applySnapshot(terminal, latestSnapshotRef.current, result.snapshot);
        latestSnapshotRef.current = result.snapshot;
        setStatusMessage(
          result.isActive
            ? null
            : "Session terminal is no longer active. Showing the latest log snapshot.",
        );
      } catch (error) {
        if (!isDisposed) {
          setStatusMessage(toCommandError(error).message);
        }
      }
    };

    void refreshSnapshot();
    const intervalId = window.setInterval(
      () => void refreshSnapshot(),
      TERMINAL_POLL_INTERVAL_MS,
    );

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      disposeData.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      latestSnapshotRef.current = "";
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

function applySnapshot(
  terminal: Terminal,
  previousSnapshot: string,
  nextSnapshot: string,
) {
  if (nextSnapshot === previousSnapshot) {
    return;
  }

  if (previousSnapshot && nextSnapshot.startsWith(previousSnapshot)) {
    terminal.write(nextSnapshot.slice(previousSnapshot.length));
    return;
  }

  terminal.reset();
  terminal.write(nextSnapshot);
}

function supportsXtermRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (typeof window.matchMedia !== "function") {
    return false;
  }

  if (
    typeof navigator !== "undefined" &&
    /jsdom/i.test(navigator.userAgent || "")
  ) {
    return false;
  }

  return true;
}
