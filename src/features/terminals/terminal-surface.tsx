import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";

import {
  createTerminalSurfaceHandle,
  type TerminalSurfaceHandle,
} from "./terminal-surface-handle";

import { attachTerminalDragDrop } from "./terminal-drag-drop";
import {
  applyTerminalBottomInset,
  clearTerminalBottomInset,
} from "./terminal-fit-inset";
import { installTerminalImeInputGuard } from "./terminal-ime-input-guard";
import { createTerminalInputWriter } from "./terminal-input-writer";
import { persistTerminalViewPosition } from "./terminal-history-writer";
import { createTerminalShiftWheelScrollHandler } from "./terminal-shift-wheel-scroll";
import {
  createTerminalSurfaceLiveHandlers,
  healTerminalViewport,
} from "./terminal-surface-live-handlers";
import { createTerminalWebglSession } from "./terminal-webgl-session";
import { createTerminalXtermOptions } from "./terminal-xterm-options";
import { TerminalLivePipeline } from "./terminal-live-pipeline";
import {
  isCopyShortcut,
  supportsXtermRuntime,
} from "./terminal-surface-runtime";
import { getTerminalTheme } from "./terminal-theme";
import type { TerminalTransport } from "./terminal-types";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

const TERMINAL_STATUS_MAX_BYTES = 1;
const TERMINAL_STATUS_POLL_MS = 2_000;

type TerminalStatusSource =
  | "boot"
  | "input"
  | "inactive"
  | "output"
  | "poll"
  | "resize"
  | "restore";

export type { TerminalSurfaceHandle };

interface TerminalSurfaceProps {
  ariaLabel: string;
  ref?: Ref<TerminalSurfaceHandle | null>;
  shellClassName?: string;
  terminalClassName?: string;
  transport: TerminalTransport;
  transportKey: string | number;
}

