import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSettingsActivity } from "./project-settings-activity";
import {
  detectCodexCommand,
  listAgentProfiles,
  listAgentSkills,
  saveAgentProfile,
  testAgentCommand,
  type AgentSkillListResponse,
  type AgentProfileRecord,
} from "./settings-commands";
import { updateProjectSettings } from "../project/project-commands";

vi.mock("./settings-commands", () => ({
  detectCodexCommand: vi.fn(),
  testAgentCommand: vi.fn(),
  listAgentProfiles: vi.fn(),
  listAgentSkills: vi.fn(),
  saveAgentProfile: vi.fn(),
}));

const settingsEventMocks = vi.hoisted(() => {
  const listeners: Array<{
    eventName: string;
    callback: (event: {
      payload: { scope: string; projectId: number | null };
    }) => void;
  }> = [];
  const unlisten = vi.fn();

  return {
    listeners,
    unlisten,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: {
        payload: { scope: string; projectId: number | null };
      }) => void,
    ) => {
      settingsEventMocks.listeners.push({ eventName, callback });
      return Promise.resolve(settingsEventMocks.unlisten);
    },
  ),
}));

vi.mock("../project/project-commands", () => ({
  updateProjectSettings: vi.fn(),
}));

const detectCodexCommandMock = vi.mocked(detectCodexCommand);
const testAgentCommandMock = vi.mocked(testAgentCommand);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const listAgentSkillsMock = vi.mocked(listAgentSkills);
const saveAgentProfileMock = vi.mocked(saveAgentProfile);
const updateProjectSettingsMock = vi.mocked(updateProjectSettings);
const onProjectUpdated = vi.fn();

const projectProfile: AgentProfileRecord = {
  id: 1,
  name: "Project Codex",
  agentType: "codex",
  command: "/usr/local/bin/codex",
  scope: "project",
  projectId: 1,
  mode: "full-auto",
  dangerous: true,
  defaultSkill: "",
  promptTemplate: "",
};

const globalProfile: AgentProfileRecord = {
  id: 2,
  name: "Global Codex",
  agentType: "codex",
  command: "/usr/local/bin/codex",
  scope: "global",
  projectId: null,
  mode: "full-auto",
  dangerous: true,
  defaultSkill: "",
  promptTemplate: "",
};

