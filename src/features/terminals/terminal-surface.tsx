import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

import type { TerminalOutputChunk, TerminalTransport } from "./terminal-types";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

const TERMINAL_STATUS_MAX_BYTES = 1;
const TERMINAL_STATUS_POLL_MS = 2_000;
const TERMINAL_PENDING_OUTPUT_MAX_BYTES = 64 * 1024;
const TERMINAL_HISTORY_MAX_BYTES = 1024 * 1024;
const TERMINAL_WORD_SEPARATOR = " ()[]{}',\"`";

type TerminalStatusSource =
  | "boot"
  | "input"
  | "inactive"
  | "output"
  | "poll"
  | "resize"
  | "restore";

interface TerminalSurfaceProps {
  ariaLabel: string;
  shellClassName?: string;
  terminalClassName?: string;
  transport: TerminalTransport;
  transportKey: string | number;
}

export function TerminalSurface({
  ariaLabel,
  shellClassName = "terminal-surface-shell",
  terminalClassName = "terminal-surface",
  transport,
  transportKey,
}: TerminalSurfaceProps) {
  const { theme, contentFontSize, t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const transportRef = useRef(transport);
  const latestSequenceRef = useRef(0);
  const statusSourceRef = useRef<TerminalStatusSource | null>(null);
  const themeRef = useRef(theme);
  const contentFontSizeRef = useRef(contentFontSize);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const canBootXterm = supportsXtermRuntime();

  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);

  useEffect(() => {
    themeRef.current = theme;
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = getTerminalTheme(theme);
  }, [theme]);

  useEffect(() => {
    contentFontSizeRef.current = contentFontSize;
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    terminal.options.fontSize = contentFontSize;
    fitAddon.fit();
  }, [contentFontSize]);

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
        fontSize: contentFontSizeRef.current,
        fontWeight: "normal",
        fontWeightBold: "bold",
        letterSpacing: 0,
        lineHeight: 1,
        rightClickSelectsWord: false,
        scrollOnEraseInDisplay: true,
        scrollOnUserInput: true,
        scrollback: 10_000,
        smoothScrollDuration: 0,
        theme: getTerminalTheme(themeRef.current),
        wordSeparator: TERMINAL_WORD_SEPARATOR,
      });
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new ClipboardAddon());
      terminal.open(host);
      fitAddon.fit();
    } catch (error) {
      const message = getCommandErrorMessage(error, t);
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
      // 宿主被 hidden（切到其他 workspace tab 时 pane 变为 display:none，
      // ResizeObserver 仍会以 0×0 尺寸回调）时跳过重算：否则 FitAddon 会用残留
      // cell 尺寸 + 0 容器算出退化值（cols=2/rows=1），既触发 xterm 重排，又把
      // PTY 缩成 1×2 引发 SIGWINCH 让 shell 重绘，逐次覆盖掉最后一行输出。
      if (host.offsetWidth === 0 || host.offsetHeight === 0) {
        return;
      }

      try {
        fitAddon.fit();
      } catch (error) {
        const message = getCommandErrorMessage(error, t);
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

      void transportRef.current
        .resize(dimensions.rows, dimensions.cols)
        .catch(() => {
          // Resize failures should not tear down terminal rendering.
        });
    };

    syncSize();

    const disposeData = terminal.onData((data) => {
      void transportRef.current.write(data).catch((error) => {
        showStatusMessage("input", getCommandErrorMessage(error, t));
      });
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
    let hasRestored = false;
    let pendingOutputBytes = 0;
    let statusTimer: number | null = null;
    let unlistenOutput: (() => void) | null = null;
    const pendingOutputEvents: TerminalOutputChunk[] = [];

    const writeOutput = (event: TerminalOutputChunk) => {
      if (isDisposed || event.sequence <= latestSequenceRef.current) {
        return;
      }

      latestSequenceRef.current = event.sequence;
      try {
        terminal.write(new Uint8Array(event.data));
        clearStatusMessage();
      } catch (error) {
        showStatusMessage("output", getCommandErrorMessage(error, t));
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

    const queuePendingOutput = (event: TerminalOutputChunk) => {
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

    const handleOutput = (event: TerminalOutputChunk) => {
      if (!hasRestored) {
        queuePendingOutput(event);
        return;
      }

      writeOutput(event);
    };

    const restoreTerminal = async () => {
      try {
        const result = await transportRef.current.restore();
        if (isDisposed) {
          return;
        }

        if (!result.isActive) {
          discardPendingOutput();
          const snapshotResult = await transportRef.current.readSnapshot(
            TERMINAL_HISTORY_MAX_BYTES,
          );
          if (isDisposed) {
            return;
          }

          if (snapshotResult.snapshot) {
            terminal.write(snapshotResult.snapshot);
            terminal.scrollToBottom();
          }
          clearStatusMessage("inactive");
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
          showStatusMessage("restore", getCommandErrorMessage(error, t));
          hasRestored = true;
          flushPendingOutput();
        }
      }
    };

    const refreshStatus = async () => {
      try {
        const result = await transportRef.current.readSnapshot(
          TERMINAL_STATUS_MAX_BYTES,
        );
        if (isDisposed) {
          return;
        }

        if (!result.isActive) {
          showStatusMessage(
            "inactive",
            "Session terminal is no longer active. Showing the saved session output.",
          );
          return;
        }

        if (statusSourceRef.current === "poll") {
          clearStatusMessage("poll");
        }
      } catch (error) {
        if (!isDisposed) {
          showStatusMessage("poll", getCommandErrorMessage(error, t));
        }
      }
    };

    const startTerminal = async () => {
      try {
        unlistenOutput =
          await transportRef.current.subscribeOutput(handleOutput);
        if (isDisposed) {
          unlistenOutput();
          unlistenOutput = null;
          return;
        }
      } catch (error) {
        if (!isDisposed) {
          setStatusMessage(getCommandErrorMessage(error, t));
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
  }, [canBootXterm, transportKey, t]);

  return (
    <div className={shellClassName}>
      {statusMessage ? (
        <p className="terminal-surface-shell__status" role="status">
          {statusMessage}
        </p>
      ) : null}
      <div ref={hostRef} aria-label={ariaLabel} className={terminalClassName} />
      {!canBootXterm ? (
        <p className="terminal-surface-shell__status" role="status">
          Terminal preview is unavailable in this environment. Runtime PTY/xterm
          behavior is verified in the desktop app.
        </p>
      ) : null}
    </div>
  );
}

function getTerminalTheme(theme: "light" | "dark") {
  if (theme === "dark") {
    return {
      background: "#050506",
      cursor: "#f5f5f5",
      cursorAccent: "#050506",
      foreground: "#f2f3f5",
      selectionBackground: "#25324a",
      selectionForeground: "#f8fafc",
      selectionInactiveBackground: "#20242b",
      black: "#0f172a",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#d4d4d4",
      brightBlack: "#747b86",
      brightRed: "#fb7185",
      brightGreen: "#86efac",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#f8fafc",
    };
  }

  return {
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
  };
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
