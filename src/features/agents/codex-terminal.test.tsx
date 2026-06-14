import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodexTerminal } from "./codex-terminal";
import { I18nProvider, useI18n } from "../../shared/i18n/i18n";
import {
  readAgentSessionTerminal,
  restoreAgentSessionTerminal,
  resizeAgentSessionTerminal,
  writeAgentSessionTerminal,
} from "./agent-session-commands";
import { AGENT_SESSION_TERMINAL_OUTPUT_EVENT } from "./agent-terminal-events";
import { resolveSnapshotUpdate } from "./codex-terminal-snapshot";

vi.mock("./agent-session-commands", () => ({
  readAgentSessionTerminal: vi.fn(),
  restoreAgentSessionTerminal: vi.fn(),
  resizeAgentSessionTerminal: vi.fn(),
  writeAgentSessionTerminal: vi.fn(),
}));

const terminalMocks = vi.hoisted(() => {
  const terminals: Array<{
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
    hasSelection: ReturnType<typeof vi.fn>;
    getSelection: ReturnType<typeof vi.fn>;
    scrollToBottom: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    options: {
      theme?: Record<string, string>;
    };
  }> = [];
  const terminalOptions: unknown[] = [];
  const dataHandlers: Array<(data: string) => void> = [];
  const keyHandlers: Array<(event: KeyboardEvent) => boolean> = [];
  const listeners: Array<{
    eventName: string;
    callback: (event: {
      payload: {
        projectId: number;
        sessionId: number;
        sequence: number;
        data: number[];
      };
    }) => void;
  }> = [];
  const unlisten = vi.fn();
  const listenPromiseRef: { current: Promise<() => void> | null } = {
    current: null,
  };

  return {
    dataHandlers,
    keyHandlers,
    listenPromiseRef,
    listeners,
    terminalOptions,
    terminals,
    unlisten,
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function (options: unknown) {
    const terminal = {
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn(),
      onData: vi.fn((handler: (data: string) => void) => {
        terminalMocks.dataHandlers.push(handler);
        return { dispose: vi.fn() };
      }),
      attachCustomKeyEventHandler: vi.fn(
        (handler: (event: KeyboardEvent) => boolean) => {
          terminalMocks.keyHandlers.push(handler);
        },
      ),
      hasSelection: vi.fn(() => false),
      getSelection: vi.fn(() => ""),
      scrollToBottom: vi.fn(),
      dispose: vi.fn(),
      options: { ...(options as Record<string, unknown>) },
    };
    terminalMocks.terminalOptions.push(options);
    terminalMocks.terminals.push(terminal);
    return terminal;
  }),
}));

vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return {
      fit: vi.fn(),
      proposeDimensions: vi.fn(() => ({ rows: 24, cols: 80 })),
    };
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, callback: (event: unknown) => void) => {
    terminalMocks.listeners.push({ eventName, callback });
    return (
      terminalMocks.listenPromiseRef.current ??
      Promise.resolve(terminalMocks.unlisten)
    );
  }),
}));

const readAgentSessionTerminalMock = vi.mocked(readAgentSessionTerminal);
const restoreAgentSessionTerminalMock = vi.mocked(restoreAgentSessionTerminal);
const resizeAgentSessionTerminalMock = vi.mocked(resizeAgentSessionTerminal);
const writeAgentSessionTerminalMock = vi.mocked(writeAgentSessionTerminal);

