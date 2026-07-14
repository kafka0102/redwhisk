import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

import { createTerminalInputWriter } from "./terminal-input-writer";
import { writeTerminalHistory } from "./terminal-history-writer";
import { TerminalLivePipeline } from "./terminal-live-pipeline";
import { getTerminalTheme } from "./terminal-theme";
import type { TerminalTransport } from "./terminal-types";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

const TERMINAL_STATUS_MAX_BYTES = 1;
const TERMINAL_STATUS_POLL_MS = 2_000;
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

    // 串行写入 + 在途合并：连打时不并发 invoke，并把积压键合成一次 write。
    const inputWriter = createTerminalInputWriter(
      (data) => transportRef.current.write(data),
      (error) => {
        showStatusMessage("input", getCommandErrorMessage(error, t));
      },
    );
    // restore 回放期间抑制：历史中的 CSI/OSC 查询会被 xterm 应答，
    // 若写回 PTY 会在 shell 回显成乱码，并在每次切页时累积。
    let suppressPtyInput = false;
    const disposeData = terminal.onData((data) => {
      if (suppressPtyInput) {
        return;
      }
      inputWriter.push(data);
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

    let isDisposed = false;
    let statusTimer: number | null = null;
    let unlistenOutput: (() => void) | null = null;
    let desiredVisible = false;

    const pipelineTransport: TerminalTransport = {
      readSnapshot: (maxBytes) => transportRef.current.readSnapshot(maxBytes),
      resize: (rows, cols) => transportRef.current.resize(rows, cols),
      restore: () => transportRef.current.restore(),
      setLiveSubscription: (active) =>
        transportRef.current.setLiveSubscription(active),
      subscribeOutput: (handler) =>
        transportRef.current.subscribeOutput(handler),
      write: (data) => transportRef.current.write(data),
    };

    const pipeline = new TerminalLivePipeline(pipelineTransport, {
      writeBytes: (bytes) => {
        try {
          terminal.write(bytes);
          clearStatusMessage();
        } catch (error) {
          showStatusMessage("output", getCommandErrorMessage(error, t));
        }
      },
      writeHistory: (text) =>
        writeTerminalHistory(terminal, text, (suppressed) => {
          suppressPtyInput = suppressed;
        }),
      onRestoreIncomplete: () => {
        showStatusMessage(
          "restore",
          "Terminal restore snapshot is incomplete. Showing log tail; live output continues below.",
        );
      },
      onRestoreError: (error) => {
        showStatusMessage("restore", getCommandErrorMessage(error, t));
      },
      onInactive: () => {
        clearStatusMessage("inactive");
      },
      onLiveReady: () => {
        clearStatusMessage();
      },
      onPendingDropped: () => {
        showStatusMessage(
          "restore",
          "Terminal restore is taking longer than expected. Older live output was dropped while waiting for restore.",
        );
      },
    });

    const isLayoutVisible = (): boolean =>
      host.offsetWidth > 0 && host.offsetHeight > 0;

    const isDocumentVisible = (): boolean =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const isTerminalVisible = (): boolean =>
      isLayoutVisible() && isDocumentVisible();

    const refreshLiveVisibility = async () => {
      if (isDisposed) {
        return;
      }

      const shouldBeVisible = isTerminalVisible();
      if (shouldBeVisible === desiredVisible) {
        return;
      }
      desiredVisible = shouldBeVisible;

      if (shouldBeVisible) {
        await pipeline.becomeVisible();
        return;
      }

      await pipeline.becomeHidden();
    };

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

    const handleVisibilityChange = () => {
      void refreshLiveVisibility();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

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
        unlistenOutput = await transportRef.current.subscribeOutput((event) => {
          pipeline.handleOutput(event);
        });
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
      desiredVisible = false;
      pipeline.dispose();
      inputWriter.dispose();
      unlistenOutput?.();
      if (statusTimer !== null) {
        window.clearInterval(statusTimer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      disposeData.dispose();
      webglAddon?.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
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
