import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TerminalShortcutCommandsDialog } from "./terminal-shortcut-commands-dialog";
import type { ProjectTerminalShortcutCommandRecord } from "./project-terminal-commands";

function makeCommand(
  overrides: Partial<ProjectTerminalShortcutCommandRecord> = {},
): ProjectTerminalShortcutCommandRecord {
  return {
    id: 1,
    projectId: 1,
    command: "git status",
    sortOrder: 0,
    ...overrides,
  };
}

function setCommandInputValue(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("TerminalShortcutCommandsDialog", () => {
  it("renders the title and existing commands", () => {
    const commands = [
      makeCommand({ id: 1, command: "git status", sortOrder: 0 }),
      makeCommand({ id: 2, command: "git diff", sortOrder: 1 }),
    ];

    render(
      <TerminalShortcutCommandsDialog
        commands={commands}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Quick commands")).toBeInTheDocument();
    expect(screen.getByText("git status")).toBeInTheDocument();
    expect(screen.getByText("git diff")).toBeInTheDocument();
  });

  it("adds a new command via the add button and save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const commands: ProjectTerminalShortcutCommandRecord[] = [];

    render(
      <TerminalShortcutCommandsDialog
        commands={commands}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add command" }));

    const input = await screen.findByPlaceholderText("Enter a command");
    await user.type(input, "ls -la");
    expect(input).toHaveValue("ls -la");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        id: undefined,
        command: "ls -la",
        sortOrder: 0,
      });
    });
  });

  it("switches a row to edit mode and saves the updated command", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const commands = [
      makeCommand({ id: 5, command: "git status", sortOrder: 0 }),
    ];

    render(
      <TerminalShortcutCommandsDialog
        commands={commands}
        onClose={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText("Edit"));

    const input = await screen.findByDisplayValue("git status");
    setCommandInputValue(input, "git diff --staged");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        id: 5,
        command: "git diff --staged",
        sortOrder: 0,
      });
    });
  });

  it("deletes a command through the delete button", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const commands = [
      makeCommand({ id: 7, command: "rm -rf /tmp/cache", sortOrder: 0 }),
    ];

    render(
      <TerminalShortcutCommandsDialog
        commands={commands}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByLabelText("Delete"));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(7);
    });
  });

  it("disables the add button when the limit is reached", () => {
    const commands = Array.from({ length: 30 }, (_, index) =>
      makeCommand({
        id: index + 1,
        command: `cmd-${index}`,
        sortOrder: index,
      }),
    );

    render(
      <TerminalShortcutCommandsDialog
        commands={commands}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add command" })).toBeDisabled();
  });

  it("shows an empty hint when there are no commands", () => {
    render(
      <TerminalShortcutCommandsDialog
        commands={[]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("No quick commands yet.")).toBeInTheDocument();
  });

  it("closes the dialog via the footer close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <TerminalShortcutCommandsDialog
        commands={[]}
        onClose={onClose}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps cancel label on the edit-row cancel control", async () => {
    const user = userEvent.setup();

    render(
      <TerminalShortcutCommandsDialog
        commands={[makeCommand({ id: 3, command: "echo hi", sortOrder: 0 })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText("Edit"));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
