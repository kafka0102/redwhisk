import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../../shared/styles/terminals.css";
import { ProjectTerminalStatusBar } from "./project-terminal-status-bar";
import {
  deleteProjectTerminalShortcutCommand,
  listProjectTerminalShortcutCommands,
  readProjectTerminalCwd,
  saveProjectTerminalShortcutCommand,
  writeProjectTerminal,
} from "./project-terminal-commands";

vi.mock("./project-terminal-commands", () => ({
  deleteProjectTerminalShortcutCommand: vi.fn(),
  listProjectTerminalShortcutCommands: vi.fn(),
  readProjectTerminalCwd: vi.fn(),
  saveProjectTerminalShortcutCommand: vi.fn(),
  writeProjectTerminal: vi.fn(),
}));

vi.mock("./terminal-shortcut-commands-dialog", () => ({
  TerminalShortcutCommandsDialog: ({
    commands,
    onClose,
  }: {
    commands: Array<{ id: number; command: string }>;
    onClose: () => void;
  }) => (
    <div data-testid="shortcut-commands-dialog">
      <span data-testid="dialog-command-count">{commands.length}</span>
      <button type="button" onClick={onClose}>
        close dialog
      </button>
    </div>
  ),
}));

const listCommandsMock = vi.mocked(listProjectTerminalShortcutCommands);
const readCwdMock = vi.mocked(readProjectTerminalCwd);
const writeProjectTerminalMock = vi.mocked(writeProjectTerminal);
const saveCommandMock = vi.mocked(saveProjectTerminalShortcutCommand);
const deleteCommandMock = vi.mocked(deleteProjectTerminalShortcutCommand);

describe("ProjectTerminalStatusBar", () => {
  beforeEach(() => {
    listCommandsMock.mockReset();
    readCwdMock.mockReset();
    writeProjectTerminalMock.mockReset();
    saveCommandMock.mockReset();
    deleteCommandMock.mockReset();
  });

  it("loads shortcut commands and current cwd on mount", async () => {
    listCommandsMock.mockResolvedValue({
      commands: [
        { id: 1, projectId: 1, command: "git status", sortOrder: 0 },
        { id: 2, projectId: 1, command: "git diff", sortOrder: 1 },
      ],
    });
    readCwdMock.mockResolvedValue({
      sessionId: 10,
      cwd: "/Users/test/project",
    });

    render(<ProjectTerminalStatusBar projectId={1} sessionId={10} />);

    await waitFor(() => {
      expect(listCommandsMock).toHaveBeenCalledWith({ projectId: 1 });
    });
    await waitFor(() => {
      expect(readCwdMock).toHaveBeenCalledWith({ projectId: 1, sessionId: 10 });
    });

    // 路径以 ~ 缩写显示。
    await waitFor(() => {
      expect(screen.getByText("~/project")).toBeInTheDocument();
    });
  });

  it("runs a command by writing it to the terminal when clicked in the menu", async () => {
    listCommandsMock.mockResolvedValue({
      commands: [{ id: 1, projectId: 1, command: "git status", sortOrder: 0 }],
    });
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });
    writeProjectTerminalMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<ProjectTerminalStatusBar projectId={1} sessionId={10} />);

    const trigger = await screen.findByRole("button", {
      name: "Quick commands",
    });
    await user.click(trigger);

    const commandItem = await screen.findByText("git status");
    await user.click(commandItem);

    await waitFor(() => {
      expect(writeProjectTerminalMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: 10,
        data: "git status",
      });
    });
  });

  it("opens the manage dialog when clicking the manage entry", async () => {
    listCommandsMock.mockResolvedValue({ commands: [] });
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });

    const user = userEvent.setup();
    render(<ProjectTerminalStatusBar projectId={1} sessionId={10} />);

    const trigger = await screen.findByRole("button", {
      name: "Quick commands",
    });
    await user.click(trigger);

    const manageItem = await screen.findByText("Manage quick commands");
    await user.click(manageItem);

    await waitFor(() => {
      expect(
        screen.getByTestId("shortcut-commands-dialog"),
      ).toBeInTheDocument();
    });
  });

  it("shows empty hint when there are no shortcut commands", async () => {
    listCommandsMock.mockResolvedValue({ commands: [] });
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });

    const user = userEvent.setup();
    render(<ProjectTerminalStatusBar projectId={1} sessionId={10} />);

    const trigger = await screen.findByRole("button", {
      name: "Quick commands",
    });
    await user.click(trigger);

    expect(
      await screen.findByText("No quick commands yet."),
    ).toBeInTheDocument();
  });

  it("uses a 300px min-width for the shortcut commands menu", async () => {
    listCommandsMock.mockResolvedValue({
      commands: [{ id: 1, projectId: 1, command: "git status", sortOrder: 0 }],
    });
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });

    const user = userEvent.setup();
    render(<ProjectTerminalStatusBar projectId={1} sessionId={10} />);

    const trigger = await screen.findByRole("button", {
      name: "Quick commands",
    });
    await user.click(trigger);

    const menu = await screen.findByText("git status");
    const menuRoot = menu.closest(".project-terminal-status-bar__menu");
    expect(menuRoot).toBeTruthy();
    expect(window.getComputedStyle(menuRoot!).minWidth).toBe("300px");
  });
});
