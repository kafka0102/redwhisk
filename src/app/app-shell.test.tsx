import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import {
  closeProjectTerminal,
  createProjectTerminal,
  listProjectTerminals,
} from "../features/terminals/project-terminal-commands";

const mockAppWindow = {
  label: "main",
  isMaximized: vi.fn().mockResolvedValue(false),
  maximize: vi.fn().mockResolvedValue(undefined),
  unmaximize: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mockAppWindow,
}));

vi.mock("../features/project/project-switcher", () => ({
  ProjectSwitcher: () => <div className="project-switcher">switcher</div>,
}));

vi.mock("../features/app-update/use-update-status", () => ({
  useUpdateStatus: () => ({
    status: null,
    dismiss: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../features/issues/issues-activity", () => ({
  IssuesActivity: ({
    issuesReturnSignal,
    onOpenProjectSettingsLabels,
  }: {
    issuesReturnSignal?: number;
    onOpenProjectSettingsLabels?: () => void;
  }) => (
    <div>
      <div>issues activity</div>
      <div>issues signal:{issuesReturnSignal ?? 0}</div>
      <button type="button" onClick={onOpenProjectSettingsLabels}>
        open labels settings
      </button>
    </div>
  ),
}));

vi.mock("../features/agents/agents-activity", () => ({
  AgentsActivity: ({
    activeSessionId,
    onOpenProjectAgentSettings,
  }: {
    activeSessionId?: number | null;
    onOpenProjectAgentSettings?: () => void;
  }) => (
    <div>
      <div>agents activity {activeSessionId}</div>
      <button type="button" onClick={onOpenProjectAgentSettings}>
        open agents settings
      </button>
    </div>
  ),
}));

vi.mock("../features/code/code-workspace", () => ({
  CodeWorkspace: ({ projectId }: { projectId: number }) => (
    <div>code workspace {projectId}</div>
  ),
}));

vi.mock(
  "../features/agents/session-notifications/use-agent-session-notifications",
  () => ({
    useAgentSessionNotifications: vi.fn(),
  }),
);

vi.mock("../features/settings/project-settings-activity", () => ({
  ProjectSettingsActivity: ({ activeMenu }: { activeMenu?: string }) => (
    <div>project settings activity {activeMenu}</div>
  ),
}));

vi.mock("../features/settings/global-settings-activity", () => ({
  GlobalSettingsActivity: () => <div>global settings activity</div>,
}));

vi.mock("../features/terminals/project-terminal", () => ({
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

vi.mock("../features/terminals/project-terminal-commands", () => ({
  closeProjectTerminal: vi.fn(),
  createProjectTerminal: vi.fn(),
  listProjectTerminals: vi.fn(),
}));

const createProjectTerminalMock = vi.mocked(createProjectTerminal);
const closeProjectTerminalMock = vi.mocked(closeProjectTerminal);
const listProjectTerminalsMock = vi.mocked(listProjectTerminals);

describe("AppShell terminals activity persistence", () => {
  beforeEach(() => {
    createProjectTerminalMock.mockReset();
    closeProjectTerminalMock.mockReset();
    listProjectTerminalsMock.mockReset();
    createProjectTerminalMock.mockResolvedValue({
      configId: 101,
      sessionId: -1,
      name: "local-dev-web",
      workingDir: "/tmp/redwhisk",
      launchCommand: "/bin/zsh",
    });
    closeProjectTerminalMock.mockResolvedValue(undefined);
    listProjectTerminalsMock.mockResolvedValue({ terminals: [] });
  });

  it("keeps project terminals after switching away and back", async () => {
    const user = userEvent.setup();
    listProjectTerminalsMock
      .mockResolvedValueOnce({ terminals: [] })
      .mockResolvedValue({
        terminals: [
          {
            configId: 101,
            sessionId: -1,
            name: "local-dev-web",
            workingDir: "/tmp/redwhisk",
            launchCommand: "/bin/zsh",
          },
        ],
      });

    render(
      <AppShell
        onCreateProject={() => {}}
        onProjectUpdated={() => {}}
        onProjectsRefresh={vi.fn().mockResolvedValue(undefined)}
        project={{
          id: 1,
          name: "RedWhisk",
          path: "/tmp/redwhisk",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          recentOpenedAt: "2026-06-15T00:00:00.000Z",
          status: "available",
        }}
        projects={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Terminals" }));
    await user.click(screen.getByRole("button", { name: "+ New terminal" }));

    await waitFor(() => {
      expect(createProjectTerminalMock).toHaveBeenCalledWith({ projectId: 1 });
    });

    await waitFor(() => {
      expect(screen.getByTestId("project-terminal:1:-1")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Issues" }));
    expect(screen.getByText("issues activity")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Terminals" }));

    await waitFor(() => {
      expect(screen.getByTestId("project-terminal:1:-1")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "local-dev-web" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("does not rehydrate empty terminals repeatedly", async () => {
    const user = userEvent.setup();

    render(
      <AppShell
        onCreateProject={() => {}}
        onProjectUpdated={() => {}}
        onProjectsRefresh={vi.fn().mockResolvedValue(undefined)}
        project={{
          id: 1,
          name: "RedWhisk",
          path: "/tmp/redwhisk",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          recentOpenedAt: "2026-06-15T00:00:00.000Z",
          status: "available",
        }}
        projects={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Terminals" }));

    await waitFor(() => {
      expect(listProjectTerminalsMock).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.getByRole("button", { name: "+ New terminal" }),
    ).toBeInTheDocument();
  });

  it("opens project settings on the labels tab when requested from issues", async () => {
    const user = userEvent.setup();

    render(
      <AppShell
        onCreateProject={() => {}}
        onProjectUpdated={() => {}}
        onProjectsRefresh={vi.fn().mockResolvedValue(undefined)}
        project={{
          id: 1,
          name: "RedWhisk",
          path: "/tmp/redwhisk",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          recentOpenedAt: "2026-06-15T00:00:00.000Z",
          status: "available",
        }}
        projects={[]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "open labels settings" }),
    );

    expect(
      screen.getByText("project settings activity labels"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Project Settings" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("opens project settings on the agents tab when requested from agents", async () => {
    const user = userEvent.setup();

    render(
      <AppShell
        onCreateProject={() => {}}
        onProjectUpdated={() => {}}
        onProjectsRefresh={vi.fn().mockResolvedValue(undefined)}
        project={{
          id: 1,
          name: "RedWhisk",
          path: "/tmp/redwhisk",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          recentOpenedAt: "2026-06-15T00:00:00.000Z",
          status: "available",
        }}
        projects={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(
      screen.getByRole("button", { name: "open agents settings" }),
    );

    expect(
      screen.getByText("project settings activity agents"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Project Settings" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the selected agent session from a desktop monitor request", async () => {
    render(
      <AppShell
        onCreateProject={() => {}}
        onProjectUpdated={() => {}}
        onProjectsRefresh={vi.fn().mockResolvedValue(undefined)}
        project={{
          id: 1,
          name: "RedWhisk",
          path: "/tmp/redwhisk",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          recentOpenedAt: "2026-06-15T00:00:00.000Z",
          status: "available",
        }}
        projects={[]}
        openAgentSessionRequest={{
          projectId: 1,
          requestId: 1,
          sessionId: 7,
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("agents activity 7")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("increments the issues return signal when the Issues icon is clicked while already on Issues", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        onCreateProject={() => {}}
        onProjectUpdated={() => {}}
        onProjectsRefresh={vi.fn().mockResolvedValue(undefined)}
        project={{
          id: 1,
          name: "RedWhisk",
          path: "/tmp/redwhisk",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          recentOpenedAt: "2026-06-15T00:00:00.000Z",
          status: "available",
        }}
        projects={[]}
      />,
    );

    expect(screen.getByText("issues signal:0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Issues" }));

    expect(screen.getByText("issues signal:1")).toBeInTheDocument();
  });

  it("opens the independent Code activity between Agents and Terminals", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        onCreateProject={() => {}}
        onProjectUpdated={() => {}}
        onProjectsRefresh={vi.fn().mockResolvedValue(undefined)}
        project={{
          id: 1,
          name: "RedWhisk",
          path: "/tmp/redwhisk",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          recentOpenedAt: "2026-06-15T00:00:00.000Z",
          status: "available",
        }}
        projects={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Code" }));

    expect(screen.getByText("code workspace 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(screen.getByRole("navigation", { name: "Activity Bar" }))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Issues",
      "Agents",
      "Code",
      "Terminals",
      "Project Settings",
      "Global Settings",
    ]);
  });
});
