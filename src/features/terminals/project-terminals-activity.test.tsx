import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectTerminalsActivity } from "./project-terminals-activity";
import { getDefaultProjectTerminalsActivityState } from "./project-terminals-activity-state";
import {
  createProjectTerminal,
  deleteProjectTerminalConfig,
  listProjectTerminals,
  updateProjectTerminalConfig,
} from "./project-terminal-commands";

vi.mock("./project-terminal", () => ({
  ProjectTerminal: ({
    projectId,
    sessionId,
  }: {
    projectId: number;
    sessionId: number;
  }) => (
    <div data-testid={`project-terminal:${projectId}:${sessionId}`}>
      terminal {sessionId}
    </div>
  ),
}));

vi.mock("./project-terminal-commands", () => ({
  createProjectTerminal: vi.fn(),
  deleteProjectTerminalConfig: vi.fn(),
  listProjectTerminals: vi.fn(),
  updateProjectTerminalConfig: vi.fn(),
}));

const createProjectTerminalMock = vi.mocked(createProjectTerminal);
const deleteProjectTerminalConfigMock = vi.mocked(deleteProjectTerminalConfig);
const listProjectTerminalsMock = vi.mocked(listProjectTerminals);
const updateProjectTerminalConfigMock = vi.mocked(updateProjectTerminalConfig);

function renderProjectTerminalsActivity() {
  function Harness() {
    const [state, setState] = useState(getDefaultProjectTerminalsActivityState);

    return (
      <ProjectTerminalsActivity
        onStateChange={setState}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
        state={state}
      />
    );
  }

  return render(<Harness />);
}