export function TerminalSurface({
  ariaLabel,
  ref,
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
  const [statusTransportKey, setStatusTransportKey] = useState(transportKey);
  // transportKey 切换时组件实例会复用；在 render 阶段同步清掉上一 session 文案。
  if (statusTransportKey !== transportKey) {
    setStatusTransportKey(transportKey);
    if (statusMessage !== null) {
      setStatusMessage(null);
    }
  }
  const canBootXterm = supportsXtermRuntime();

  useImperativeHandle(ref, () =>
    createTerminalSurfaceHandle(() => terminalRef.current),
  );

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
    const host = hostRef.current;
    if (!host) {
      return;
    }
    clearTerminalBottomInset(terminal);
    fitAddon.fit();
    applyTerminalBottomInset(terminal, host);
  }, [contentFontSize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canBootXterm) {
      return;
    }

    let terminal: Terminal;
    let fitAddon: FitAddon;
    let isDisposed = false;
    let webglSession: ReturnType<typeof createTerminalWebglSession> | null =
      null;
    let imeInputGuard: ReturnType<typeof installTerminalImeInputGuard> | null =
      null;
    const imeFallbackSendRef: { current: ((data: string) => void) | null } = {
      current: null,
    };

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
      terminal = new Terminal(
        createTerminalXtermOptions({
          contentFontSize: contentFontSizeRef.current,
          theme: themeRef.current,
        }),
      );
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new ClipboardAddon());
      terminal.open(host);
      imeInputGuard = terminal.textarea
        ? installTerminalImeInputGuard(host, terminal.textarea, {
            sendFallbackData: (data) => {
              imeFallbackSendRef.current?.(data);
            },
          })
        : null;
      // 不在 boot 时立刻挂 WebGL：多终端 keep-alive 会共享 addon-webgl 的
      // texture atlas，隐藏实例挂着 WebGL 时容易「一个花屏全家花屏」。
      // 仅在 layout 可见时 setActive(true)。
      webglSession = createTerminalWebglSession(terminal, {
        isCurrent: () => !isDisposed && terminalRef.current === terminal,
      });
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
        clearTerminalBottomInset(terminal);
        fitAddon.fit();
        applyTerminalBottomInset(terminal, host);
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
    imeFallbackSendRef.current = (data: string) => {
      if (suppressPtyInput) {
        return;
      }
      inputWriter.push(data);
    };
    const disposeData = terminal.onData((data) => {
      if (suppressPtyInput) {
        return;
      }
      if (imeInputGuard) {
        const filtered = imeInputGuard.filterData(data);
        if (filtered === null) {
          return;
        }
        inputWriter.push(filtered);
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

    terminal.attachCustomWheelEventHandler(
      createTerminalShiftWheelScrollHandler(terminal),
    );

    statusSourceRef.current = null;

    let statusTimer: number | null = null;
    let unlistenOutput: (() => void) | null = null;
    let desiredVisible = false;

    // Tauri 默认拦截 HTML5 drop（dragDropEnabled:true），xterm 容器收不到浏览器
    // drop 事件；改监听原生 webview 拖拽事件，落点命中终端宿主时把文件路径写入
    // stdin —— 对齐 iTerm2 / Warp 拖入文件「插入路径」，使 Codex / Claude Code
    // 输入框能接收拖入文件。
    const disposeDragDrop = attachTerminalDragDrop({
      host,
      isDisposed: () => isDisposed,
      shouldSuppressInput: () => suppressPtyInput,
      onDropText: (text) => inputWriter.push(text),
    });

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

    const pipeline = new TerminalLivePipeline(
      pipelineTransport,
      createTerminalSurfaceLiveHandlers({
        clearStatusMessage,
        setInputSuppressed: (suppressed) => {
          suppressPtyInput = suppressed;
        },
        showStatusMessage,
        t,
        terminal,
        transportKey,
      }),
    );

    const isLayoutVisible = (): boolean =>
      host.offsetWidth > 0 && host.offsetHeight > 0;

    const isDocumentVisible = (): boolean =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const isTerminalVisible = (): boolean =>
      isLayoutVisible() && isDocumentVisible();

    const persistViewState = () => {
      persistTerminalViewPosition(
        String(transportKey),
        pipeline.getLatestSequence(),
        terminal.buffer.active.viewportY,
      );
    };

    const refreshLiveVisibility = async () => {
      if (isDisposed) {
        return;
      }

      const shouldBeVisible = isTerminalVisible();
      // 无论 live 订阅是否变化，都按可见性对齐 WebGL：
      // 隐藏实例必须卸下 addon，否则会继续占用跨 Terminal 共享的字形 atlas。
      webglSession?.setActive(shouldBeVisible);

      if (shouldBeVisible === desiredVisible) {
        return;
      }
      desiredVisible = shouldBeVisible;

      if (shouldBeVisible) {
        await pipeline.becomeVisible();
        return;
      }

      persistViewState();
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
      // 休眠恢复：GPU 纹理常已失效。clearTextureAtlas 不够时，整实例 recreate WebGL。
      if (document.visibilityState === "visible" && isLayoutVisible()) {
        webglSession?.setActive(true);
        webglSession?.recreate();
      } else if (document.visibilityState === "hidden") {
        webglSession?.setActive(false);
      }
      void refreshLiveVisibility();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 鼠标划过会触发局部重绘，用户常靠此「暂时看清」；主动 heal 把整屏纹理拉回。
    const handlePointerEnter = () => {
      if (!isLayoutVisible() || !isDocumentVisible()) {
        return;
      }
      healTerminalViewport(terminal);
    };
    host.addEventListener("pointerenter", handlePointerEnter);

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
      persistViewState();
      pipeline.dispose();
      inputWriter.dispose();
      unlistenOutput?.();
      disposeDragDrop();
      if (statusTimer !== null) {
        window.clearInterval(statusTimer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      host.removeEventListener("pointerenter", handlePointerEnter);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      disposeData.dispose();
      imeInputGuard?.dispose();
      webglSession?.dispose();
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
