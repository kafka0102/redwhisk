import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectTerminalsActivity } from "./project-terminals-activity";
import {
  closeProjectTerminal,
  createProjectTerminal,
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
  closeProjectTerminal: vi.fn(),
  createProjectTerminal: vi.fn(),
}));

const createProjectTerminalMock = vi.mocked(createProjectTerminal);
const closeProjectTerminalMock = vi.mocked(closeProjectTerminal);

describe("ProjectTerminalsActivity", () => {
  beforeEach(() => {
    createProjectTerminalMock.mockReset();
    closeProjectTerminalMock.mockReset();
    createProjectTerminalMock
      .mockResolvedValueOnce({
        sessionId: -1,
        name: "local-dev-web",
      })
      .mockResolvedValueOnce({
        sessionId: -2,
        name: "local-dev-incident",
      });
    closeProjectTerminalMock.mockResolvedValue(undefined);
  });

  it("renders only a centered new terminal button when there are no terminals", () => {
    render(
      <ProjectTerminalsActivity
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    expect(
      screen.getByRole("button", { name: "+ New terminal" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Terminals", level: 2 }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Project terminals"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize terminals list" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Terminal workspace" }),
    ).not.toBeInTheDocument();
  });

  it("creates terminals in the left card list and switches the right workspace", async () => {
    const user = userEvent.setup();

    render(
      <ProjectTerminalsActivity
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ New terminal" }));

    await waitFor(() => {
      expect(createProjectTerminalMock).toHaveBeenCalledWith({ projectId: 1 });
    });

    const sidebar = screen.getByLabelText("Project terminals");
    expect(
      within(sidebar).getByRole("button", { name: "local-dev-web" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("project-terminal:1:-1")).toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "New terminal" }),
    );

    await waitFor(() => {
      expect(createProjectTerminalMock).toHaveBeenCalledTimes(2);
    });

    expect(
      within(sidebar).getByRole("button", { name: "local-dev-incident" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByTestId("project-terminal:1:-1"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("project-terminal:1:-2")).toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "local-dev-web" }),
    );

    expect(
      within(sidebar).getByRole("button", { name: "local-dev-web" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("project-terminal:1:-1")).toBeInTheDocument();
  });

  it("hides the project name in terminal cards and applies a selected color", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const user = userEvent.setup();

    render(
      <ProjectTerminalsActivity
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ New terminal" }));

    const sidebar = screen.getByLabelText("Project terminals");
    const terminalButton = within(sidebar).getByRole("button", {
      name: "local-dev-web",
    });
    expect(within(sidebar).queryByText("RedWhisk")).not.toBeInTheDocument();
    expect(terminalButton.parentElement).toHaveAttribute(
      "style",
      expect.stringContaining("--project-terminal-card-background: #fde68a"),
    );

    randomSpy.mockRestore();
  });

  it("renders the selected terminal as the full workspace without an activity header", async () => {
    const user = userEvent.setup();

    render(
      <ProjectTerminalsActivity
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ New terminal" }));

    const workspace = screen.getByRole("region", {
      name: "Terminal workspace",
    });

    expect(workspace.firstElementChild).toHaveClass(
      "project-terminals-workspace__surface",
    );
    expect(
      within(workspace).queryByRole("heading", { name: "local-dev-web" }),
    ).not.toBeInTheDocument();
    expect(within(workspace).queryByText("/tmp/redwhisk")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-terminal:1:-1")).toBeInTheDocument();
  });

  it("deletes the selected terminal and falls back to the remaining workspace", async () => {
    const user = userEvent.setup();

    render(
      <ProjectTerminalsActivity
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ New terminal" }));

    const sidebar = screen.getByLabelText("Project terminals");
    await user.click(
      within(sidebar).getByRole("button", { name: "New terminal" }),
    );

    await waitFor(() => {
      expect(createProjectTerminalMock).toHaveBeenCalledTimes(2);
    });

    await user.click(
      screen.getByRole("button", {
        name: 'Delete terminal "local-dev-incident"',
      }),
    );

    await waitFor(() => {
      expect(closeProjectTerminalMock).toHaveBeenCalledWith({
        projectId: 1,
        sessionId: -2,
      });
    });

    expect(screen.getByTestId("project-terminal:1:-1")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "local-dev-incident" }),
    ).not.toBeInTheDocument();
  });
});