describe("CodexTerminal", () => {
  beforeEach(() => {
    terminalMocks.dataHandlers.length = 0;
    terminalMocks.keyHandlers.length = 0;
    terminalMocks.listenPromiseRef.current = null;
    terminalMocks.listeners.length = 0;
    terminalMocks.terminalOptions.length = 0;
    terminalMocks.terminals.length = 0;
    terminalMocks.unlisten.mockReset();
    readAgentSessionTerminalMock.mockReset();
    restoreAgentSessionTerminalMock.mockReset();
    resizeAgentSessionTerminalMock.mockReset();
    writeAgentSessionTerminalMock.mockReset();
    readAgentSessionTerminalMock.mockResolvedValue({
      sessionId: 301,
      snapshot: "",
      isActive: true,
    });
    restoreAgentSessionTerminalMock.mockResolvedValue({
      sessionId: 301,
      sequence: 0,
      chunks: [],
      isComplete: true,
      isActive: true,
    });
    resizeAgentSessionTerminalMock.mockResolvedValue(undefined);
    writeAgentSessionTerminalMock.mockResolvedValue(undefined);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        matches: false,
      })),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
  });

  it("shows a factual fallback when xterm cannot boot in the current environment", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });

    render(<CodexTerminal projectId={1} sessionId={301} />);

    expect(
      screen.getByText(
        "Terminal preview is unavailable in this environment. Runtime PTY/xterm behavior is verified in the desktop app.",
      ),
    ).toBeInTheDocument();
    expect(readAgentSessionTerminalMock).not.toHaveBeenCalled();
    expect(restoreAgentSessionTerminalMock).not.toHaveBeenCalled();
    expect(resizeAgentSessionTerminalMock).not.toHaveBeenCalled();
    expect(writeAgentSessionTerminalMock).not.toHaveBeenCalled();
  });

  it("restores complete terminal chunks before applying later live output", async () => {
    restoreAgentSessionTerminalMock.mockResolvedValue({
      sessionId: 301,
      sequence: 2,
      chunks: [
        [65, 66],
        [67, 68],
      ],
      isComplete: true,
      isActive: true,
    });

    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(terminalMocks.terminals[0].write).toHaveBeenCalledWith(
        new Uint8Array([65, 66]),
      );
    });

    expect(terminalMocks.terminals[0].write).toHaveBeenCalledWith(
      new Uint8Array([67, 68]),
    );
    expect(terminalMocks.terminals[0].scrollToBottom).toHaveBeenCalledTimes(1);

    act(() => {
      terminalMocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 301,
          sequence: 2,
          data: [69],
        },
      });
      terminalMocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 301,
          sequence: 3,
          data: [70],
        },
      });
    });

    expect(terminalMocks.terminals[0].write).not.toHaveBeenCalledWith(
      new Uint8Array([69]),
    );
    expect(terminalMocks.terminals[0].write).toHaveBeenCalledWith(
      new Uint8Array([70]),
    );
  });

  it("uses TUI-safe terminal options and installs copy handling", async () => {
    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(terminalMocks.terminals).toHaveLength(1);
    });

    expect(terminalMocks.terminalOptions[0]).toMatchObject({
      convertEol: false,
      cursorInactiveStyle: "outline",
      cursorStyle: "block",
      disableStdin: false,
      lineHeight: 1,
      scrollOnEraseInDisplay: true,
      scrollOnUserInput: true,
      smoothScrollDuration: 0,
    });
    expect(terminalMocks.terminals[0].loadAddon).toHaveBeenCalledTimes(2);
    expect(
      terminalMocks.terminals[0].attachCustomKeyEventHandler,
    ).toHaveBeenCalledTimes(1);
  });

  it("updates the terminal theme without recreating the terminal when the app theme changes", async () => {
    render(
      <I18nProvider>
        <ThemeTerminalHarness />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(terminalMocks.terminals).toHaveLength(1);
    });

    expect(terminalMocks.terminals[0].options.theme).toMatchObject({
      background: "#ffffff",
      foreground: "#161515",
    });

    fireEvent.click(screen.getByRole("button", { name: "Dark mode" }));

    expect(terminalMocks.terminals).toHaveLength(1);
    expect(terminalMocks.terminals[0].options.theme).toMatchObject({
      background: "#050506",
      foreground: "#f2f3f5",
    });
  });

  it("copies the selected terminal output with the platform copy shortcut", async () => {
    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(terminalMocks.keyHandlers).toHaveLength(1);
    });

    terminalMocks.terminals[0].hasSelection.mockReturnValue(true);
    terminalMocks.terminals[0].getSelection.mockReturnValue("selected output");

    const handled = terminalMocks.keyHandlers[0](
      new KeyboardEvent("keydown", { key: "c", metaKey: true }),
    );

    expect(handled).toBe(false);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "selected output",
    );
  });

  it("waits for the Tauri output listener to be registered before restoring", async () => {
    let resolveListen: ((unlisten: () => void) => void) | null = null;
    terminalMocks.listenPromiseRef.current = new Promise((resolve) => {
      resolveListen = resolve;
    });

    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(terminalMocks.listeners).toHaveLength(1);
    });

    expect(restoreAgentSessionTerminalMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveListen?.(terminalMocks.unlisten);
    });

    await waitFor(() => {
      expect(restoreAgentSessionTerminalMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 301,
      });
    });
  });

  it("queues live output until the restore snapshot has been applied", async () => {
    let resolveRestore:
      | ((
          value: Awaited<ReturnType<typeof restoreAgentSessionTerminal>>,
        ) => void)
      | null = null;
    restoreAgentSessionTerminalMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );

    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(terminalMocks.listeners).toHaveLength(1);
    });

    act(() => {
      terminalMocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 301,
          sequence: 2,
          data: [66],
        },
      });
    });

    expect(terminalMocks.terminals[0].write).not.toHaveBeenCalled();

    await act(async () => {
      resolveRestore?.({
        sessionId: 301,
        sequence: 1,
        chunks: [[65]],
        isComplete: true,
        isActive: true,
      });
    });

    expect(terminalMocks.terminals[0].write.mock.calls).toEqual([
      [new Uint8Array([65])],
      [new Uint8Array([66])],
    ]);
  });

  it("shows a local degraded restore state without replaying truncated logs", async () => {
    restoreAgentSessionTerminalMock.mockResolvedValue({
      sessionId: 301,
      sequence: 8,
      chunks: [],
      isComplete: false,
      isActive: true,
    });

    render(<CodexTerminal projectId={1} sessionId={301} />);

    expect(
      await screen.findByText(
        "Terminal restore snapshot is unavailable. New live output will continue below.",
      ),
    ).toBeInTheDocument();
    expect(terminalMocks.terminals[0].write).not.toHaveBeenCalled();
  });

  it("flushes queued live output after a degraded restore without dropping bytes", async () => {
    let resolveRestore:
      | ((
          value: Awaited<ReturnType<typeof restoreAgentSessionTerminal>>,
        ) => void)
      | null = null;
    restoreAgentSessionTerminalMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );

    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(terminalMocks.listeners).toHaveLength(1);
    });

    act(() => {
      terminalMocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 301,
          sequence: 8,
          data: [0x1b, 0x5d, 0x31, 0x30],
        },
      });
    });

    await act(async () => {
      resolveRestore?.({
        sessionId: 301,
        sequence: 8,
        chunks: [],
        isComplete: false,
        isActive: true,
      });
    });

    expect(terminalMocks.terminals[0].write).toHaveBeenCalledWith(
      new Uint8Array([0x1b, 0x5d, 0x31, 0x30]),
    );
    expect(
      screen.queryByText(
        "Terminal restore snapshot is unavailable. New live output will continue below.",
      ),
    ).not.toBeInTheDocument();
  });

  it("uses terminal output events instead of replaying log snapshots for an active session", async () => {
    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(terminalMocks.listeners).toHaveLength(1);
    });

    expect(readAgentSessionTerminalMock).toHaveBeenCalledTimes(1);
    expect(readAgentSessionTerminalMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 301,
      maxBytes: 1,
    });

    act(() => {
      terminalMocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 301,
          sequence: 1,
          data: [0x1b, 0x5b, 0x32, 0x4a],
        },
      });
    });

    expect(terminalMocks.listeners[0].eventName).toBe(
      AGENT_SESSION_TERMINAL_OUTPUT_EVENT,
    );
    expect(terminalMocks.terminals[0].write).toHaveBeenCalledWith(
      new Uint8Array([0x1b, 0x5b, 0x32, 0x4a]),
    );
  });

  it("refreshes liveness after restore and shows inactive state for an open session", async () => {
    readAgentSessionTerminalMock
      .mockResolvedValueOnce({
        sessionId: 301,
        snapshot: "",
        isActive: true,
      })
      .mockResolvedValueOnce({
        sessionId: 301,
        snapshot: "",
        isActive: false,
      });

    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(readAgentSessionTerminalMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2_050));
    });

    expect(
      await screen.findByText(
        "Session terminal is no longer active. Open the session log to inspect output.",
      ),
    ).toBeInTheDocument();
    expect(readAgentSessionTerminalMock).toHaveBeenCalledTimes(2);
  });

  it("clears a transient liveness polling error after the next successful poll", async () => {
    readAgentSessionTerminalMock
      .mockRejectedValueOnce(new Error("temporary poll failure"))
      .mockResolvedValueOnce({
        sessionId: 301,
        snapshot: "",
        isActive: true,
      });

    render(<CodexTerminal projectId={1} sessionId={301} />);

    expect(
      await screen.findByText("temporary poll failure"),
    ).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2_050));
    });

    await waitFor(() => {
      expect(
        screen.queryByText("temporary poll failure"),
      ).not.toBeInTheDocument();
    });
  });

  it("caps queued live output while waiting for restore and keeps newer bytes", async () => {
    let resolveRestore:
      | ((
          value: Awaited<ReturnType<typeof restoreAgentSessionTerminal>>,
        ) => void)
      | null = null;
    restoreAgentSessionTerminalMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );

    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(terminalMocks.listeners).toHaveLength(1);
    });

    act(() => {
      terminalMocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 301,
          sequence: 1,
          data: new Array(70_000).fill(65),
        },
      });
      terminalMocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 301,
          sequence: 2,
          data: [66],
        },
      });
    });

    expect(
      await screen.findByText(
        "Terminal restore is taking longer than expected. Older live output was dropped while waiting for restore.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      resolveRestore?.({
        sessionId: 301,
        sequence: 0,
        chunks: [],
        isComplete: true,
        isActive: true,
      });
    });

    expect(terminalMocks.terminals[0].write).toHaveBeenCalledTimes(1);
    expect(terminalMocks.terminals[0].write).toHaveBeenCalledWith(
      new Uint8Array([66]),
    );
  });

  it("ignores stale output events and disposes the listener on session switch", async () => {
    const { rerender } = render(
      <CodexTerminal projectId={1} sessionId={301} />,
    );

    await waitFor(() => {
      expect(terminalMocks.listeners).toHaveLength(1);
    });

    act(() => {
      terminalMocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 999,
          sequence: 1,
          data: [65],
        },
      });
    });

    expect(terminalMocks.terminals[0].write).not.toHaveBeenCalled();

    rerender(<CodexTerminal projectId={1} sessionId={302} />);

    await waitFor(() => {
      expect(terminalMocks.unlisten).toHaveBeenCalledTimes(1);
      expect(terminalMocks.listeners).toHaveLength(2);
    });
  });

  it("shows terminal write failures inside the terminal shell", async () => {
    render(<CodexTerminal projectId={1} sessionId={301} />);

    await waitFor(() => {
      expect(terminalMocks.listeners).toHaveLength(1);
    });
    terminalMocks.terminals[0].write.mockImplementation(() => {
      throw new Error("write failed");
    });

    act(() => {
      terminalMocks.listeners[0].callback({
        payload: {
          projectId: 1,
          sessionId: 301,
          sequence: 1,
          data: [65],
        },
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent("write failed");
  });

  it("appends only the new suffix when the snapshot tail window slides forward", () => {
    expect(resolveSnapshotUpdate("0123456789", "456789abcd")).toEqual({
      kind: "append",
      data: "abcd",
    });
  });

  it("resets the terminal when snapshots cannot be reconciled", () => {
    expect(resolveSnapshotUpdate("0123456789", "xyz")).toEqual({
      kind: "reset",
      data: "xyz",
    });
  });

  it("returns no update when the snapshot is unchanged", () => {
    expect(resolveSnapshotUpdate("same snapshot", "same snapshot")).toBeNull();
  });
});

function ThemeTerminalHarness() {
  const { setThemePreference } = useI18n();

  return (
    <>
      <button type="button" onClick={() => setThemePreference("dark")}>
        Dark mode
      </button>
      <CodexTerminal projectId={1} sessionId={301} />
    </>
  );
}
