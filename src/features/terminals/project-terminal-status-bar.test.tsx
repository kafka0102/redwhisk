import { act, render, screen, waitFor } from "@testing-library/react";
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
import { clearProjectTerminalShortcutCommandCacheForTests } from "./project-terminal-shortcut-command-cache";

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
    onSave,
    onDelete,
  }: {
    commands: Array<{ id: number; command: string }>;
    onClose: () => void;
    onSave?: (input: {
      id?: number;
      command: string;
      sortOrder: number;
    }) => Promise<void>;
    onDelete?: (id: number) => Promise<void>;
  }) => (
    <div data-testid="shortcut-commands-dialog">
      <span data-testid="dialog-command-count">{commands.length}</span>
      <button type="button" onClick={onClose}>
        close dialog
      </button>
      <button
        type="button"
        onClick={() => {
          void onSave?.({
            command: "pnpm test",
            sortOrder: commands.length,
          });
        }}
      >
        save shortcut command
      </button>
      <button
        type="button"
        onClick={() => {
          const commandId = commands[0]?.id;
          if (commandId !== undefined) {
            void onDelete?.(commandId);
          }
        }}
      >
        delete shortcut command
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
    clearProjectTerminalShortcutCommandCacheForTests();
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

  it("moves focus to the terminal after inserting a shortcut command", async () => {
    listCommandsMock.mockResolvedValue({
      commands: [{ id: 1, projectId: 1, command: "git status", sortOrder: 0 }],
    });
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });
    writeProjectTerminalMock.mockResolvedValue(undefined);

    const terminalFocusTarget = document.createElement("textarea");
    terminalFocusTarget.setAttribute("data-testid", "terminal-focus-target");
    document.body.appendChild(terminalFocusTarget);
    const focusTerminal = vi.fn(() => {
      terminalFocusTarget.focus();
    });

    const user = userEvent.setup();
    try {
      render(
        <ProjectTerminalStatusBar
          projectId={1}
          sessionId={10}
          focusTerminal={focusTerminal}
        />,
      );

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

      await waitFor(() => {
        expect(focusTerminal).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(terminalFocusTarget);
      });
    } finally {
      terminalFocusTarget.remove();
    }
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

  it("uses a 400px min-width for the shortcut commands menu", async () => {
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
    expect(window.getComputedStyle(menuRoot!).minWidth).toBe("400px");
  });

  it("caps shortcut menu height and keeps manage item sticky", async () => {
    listCommandsMock.mockResolvedValue({
      commands: Array.from({ length: 12 }, (_, index) => ({
        id: index + 1,
        projectId: 1,
        command: `cmd-${index + 1}`,
        sortOrder: index,
      })),
    });
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });

    const user = userEvent.setup();
    render(<ProjectTerminalStatusBar projectId={1} sessionId={10} />);

    const trigger = await screen.findByRole("button", {
      name: "Quick commands",
    });
    await user.click(trigger);

    const manageItem = await screen.findByRole("menuitem", {
      name: /Manage quick commands/i,
    });
    expect(manageItem).toHaveClass("project-terminal-status-bar__menu-manage");

    const menuRoot = manageItem.closest(".project-terminal-status-bar__menu");
    expect(menuRoot).toBeTruthy();

    const menuStyle = window.getComputedStyle(menuRoot!);
    expect(menuStyle.maxHeight).toMatch(/min\(500px/);
    expect(menuStyle.overflowY).toBe("auto");

    const manageStyle = window.getComputedStyle(manageItem);
    expect(manageStyle.position).toBe("sticky");
    expect(manageStyle.top).toBe("0px");
  });

  it("shows another open terminal the edited shortcut commands without refetching an unchanged menu", async () => {
    const commands = [
      { id: 1, projectId: 1, command: "git status", sortOrder: 0 },
    ];
    listCommandsMock.mockImplementation(async () => ({
      commands: commands.map((command) => ({ ...command })),
    }));
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });
    saveCommandMock.mockImplementation(async (input) => {
      const saved = {
        id: input.id ?? 2,
        projectId: input.projectId,
        command: input.command,
        sortOrder: input.sortOrder,
      };
      const existingIndex = commands.findIndex(
        (command) => command.id === saved.id,
      );
      if (existingIndex >= 0) {
        commands[existingIndex] = saved;
      } else {
        commands.push(saved);
      }
      return saved;
    });

    const user = userEvent.setup();
    render(
      <>
        <ProjectTerminalStatusBar projectId={1} sessionId={10} />
        <ProjectTerminalStatusBar projectId={1} sessionId={11} />
      </>,
    );

    await waitFor(() => {
      expect(listCommandsMock).toHaveBeenCalledTimes(2);
    });

    const triggers = screen.getAllByRole("button", { name: "Quick commands" });
    await user.click(triggers[1]);
    expect(
      await screen.findByRole("menuitem", { name: "git status" }),
    ).toBeInTheDocument();
    expect(listCommandsMock).toHaveBeenCalledTimes(2);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: "git status" }),
      ).not.toBeInTheDocument();
    });
    await user.click(triggers[1]);
    expect(
      await screen.findByRole("menuitem", { name: "git status" }),
    ).toBeInTheDocument();
    expect(listCommandsMock).toHaveBeenCalledTimes(2);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: "git status" }),
      ).not.toBeInTheDocument();
    });

    await user.click(triggers[0]);
    await user.click(await screen.findByText("Manage quick commands"));
    await user.click(
      await screen.findByRole("button", { name: "save shortcut command" }),
    );
    await waitFor(() => {
      expect(saveCommandMock).toHaveBeenCalledWith({
        projectId: 1,
        command: "pnpm test",
        sortOrder: 1,
      });
    });
    await waitFor(() => {
      expect(listCommandsMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    await user.click(triggers[1]);
    expect(
      await screen.findByRole("menuitem", { name: "pnpm test" }),
    ).toBeInTheDocument();

    const callsAfterChangedMenuOpen = listCommandsMock.mock.calls.length;
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: "pnpm test" }),
      ).not.toBeInTheDocument();
    });
    await user.click(triggers[1]);
    expect(
      await screen.findByRole("menuitem", { name: "pnpm test" }),
    ).toBeInTheDocument();
    expect(listCommandsMock).toHaveBeenCalledTimes(callsAfterChangedMenuOpen);
  });

  it("drops a shortcut command from another open terminal after it is deleted", async () => {
    const commands = [
      { id: 1, projectId: 1, command: "git status", sortOrder: 0 },
      { id: 2, projectId: 1, command: "git diff", sortOrder: 1 },
    ];
    listCommandsMock.mockImplementation(async () => ({
      commands: commands.map((command) => ({ ...command })),
    }));
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });
    deleteCommandMock.mockImplementation(async ({ id }) => {
      const nextCommands = commands.filter((command) => command.id !== id);
      commands.splice(0, commands.length, ...nextCommands);
    });

    const user = userEvent.setup();
    render(
      <>
        <ProjectTerminalStatusBar projectId={1} sessionId={10} />
        <ProjectTerminalStatusBar projectId={1} sessionId={11} />
      </>,
    );

    await waitFor(() => {
      expect(listCommandsMock).toHaveBeenCalledTimes(2);
    });

    const triggers = screen.getAllByRole("button", { name: "Quick commands" });
    await user.click(triggers[0]);
    await user.click(await screen.findByText("Manage quick commands"));
    await user.click(
      await screen.findByRole("button", { name: "delete shortcut command" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("dialog-command-count")).toHaveTextContent("1");
    });
    const callsAfterDelete = listCommandsMock.mock.calls.length;

    await user.click(triggers[1]);
    expect(
      await screen.findByRole("menuitem", { name: "git diff" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "git status" }),
    ).not.toBeInTheDocument();
    expect(listCommandsMock).toHaveBeenCalledTimes(callsAfterDelete);

    await user.keyboard("{Escape}");
    await user.click(triggers[1]);
    expect(
      await screen.findByRole("menuitem", { name: "git diff" }),
    ).toBeInTheDocument();
    expect(listCommandsMock).toHaveBeenCalledTimes(callsAfterDelete);
  });

  it("keeps another project's shortcut menu unchanged", async () => {
    const commandsByProject = new Map<
      number,
      Array<{
        id: number;
        projectId: number;
        command: string;
        sortOrder: number;
      }>
    >([
      [1, [{ id: 1, projectId: 1, command: "git status", sortOrder: 0 }]],
      [2, [{ id: 3, projectId: 2, command: "pwd", sortOrder: 0 }]],
    ]);
    listCommandsMock.mockImplementation(async ({ projectId }) => ({
      commands: (commandsByProject.get(projectId) ?? []).map((command) => ({
        ...command,
      })),
    }));
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });
    saveCommandMock.mockImplementation(async (input) => {
      const saved = {
        id: 2,
        projectId: input.projectId,
        command: input.command,
        sortOrder: input.sortOrder,
      };
      const current = commandsByProject.get(input.projectId) ?? [];
      commandsByProject.set(input.projectId, [...current, saved]);
      return saved;
    });

    const user = userEvent.setup();
    render(
      <>
        <ProjectTerminalStatusBar projectId={1} sessionId={10} />
        <ProjectTerminalStatusBar projectId={2} sessionId={20} />
      </>,
    );

    await waitFor(() => {
      expect(listCommandsMock).toHaveBeenCalledTimes(2);
    });

    const triggers = screen.getAllByRole("button", { name: "Quick commands" });
    await user.click(triggers[0]);
    await user.click(await screen.findByText("Manage quick commands"));
    await user.click(
      await screen.findByRole("button", { name: "save shortcut command" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("dialog-command-count")).toHaveTextContent("2");
    });
    const callsAfterEdit = listCommandsMock.mock.calls.length;

    await user.click(triggers[1]);
    expect(
      await screen.findByRole("menuitem", { name: "pwd" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "pnpm test" }),
    ).not.toBeInTheDocument();
    expect(listCommandsMock).toHaveBeenCalledTimes(callsAfterEdit);
  });

  it("ignores a slower shortcut command response that finishes after an edit", async () => {
    const staleResolvers: Array<
      (value: {
        commands: Array<{
          id: number;
          projectId: number;
          command: string;
          sortOrder: number;
        }>;
      }) => void
    > = [];
    let callCount = 0;
    listCommandsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          callCount += 1;
          if (callCount <= 2) {
            staleResolvers.push(resolve);
            return;
          }
          resolve({
            commands: [
              { id: 2, projectId: 1, command: "pnpm test", sortOrder: 0 },
            ],
          });
        }),
    );
    readCwdMock.mockResolvedValue({ sessionId: 10, cwd: null });
    saveCommandMock.mockResolvedValue({
      id: 2,
      projectId: 1,
      command: "pnpm test",
      sortOrder: 1,
    });

    const user = userEvent.setup();
    render(
      <>
        <ProjectTerminalStatusBar projectId={1} sessionId={10} />
        <ProjectTerminalStatusBar projectId={1} sessionId={11} />
      </>,
    );

    await waitFor(() => {
      expect(staleResolvers).toHaveLength(2);
    });

    const triggers = screen.getAllByRole("button", { name: "Quick commands" });
    await user.click(triggers[0]);
    await user.click(await screen.findByText("Manage quick commands"));
    await user.click(
      await screen.findByRole("button", { name: "save shortcut command" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("dialog-command-count")).toHaveTextContent("1");
    });

    await act(async () => {
      for (const resolveStale of staleResolvers) {
        resolveStale({
          commands: [
            { id: 1, projectId: 1, command: "git status", sortOrder: 0 },
          ],
        });
      }
    });

    expect(screen.getByTestId("dialog-command-count")).toHaveTextContent("1");
    const callsAfterEdit = listCommandsMock.mock.calls.length;
    await user.click(triggers[1]);
    expect(
      await screen.findByRole("menuitem", { name: "pnpm test" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "git status" }),
    ).not.toBeInTheDocument();
    expect(listCommandsMock).toHaveBeenCalledTimes(callsAfterEdit);
  });
});
