import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodexTerminal } from "./codex-terminal";
import {
  readAgentSessionTerminal,
  resizeAgentSessionTerminal,
  writeAgentSessionTerminal,
} from "./agent-session-commands";
import { resolveSnapshotUpdate } from "./codex-terminal-snapshot";

vi.mock("./agent-session-commands", () => ({
  readAgentSessionTerminal: vi.fn(),
  resizeAgentSessionTerminal: vi.fn(),
  writeAgentSessionTerminal: vi.fn(),
}));

const readAgentSessionTerminalMock = vi.mocked(readAgentSessionTerminal);
const resizeAgentSessionTerminalMock = vi.mocked(resizeAgentSessionTerminal);
const writeAgentSessionTerminalMock = vi.mocked(writeAgentSessionTerminal);

describe("CodexTerminal", () => {
  beforeEach(() => {
    readAgentSessionTerminalMock.mockReset();
    resizeAgentSessionTerminalMock.mockReset();
    writeAgentSessionTerminalMock.mockReset();
  });

  it("shows a factual fallback when xterm cannot boot in the current environment", () => {
    render(<CodexTerminal projectId={1} sessionId={301} />);

    expect(
      screen.getByText(
        "Terminal preview is unavailable in this environment. Runtime PTY/xterm behavior is verified in the desktop app.",
      ),
    ).toBeInTheDocument();
    expect(readAgentSessionTerminalMock).not.toHaveBeenCalled();
    expect(resizeAgentSessionTerminalMock).not.toHaveBeenCalled();
    expect(writeAgentSessionTerminalMock).not.toHaveBeenCalled();
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