describe("ProjectSettingsActivity", () => {
  beforeEach(() => {
    detectCodexCommandMock.mockReset();
    testAgentCommandMock.mockReset();
    listAgentProfilesMock.mockReset();
    listAgentSkillsMock.mockReset();
    saveAgentProfileMock.mockReset();
    updateProjectSettingsMock.mockReset();
    settingsEventMocks.listeners.length = 0;
    settingsEventMocks.unlisten.mockReset();
    onProjectUpdated.mockReset();
    detectCodexCommandMock.mockResolvedValue({
      command: "/usr/local/bin/codex",
    });
    updateProjectSettingsMock.mockResolvedValue({
      id: 1,
      name: "RedWhisk",
      repoPath: "/tmp/redwhisk",
      completionPolicy: "agent_auto_commit",
      createdAt: 1_780_624_800_000,
      lastOpenedAt: 1_780_628_400_000,
    });
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") return { profiles: [projectProfile] };
      return { profiles: [globalProfile] };
    });
    listAgentSkillsMock.mockImplementation(async ({ agentType, projectId }) =>
      skillResponse([
        {
          name: `${agentType ?? "codex"}-global`,
          path: `/home/me/.agents/skills/${agentType ?? "codex"}-global/SKILL.md`,
          agentType: agentType ?? "codex",
          scope: "global",
          projectId: null,
          sourceRoot: "/home/me/.agents/skills",
        },
        ...(projectId === null
          ? []
          : [
              {
                name: `${agentType ?? "codex"}-project`,
                path: `/repo/.agents/skills/${agentType ?? "codex"}-project/SKILL.md`,
                agentType: agentType ?? "codex",
                scope: "project" as const,
                projectId: projectId ?? null,
                sourceRoot: "/repo/.agents/skills",
              },
            ]),
      ]),
    );
  });

  it("renders two-column layout with agents menu active by default", async () => {
    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    expect(
      await screen.findByRole("navigation", { name: "Settings menu" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument();
    expect(screen.getByTestId("settings-menu-icon-general")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("settings-menu-icon-agents")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New agent" }),
    ).toBeInTheDocument();
  });

  it("exposes and updates the settings menu splitter width", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    const splitter = screen.getByRole("separator", {
      name: "Resize settings menu",
    });
    expect(splitter).toHaveAttribute("aria-orientation", "vertical");
    expect(splitter).toHaveAttribute("aria-valuemin", "180");
    expect(splitter).toHaveAttribute("aria-valuemax", "420");
    expect(splitter).toHaveAttribute("aria-valuenow", "180");

    splitter.focus();
    await user.keyboard("{ArrowRight}");
    expect(splitter).toHaveAttribute("aria-valuenow", "196");
    await user.keyboard("{ArrowLeft}");
    expect(splitter).toHaveAttribute("aria-valuenow", "180");
    await user.keyboard("{End}");
    expect(splitter).toHaveAttribute("aria-valuenow", "420");
    await user.keyboard("{Home}");
    expect(splitter).toHaveAttribute("aria-valuenow", "180");
  });

  it("resizes the settings menu by mouse drag and clears global drag state", async () => {
    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    const splitter = screen.getByRole("separator", {
      name: "Resize settings menu",
    });

    await userEvent.pointer([
      { keys: "[MouseRight>]", target: splitter, coords: { clientX: 200 } },
      { keys: "[/MouseRight]" },
    ]);
    expect(splitter).toHaveAttribute("aria-valuenow", "180");
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");

    await userEvent.pointer([
      { keys: "[MouseLeft>]", target: splitter, coords: { clientX: 200 } },
      { target: window.document.body, coords: { clientX: 480 } },
    ]);
    expect(splitter).toHaveAttribute("aria-valuenow", "420");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    await userEvent.pointer([
      { target: window.document.body, coords: { clientX: -80 } },
    ]);
    expect(splitter).toHaveAttribute("aria-valuenow", "180");

    window.dispatchEvent(new Event("blur"));
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("switches settings modules through a shared content title", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "General" }));

    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "General" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("General")).toHaveClass(
      "settings-section--general",
    );
    expect(
      screen.getByLabelText("General").querySelector(".settings-section__body"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Project Name")).toHaveValue("RedWhisk");
    expect(screen.getByLabelText("Git completion strategy")).toHaveValue(
      "manual",
    );
    expect(screen.getByRole("option", { name: "Manual" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Auto Commit" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Agents" }));

    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Configured agents" }),
    ).toBeInTheDocument();
  });

  it("shows agents in a table below the new agent action card", async () => {
    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Agents" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New agent" }),
    ).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Configured agents" });
    expect(table).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Type" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Name" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Command" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Scope" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Workflow Skill" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Project Codex" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Global Codex" }),
    ).toBeInTheDocument();
    expect(within(table).getAllByRole("cell", { name: "codex" })).toHaveLength(
      2,
    );
    expect(
      within(table).getByRole("cell", { name: "Project" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("cell", { name: "Global" }),
    ).toBeInTheDocument();
    expect(within(table).getAllByRole("cell", { name: "—" })).toHaveLength(2);
    expect(screen.getAllByAltText("Agent 类型：Codex")).toHaveLength(2);
  });

  it("opens the edit form from table rows with keyboard shortcuts", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    const projectRow = (await screen.findByRole("cell", {
      name: "Project Codex",
    })).closest("tr");
    expect(projectRow).not.toBeNull();
    projectRow?.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("heading", { name: "Edit Agent" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    const globalRow = screen
      .getByRole("cell", { name: "Global Codex" })
      .closest("tr");
    expect(globalRow).not.toBeNull();
    globalRow?.focus();
    await user.keyboard(" ");

    expect(
      screen.getByRole("heading", { name: "Edit Agent" }),
    ).toBeInTheDocument();
  });

  it("shows No agents for empty project and global lists", async () => {
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    expect(await screen.findAllByText("No agents")).toHaveLength(1);
  });

  it("opens the add form when clicking the new agent button", async () => {
    const user = userEvent.setup();
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New agent" }));

    expect(
      screen.getByRole("heading", { name: "Add Global Agent" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves a new global agent after manual command test", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });
    testAgentCommandMock.mockResolvedValue({
      command: "/opt/codex/bin/codex",
    });
    saveAgentProfileMock.mockResolvedValue({
      ...globalProfile,
      name: "My Codex",
      command: "/opt/codex/bin/codex",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New agent" }));
    await user.type(screen.getByLabelText("Agent profile name"), "My Codex");
    await user.clear(screen.getByLabelText("Agent command"));
    await user.type(
      screen.getByLabelText("Agent command"),
      "/opt/codex/bin/codex",
    );
    await user.click(screen.getByRole("button", { name: "Test" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Codex",
          command: "/opt/codex/bin/codex",
          scope: "global",
          projectId: 1,
        }),
      ),
    );
  });

  it("shows cached Codex skills when creating a new agent", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });
    saveAgentProfileMock.mockResolvedValue({
      ...globalProfile,
      defaultSkill: "codex-global",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New agent" }));

    expect(listAgentSkillsMock).toHaveBeenCalledWith({
      agentType: "codex",
      projectId: null,
    });
    expect(
      await screen.findByRole("option", { name: "codex-global" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "codex-project" }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Agent profile name"), "Skill Agent");
    await user.type(
      screen.getByLabelText("Agent command"),
      "/usr/local/bin/codex",
    );
    await user.selectOptions(
      screen.getByLabelText("Default skill"),
      "codex-global",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "codex",
          defaultSkill: "codex-global",
        }),
      ),
    );
  });

  it("reloads skills when switching to Claude without resetting other fields", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });
    saveAgentProfileMock.mockResolvedValue({
      ...globalProfile,
      agentType: "claude",
      defaultSkill: "claude-global",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New agent" }));
    await user.type(
      screen.getByLabelText("Agent profile name"),
      "Claude Agent",
    );
    await user.type(
      screen.getByLabelText("Agent command"),
      "/usr/local/bin/claude",
    );
    await user.selectOptions(screen.getByLabelText("Agent type"), "claude");

    expect(
      await screen.findByRole("option", { name: "claude-global" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Agent profile name")).toHaveValue(
      "Claude Agent",
    );

    await user.selectOptions(
      screen.getByLabelText("Default skill"),
      "claude-global",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "claude",
          defaultSkill: "claude-global",
        }),
      ),
    );
  });

  it("keeps the latest agent type skills when older requests finish later", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });
    const pendingSkills: Partial<
      Record<"codex" | "claude", (response: AgentSkillListResponse) => void>
    > = {};
    listAgentSkillsMock.mockImplementation(
      ({ agentType }) =>
        new Promise((resolve) => {
          pendingSkills[agentType ?? "codex"] = resolve;
        }),
    );

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New agent" }));
    await waitFor(() => expect(pendingSkills.codex).toBeDefined());
    await user.selectOptions(screen.getByLabelText("Agent type"), "claude");
    await waitFor(() => expect(pendingSkills.claude).toBeDefined());

    await act(async () => {
      pendingSkills.claude?.(
        skillResponse([
          {
            name: "claude-project",
            path: "/repo/.claude/skills/claude-project/SKILL.md",
            agentType: "claude",
            scope: "project",
            projectId: 1,
            sourceRoot: "/repo/.claude/skills",
          },
        ]),
      );
    });
    expect(
      await screen.findByRole("option", { name: "claude-project" }),
    ).toBeInTheDocument();

    await act(async () => {
      pendingSkills.codex?.(
        skillResponse([
          {
            name: "codex-project",
            path: "/repo/.agents/skills/codex-project/SKILL.md",
            agentType: "codex",
            scope: "project",
            projectId: 1,
            sourceRoot: "/repo/.agents/skills",
          },
        ]),
      );
    });

    expect(screen.getByLabelText("Agent type")).toHaveValue("claude");
    expect(
      screen.getByRole("option", { name: "claude-project" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "codex-project" }),
    ).not.toBeInTheDocument();
  });

  it("refreshes the skill dropdown after agent skill update events", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });
    let skillNames = ["codex-project"];
    listAgentSkillsMock.mockImplementation(async ({ agentType, projectId }) =>
      skillResponse(
        skillNames.map((name) => ({
          name,
          path: `/repo/.agents/skills/${name}/SKILL.md`,
          agentType: agentType ?? "codex",
          scope: "project",
          projectId: projectId ?? null,
          sourceRoot: "/repo/.agents/skills",
        })),
      ),
    );

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New agent" }));
    await user.type(screen.getByLabelText("Agent profile name"), "Unsaved");
    expect(
      await screen.findByRole("option", { name: "codex-project" }),
    ).toBeInTheDocument();

    skillNames = ["codex-project", "codex-refreshed"];
    await waitFor(() =>
      expect(
        settingsEventMocks.listeners.some(
          (listener) => listener.eventName === "agent-skills-updated",
        ),
      ).toBe(true),
    );
    settingsEventMocks.listeners[0]?.callback({
      payload: { scope: "global", projectId: null },
    });

    expect(
      await screen.findByRole("option", { name: "codex-refreshed" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Agent profile name")).toHaveValue("Unsaved");
  });

  it("reloads agents when project id changes", async () => {
    let resolveProjectProfiles:
      | ((value: { profiles: AgentProfileRecord[] }) => void)
      | undefined;
    listAgentProfilesMock.mockImplementation(({ scope, projectId }) => {
      if (scope === "project" && projectId === 2) {
        return new Promise((resolve) => {
          resolveProjectProfiles = resolve;
        });
      }

      if (scope === "project")
        return Promise.resolve({ profiles: [projectProfile] });
      return Promise.resolve({ profiles: [globalProfile] });
    });

    const { rerender } = render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await screen.findByText("Project Codex");
    expect(listAgentProfilesMock).toHaveBeenCalledWith({
      scope: "project",
      projectId: 1,
    });

    rerender(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={2}
        projectName="Agents Lab"
      />,
    );

    await waitFor(() =>
      expect(listAgentProfilesMock).toHaveBeenCalledWith({
        scope: "project",
        projectId: 2,
      }),
    );
    expect(screen.queryByText("Project Codex")).not.toBeInTheDocument();

    resolveProjectProfiles?.({ profiles: [] });
    await screen.findByText("Global Codex");
  });

  it("clears open agent dialogs when project id changes", async () => {
    const user = userEvent.setup();
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });

    const { rerender } = render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "New agent" }));
    expect(
      screen.getByRole("heading", { name: "Add Global Agent" }),
    ).toBeInTheDocument();

    rerender(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={2}
        projectName="Agents Lab"
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Add Global Agent" }),
    ).not.toBeInTheDocument();
  });

  it("saves project name and completion strategy from the general settings section", async () => {
    const user = userEvent.setup();
    updateProjectSettingsMock.mockResolvedValue({
      id: 1,
      name: "RedWhisk Desktop",
      repoPath: "/tmp/redwhisk",
      completionPolicy: "agent_auto_commit",
      createdAt: 1_780_624_800_000,
      lastOpenedAt: 1_780_628_400_000,
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "General" }));
    await user.clear(await screen.findByLabelText("Project Name"));
    await user.type(screen.getByLabelText("Project Name"), "RedWhisk Desktop");
    await user.selectOptions(
      screen.getByLabelText("Git completion strategy"),
      "agent_auto_commit",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateProjectSettingsMock).toHaveBeenCalledWith({
        projectId: 1,
        name: "RedWhisk Desktop",
        completionPolicy: "agent_auto_commit",
      }),
    );
    expect(onProjectUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        name: "RedWhisk Desktop",
        completionPolicy: "agent_auto_commit",
      }),
    );
  });
});

function skillResponse(
  skills: AgentSkillListResponse["skills"],
): AgentSkillListResponse {
  return {
    skills,
    globalStatus: "ready",
    projectStatus: "ready",
    lastError: null,
  };
}