describe("ProjectTerminalsActivity", () => {
  beforeEach(() => {
    createProjectTerminalMock.mockReset();
    deleteProjectTerminalConfigMock.mockReset();
    listProjectTerminalsMock.mockReset();
    updateProjectTerminalConfigMock.mockReset();
    deleteProjectTerminalConfigMock.mockResolvedValue({
      configId: 102,
      sessionId: -2,
    });
  });

  it("loads persisted terminals on mount and renders the active workspace", async () => {
    listProjectTerminalsMock.mockResolvedValue({
      terminals: [
        {
          configId: 101,
          sessionId: -1,
          name: "API",
          workingDir: "/tmp/redwhisk/apps/api",
          launchCommand: "pnpm dev",
        },
        {
          configId: 102,
          sessionId: 0,
          name: "Worker",
          workingDir: "/tmp/redwhisk/apps/worker",
          launchCommand: "pnpm worker",
        },
      ],
    });

    renderProjectTerminalsActivity();

    expect(screen.getByRole("status")).toHaveTextContent("Loading terminals...");

    await waitFor(() => {
      expect(listProjectTerminalsMock).toHaveBeenCalledWith({ projectId: 1 });
    });

    const sidebar = screen.getByLabelText("Project terminals");
    expect(within(sidebar).getByRole("button", { name: "API" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("project-terminal:1:-1")).toBeInTheDocument();
    expect(within(sidebar).getByText("/tmp/redwhisk/apps/api")).toBeInTheDocument();
  });

  it("renders the working directory with a home shorthand and truncation styles", async () => {
    listProjectTerminalsMock.mockResolvedValue({
      terminals: [
        {
          configId: 101,
          sessionId: -1,
          name: "API",
          workingDir: "/Users/yujianjia/workspace/kafka/redwhisk/apps/api",
          launchCommand: "pnpm dev",
        },
      ],
    });

    renderProjectTerminalsActivity();

    const sidebar = await screen.findByLabelText("Project terminals");
    const path = within(sidebar).getByText("~/workspace/kafka/redwhisk/apps/api");

    expect(path).toHaveClass("project-terminals-card__meta");
    expect(path).toHaveTextContent("~/workspace/kafka/redwhisk/apps/api");
  });

  it("creates terminals, selects by config id, and keeps a stable active background", async () => {
    const user = userEvent.setup();
    listProjectTerminalsMock.mockResolvedValue({ terminals: [] });
    createProjectTerminalMock.mockResolvedValue({
      configId: 101,
      sessionId: -1,
      name: "API",
      workingDir: "/tmp/redwhisk/apps/api",
      launchCommand: "pnpm dev",
    });

    renderProjectTerminalsActivity();

    await waitFor(() => {
      expect(listProjectTerminalsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "+ New terminal" }));

    await waitFor(() => {
      expect(createProjectTerminalMock).toHaveBeenCalledWith({ projectId: 1 });
    });

    const sidebar = screen.getByLabelText("Project terminals");
    const terminalButton = within(sidebar).getByRole("button", { name: "API" });
    expect(terminalButton).toHaveAttribute("aria-pressed", "true");
    expect(terminalButton.parentElement).toHaveAttribute(
      "style",
      expect.stringContaining("--project-terminal-card-background: color-mix("),
    );
    expect(screen.getByTestId("project-terminal:1:-1")).toBeInTheDocument();
  });

  it("hydrates an empty terminal list only once", async () => {
    listProjectTerminalsMock.mockResolvedValue({ terminals: [] });

    renderProjectTerminalsActivity();

    await waitFor(() => {
      expect(listProjectTerminalsMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("button", { name: "+ New terminal" })).toBeInTheDocument();
    expect(screen.queryByText("Loading terminals...")).not.toBeInTheDocument();
  });

  it("shows unavailable state when persisted terminal has no running session", async () => {
    const user = userEvent.setup();
    listProjectTerminalsMock.mockResolvedValue({
      terminals: [
        {
          configId: 101,
          sessionId: -1,
          name: "API",
          workingDir: "/tmp/redwhisk/apps/api",
          launchCommand: "pnpm dev",
        },
        {
          configId: 102,
          sessionId: 0,
          name: "Worker",
          workingDir: "/tmp/redwhisk/apps/worker",
          launchCommand: "pnpm worker",
        },
      ],
    });

    renderProjectTerminalsActivity();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Worker" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Worker" }));

    expect(screen.getByText("This terminal is not running right now.")).toBeInTheDocument();
    expect(screen.queryByTestId("project-terminal:1:-1")).not.toBeInTheDocument();
  });

  it("opens the edit dialog and saves terminal config updates", async () => {
    const user = userEvent.setup();
    listProjectTerminalsMock.mockResolvedValue({
      terminals: [
        {
          configId: 101,
          sessionId: -1,
          name: "API",
          workingDir: "/tmp/redwhisk/apps/api",
          launchCommand: "pnpm dev",
        },
      ],
    });
    updateProjectTerminalConfigMock.mockResolvedValue({
      terminal: {
        configId: 101,
        sessionId: -1,
        name: "API Dev",
        workingDir: "/tmp/redwhisk/services/api",
        launchCommand: "pnpm start:dev",
      },
    });

    renderProjectTerminalsActivity();

    const editButton = await screen.findByRole("button", {
      name: 'Edit terminal "API"',
    });
    await user.click(editButton);

    const dialog = screen.getByRole("dialog", { name: 'Edit terminal "API"' });
    const nameInput = within(dialog).getByLabelText("Name");
    const pathInput = within(dialog).getByLabelText("Terminal path");
    const commandInput = within(dialog).getByLabelText("Command");

    await user.clear(nameInput);
    await user.type(nameInput, "API Dev");
    await user.clear(pathInput);
    await user.type(pathInput, "/tmp/redwhisk/services/api");
    await user.clear(commandInput);
    await user.type(commandInput, "pnpm start:dev");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateProjectTerminalConfigMock).toHaveBeenCalledWith({
        projectId: 1,
        configId: 101,
        name: "API Dev",
        workingDir: "/tmp/redwhisk/services/api",
        launchCommand: "pnpm start:dev",
      });
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "API Dev" })).toBeInTheDocument();
    expect(screen.getByText("/tmp/redwhisk/services/api")).toBeInTheDocument();
  });

  it("deletes terminal configs through the config delete command and falls back to the next terminal", async () => {
    const user = userEvent.setup();
    listProjectTerminalsMock.mockResolvedValue({
      terminals: [
        {
          configId: 101,
          sessionId: -1,
          name: "API",
          workingDir: "/tmp/redwhisk/apps/api",
          launchCommand: "pnpm dev",
        },
        {
          configId: 102,
          sessionId: -2,
          name: "Worker",
          workingDir: "/tmp/redwhisk/apps/worker",
          launchCommand: "pnpm worker",
        },
      ],
    });

    renderProjectTerminalsActivity();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Worker" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Worker" }));
    await user.click(screen.getByRole("button", { name: 'Delete terminal "Worker"' }));

    await waitFor(() => {
      expect(deleteProjectTerminalConfigMock).toHaveBeenCalledWith({
        projectId: 1,
        configId: 102,
      });
    });

    expect(screen.getByRole("button", { name: "API" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("project-terminal:1:-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Worker" })).not.toBeInTheDocument();
  });
});
