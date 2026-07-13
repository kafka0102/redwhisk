import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
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
    let webglAddon: WebglAddon | null = null;

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
      try {
        webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon?.dispose();
          webglAddon = null;
        });
        terminal.loadAddon(webglAddon);
      } catch {
        webglAddon = null;
      }
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
            void refreshLiveVisibility();
          });
    resizeObserver?.observe(host);

    const handleWindowResize = () => {
      syncSize();
      void refreshLiveVisibility();
    };
    window.addEventListener("resize", handleWindowResize);

    let isDisposed = false;
    let isLiveSubscribed = false;
    let catchUpGeneration = 0;
    let statusTimer: number | null = null;
    let unlistenOutput: (() => void) | null = null;
    let rafWriteId: number | null = null;
    const pendingLiveChunks: Uint8Array[] = [];
    let pendingLiveBytes = 0;
    const pendingOutputEvents: TerminalOutputChunk[] = [];
    let pendingOutputBytes = 0;

    const isLayoutVisible = (): boolean =>
      host.offsetWidth > 0 && host.offsetHeight > 0;

    const isDocumentVisible = (): boolean =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const isTerminalVisible = (): boolean =>
      isLayoutVisible() && isDocumentVisible();

    const decodeOutputData = (data: string): Uint8Array | null => {
      try {
        return decodeBase64ToUint8Array(data);
      } catch {
        return null;
      }
    };

    const flushRafWrites = () => {
      rafWriteId = null;
      if (isDisposed || pendingLiveChunks.length === 0) {
        pendingLiveChunks.length = 0;
        pendingLiveBytes = 0;
        return;
      }

      const total = pendingLiveBytes;
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of pendingLiveChunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      pendingLiveChunks.length = 0;
      pendingLiveBytes = 0;

      try {
        terminal.write(merged);
        clearStatusMessage();
      } catch (error) {
        showStatusMessage("output", getCommandErrorMessage(error, t));
      }
    };

    const scheduleLiveWrite = (bytes: Uint8Array) => {
      if (bytes.length === 0) {
        return;
      }
      pendingLiveChunks.push(bytes);
      pendingLiveBytes += bytes.length;
      if (rafWriteId === null) {
        rafWriteId = window.requestAnimationFrame(flushRafWrites);
      }
    };

    const writeOutput = (event: TerminalOutputChunk) => {
      if (isDisposed || event.sequence <= latestSequenceRef.current) {
        return;
      }

      const bytes = decodeOutputData(event.data);
      if (!bytes) {
        return;
      }

      latestSequenceRef.current = event.sequence;
      scheduleLiveWrite(bytes);
    };

    const flushPendingOutput = () => {
      for (const event of pendingOutputEvents.splice(0)) {
        pendingOutputBytes = Math.max(
          0,
          pendingOutputBytes - estimateBase64DecodedLength(event.data),
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
      pendingOutputBytes += estimateBase64DecodedLength(event.data);

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
          pendingOutputBytes - estimateBase64DecodedLength(droppedEvent.data),
        );
        showStatusMessage(
          "restore",
          "Terminal restore is taking longer than expected. Older live output was dropped while waiting for restore.",
        );
      }
    };

    const handleOutput = (event: TerminalOutputChunk) => {
      if (!isLiveSubscribed) {
        queuePendingOutput(event);
        return;
      }

      writeOutput(event);
    };

    const writeHistorySnapshot = async () => {
      const snapshotResult = await transportRef.current.readSnapshot(
        TERMINAL_HISTORY_MAX_BYTES,
      );
      if (isDisposed) {
        return;
      }

      if (snapshotResult.snapshot) {
        terminal.reset();
        terminal.write(snapshotResult.snapshot);
        terminal.scrollToBottom();
      }
    };

    const catchUpFromLog = async () => {
      const generation = ++catchUpGeneration;
      try {
        const restoreResult = await transportRef.current.restore();
        if (isDisposed || generation !== catchUpGeneration) {
          return;
        }

        await writeHistorySnapshot();
        if (isDisposed || generation !== catchUpGeneration) {
          return;
        }

        if (!restoreResult.isActive) {
          discardPendingOutput();
          clearStatusMessage("inactive");
          return;
        }

        latestSequenceRef.current = restoreResult.sequence;
        if (!restoreResult.isComplete) {
          showStatusMessage(
            "restore",
            "Terminal restore snapshot is incomplete. Showing log tail; live output continues below.",
          );
        } else {
          clearStatusMessage();
        }
        flushPendingOutput();
      } catch (error) {
        if (!isDisposed && generation === catchUpGeneration) {
          showStatusMessage("restore", getCommandErrorMessage(error, t));
          flushPendingOutput();
        }
      }
    };

    const setBackendLiveSubscription = async (active: boolean) => {
      try {
        await transportRef.current.setLiveSubscription(active);
      } catch {
        // Subscription failures should not tear down the terminal surface.
      }
    };

    const refreshLiveVisibility = async () => {
      if (isDisposed) {
        return;
      }

      const shouldBeLive = isTerminalVisible();
      if (shouldBeLive === isLiveSubscribed) {
        return;
      }

      if (shouldBeLive) {
        isLiveSubscribed = true;
        await setBackendLiveSubscription(true);
        if (isDisposed || !isLiveSubscribed) {
          return;
        }
        await catchUpFromLog();
        return;
      }

      isLiveSubscribed = false;
      await setBackendLiveSubscription(false);
      discardPendingOutput();
      if (rafWriteId !== null) {
        window.cancelAnimationFrame(rafWriteId);
        rafWriteId = null;
      }
      pendingLiveChunks.length = 0;
      pendingLiveBytes = 0;
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

    const handleVisibilityChange = () => {
      void refreshLiveVisibility();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

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

      await refreshLiveVisibility();
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
      catchUpGeneration += 1;
      if (isLiveSubscribed) {
        isLiveSubscribed = false;
        void setBackendLiveSubscription(false);
      }
      unlistenOutput?.();
      if (statusTimer !== null) {
        window.clearInterval(statusTimer);
      }
      if (rafWriteId !== null) {
        window.cancelAnimationFrame(rafWriteId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      disposeData.dispose();
      webglAddon?.dispose();
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

function decodeBase64ToUint8Array(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function estimateBase64DecodedLength(data: string): number {
  if (data.length === 0) {
    return 0;
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
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
