import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";

import { AppShell } from "./app-shell";
import { openSessionMonitorWindow } from "../features/agents/session-notifications/session-monitor-commands";
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

const tauriEventMocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: {
      payload: { projectId: number; sessionId: number };
    }) => void;
  }>,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: {
        payload: { projectId: number; sessionId: number };
      }) => void,
    ) => {
      tauriEventMocks.listeners.push({ eventName, callback });
      return Promise.resolve(tauriEventMocks.unlisten);
    },
  ),
}));

vi.mock("../features/project/project-switcher", () => ({
  ProjectSwitcher: () => <div className="project-switcher">switcher</div>,
}));

vi.mock("../features/issues/issues-activity", () => ({
  IssuesActivity: ({
    onOpenProjectSettingsLabels,
  }: {
    onOpenProjectSettingsLabels?: () => void;
  }) => (
    <div>
      <div>issues activity</div>
      <button type="button" onClick={onOpenProjectSettingsLabels}>
        open labels settings
      </button>
    </div>
  ),
}));

vi.mock("../features/agents/agents-activity", () => ({
  AgentsActivity: ({
    activeSessionId,
  }: {
    activeSessionId?: number | null;
  }) => <div>agents activity {activeSessionId}</div>,
}));

vi.mock(
  "../features/agents/session-notifications/use-agent-session-notifications",
  () => ({
    useAgentSessionNotifications: vi.fn(),
  }),
);

vi.mock(
  "../features/agents/session-notifications/session-monitor-commands",
  () => ({
    closeSessionMonitorWindow: vi.fn(),
    OPEN_AGENT_SESSION_EVENT: "open-agent-session",
    openMonitoredAgentSession: vi.fn(),
    openSessionMonitorWindow: vi.fn(),
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
const listenMock = vi.mocked(listen);
const openSessionMonitorWindowMock = vi.mocked(openSessionMonitorWindow);

describe("AppShell terminals activity persistence", () => {
  beforeEach(() => {
    tauriEventMocks.listeners.length = 0;
    tauriEventMocks.unlisten.mockReset();
    listenMock.mockClear();
    openSessionMonitorWindowMock.mockReset();
    openSessionMonitorWindowMock.mockResolvedValue({
      windowLabel: "session-monitor-main",
    });
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
          completionPolicy: "agent_auto_commit",
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
          completionPolicy: "agent_auto_commit",
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
          completionPolicy: "agent_auto_commit",
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

  it("opens a native desktop monitor window for the current project", async () => {
    render(
      <AppShell
        onCreateProject={() => {}}
        onProjectUpdated={() => {}}
        onProjectsRefresh={vi.fn().mockResolvedValue(undefined)}
        project={{
          id: 1,
          name: "RedWhisk",
          path: "/tmp/redwhisk",
          completionPolicy: "agent_auto_commit",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          recentOpenedAt: "2026-06-15T00:00:00.000Z",
          status: "available",
        }}
        projects={[]}
      />,
    );

    await waitFor(() => {
      expect(openSessionMonitorWindowMock).toHaveBeenCalledWith({
        ownerWindowLabel: "main",
        projectId: 1,
      });
    });
  });

  it("opens the selected agent session from the desktop monitor event", async () => {
    render(
      <AppShell
        onCreateProject={() => {}}
        onProjectUpdated={() => {}}
        onProjectsRefresh={vi.fn().mockResolvedValue(undefined)}
        project={{
          id: 1,
          name: "RedWhisk",
          path: "/tmp/redwhisk",
          completionPolicy: "agent_auto_commit",
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: "",
          recentOpenedAt: "2026-06-15T00:00:00.000Z",
          status: "available",
        }}
        projects={[]}
      />,
    );

    await waitFor(() => {
      expect(tauriEventMocks.listeners).toHaveLength(1);
    });

    await act(async () => {
      tauriEventMocks.listeners[0].callback({
        payload: { projectId: 1, sessionId: 7 },
      });
    });

    expect(await screen.findByText("agents activity 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
