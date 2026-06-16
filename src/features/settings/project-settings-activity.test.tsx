import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSettingsActivity } from "./project-settings-activity";
import {
  deleteAgentProfile,
  detectCodexCommand,
  listAgentProfiles,
  listAgentSkills,
  saveAgentProfile,
  testAgentCommand,
  type AgentSkillListResponse,
  type AgentProfileRecord,
} from "./settings-commands";
import {
  updateProjectSettings,
  validateProjectRepoPath,
} from "../project/project-commands";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("./settings-commands", () => ({
  detectCodexCommand: vi.fn(),
  deleteAgentProfile: vi.fn(),
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
  validateProjectRepoPath: vi.fn(),
}));

const detectCodexCommandMock = vi.mocked(detectCodexCommand);
const deleteAgentProfileMock = vi.mocked(deleteAgentProfile);
const testAgentCommandMock = vi.mocked(testAgentCommand);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const listAgentSkillsMock = vi.mocked(listAgentSkills);
const saveAgentProfileMock = vi.mocked(saveAgentProfile);
const updateProjectSettingsMock = vi.mocked(updateProjectSettings);
const validateProjectRepoPathMock = vi.mocked(validateProjectRepoPath);
const { open } = await import("@tauri-apps/plugin-dialog");
const openDialogMock = vi.mocked(open);
const onProjectUpdated = vi.fn();
const confirmSpy = vi.spyOn(window, "confirm");

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
  del: 0,
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
  del: 0,
};

const legacyPromptProfile: AgentProfileRecord = {
  ...globalProfile,
  id: 3,
  name: "Legacy Prompt Codex",
  promptTemplate: "Keep this legacy prompt",
};

describe("ProjectSettingsActivity", () => {
  beforeEach(() => {
    detectCodexCommandMock.mockReset();
    deleteAgentProfileMock.mockReset();
    testAgentCommandMock.mockReset();
    listAgentProfilesMock.mockReset();
    listAgentSkillsMock.mockReset();
    saveAgentProfileMock.mockReset();
    updateProjectSettingsMock.mockReset();
    validateProjectRepoPathMock.mockReset();
    openDialogMock.mockReset();
    settingsEventMocks.listeners.length = 0;
    settingsEventMocks.unlisten.mockReset();
    onProjectUpdated.mockReset();
    detectCodexCommandMock.mockResolvedValue({
      command: "/usr/local/bin/codex",
    });
    deleteAgentProfileMock.mockResolvedValue(undefined);
    confirmSpy.mockReset();
    confirmSpy.mockReturnValue(true);
    updateProjectSettingsMock.mockResolvedValue({
      id: 1,
      name: "RedWhisk",
      repoPath: "/tmp/redwhisk",
      completionPolicy: "agent_auto_commit",
      createdAt: 1_780_624_800_000,
      lastOpenedAt: 1_780_628_400_000,
    });
    validateProjectRepoPathMock.mockImplementation(async ({ repoPath }) => ({
      repoPath,
      suggestedName: repoPath.split("/").pop() ?? "repo",
    }));
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

  it("renders two-column layout with general menu active by default", async () => {
    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
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
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Terminals" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByLabelText("Project Name")).toHaveValue("RedWhisk");
  });

  it("exposes and updates the settings menu splitter width", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    const splitter = screen.getByRole("separator", {
      name: "Resize settings menu",
    });
    expect(splitter).toHaveAttribute("aria-orientation", "vertical");
    expect(splitter).toHaveAttribute("aria-valuemin", "180");
    expect(splitter).toHaveAttribute("aria-valuemax", "420");
    expect(splitter).toHaveAttribute("aria-valuenow", "230");

    splitter.focus();
    await user.keyboard("{ArrowRight}");
    expect(splitter).toHaveAttribute("aria-valuenow", "246");
    await user.keyboard("{ArrowLeft}");
    expect(splitter).toHaveAttribute("aria-valuenow", "230");
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
        projectPath="/tmp/redwhisk"
      />,
    );

    const splitter = screen.getByRole("separator", {
      name: "Resize settings menu",
    });

    await userEvent.pointer([
      { keys: "[MouseRight>]", target: splitter, coords: { clientX: 200 } },
      { keys: "[/MouseRight]" },
    ]);
    expect(splitter).toHaveAttribute("aria-valuenow", "230");
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
        projectPath="/tmp/redwhisk"
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
    expect(screen.getByLabelText("Repository path")).toHaveValue(
      "/tmp/redwhisk",
    );
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

  it("shows agents in a table below the header action", async () => {
    const user = userEvent.setup();
    const longWorkflowSkill =
      "codex-global-skill-with-a-very-long-unbroken-name";
    const projectProfileWithHigherId = { ...projectProfile, id: 20 };
    const globalProfileWithLowerId = {
      ...globalProfile,
      id: 10,
      defaultSkill: longWorkflowSkill,
    };
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return { profiles: [projectProfileWithHigherId] };
      }

      return { profiles: [globalProfileWithLowerId] };
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    expect(
      await screen.findByRole("heading", { name: "Agents" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New agent" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Agent profiles" }),
    ).not.toBeInTheDocument();

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
      screen.getByRole("columnheader", { name: "Actions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Project Codex" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Global Codex" }),
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
    expect(within(table).getByRole("cell", { name: "—" })).toHaveClass(
      "settings-agent-table__skill",
    );
    expect(
      within(table).getByRole("cell", { name: longWorkflowSkill }),
    ).toHaveClass("settings-agent-table__skill");
    expect(screen.getAllByAltText("Agent 类型：Codex")).toHaveLength(2);

    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      within(rows[0]).getByRole("button", { name: "Edit Global Codex" }),
    ).toBeInTheDocument();
    expect(
      within(rows[0]).getByRole("button", { name: "Delete Global Codex" }),
    ).toBeInTheDocument();
    expect(
      within(rows[0]).getAllByRole("button", { name: "Delete Global Codex" }),
    ).toHaveLength(1);
    expect(
      within(rows[1]).getByRole("button", { name: "Edit Project Codex" }),
    ).toBeInTheDocument();
  });

  it("confirms before deleting an agent profile from the table", async () => {
    const user = userEvent.setup();
    confirmSpy.mockReturnValue(false);

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(
      await screen.findByRole("button", { name: "Delete Project Codex" }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      'Are you sure you want to delete Agent Profile "Project Codex"?',
    );
    expect(deleteAgentProfileMock).not.toHaveBeenCalled();
    expect(screen.getByText("Project Codex")).toBeInTheDocument();
  });

  it("soft deletes an agent profile after confirmation", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(
      await screen.findByRole("button", { name: "Delete Project Codex" }),
    );

    await waitFor(() =>
      expect(deleteAgentProfileMock).toHaveBeenCalledWith({ id: 1 }),
    );
    expect(screen.queryByText("Project Codex")).not.toBeInTheDocument();
    expect(screen.getByText("Global Codex")).toBeInTheDocument();
  });

  it("opens the edit form from table row action buttons with click and keyboard shortcuts", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    const projectButton = await screen.findByRole("button", {
      name: "Edit Project Codex",
    });
    await user.click(projectButton);

    expect(
      screen.getByRole("heading", { name: "Edit Agent" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    projectButton.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("heading", { name: "Edit Agent" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    const globalButton = screen.getByRole("button", {
      name: "Edit Global Codex",
    });
    globalButton.focus();
    await user.keyboard(" ");

    expect(
      screen.getByRole("heading", { name: "Edit Agent" }),
    ).toBeInTheDocument();
  });

  it("shows No agents for empty project and global lists", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    expect(await screen.findAllByText("No agents")).toHaveLength(1);
  });

  it("opens the new agent form with the streamlined creation fields and saves the detected command basename by default", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    saveAgentProfileMock.mockResolvedValue({
      ...globalProfile,
      name: "My Codex",
      command: "codex",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(await screen.findByRole("button", { name: "New agent" }));

    expect(
      screen.getByRole("heading", { name: "New agent" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "New agent" })).toHaveTextContent(
      /Name[\s\S]*Type[\s\S]*Command[\s\S]*Scope[\s\S]*Workflow Skill/,
    );
    expect(screen.getByLabelText("Agent type")).toHaveValue("codex");
    expect(screen.getByRole("option", { name: "Claude Code" })).toHaveValue(
      "claude",
    );
    expect(await screen.findByLabelText("Agent command")).toHaveValue("codex");
    expect(screen.getByRole("combobox", { name: "Scope" })).toHaveValue(
      "Global",
    );
    expect(screen.queryByText(/Detected:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mode")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Prompt template")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Dangerous")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Detect" }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Agent profile name"), "My Codex");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Codex",
          agentType: "codex",
          command: "codex",
          scope: "global",
          projectId: null,
          mode: "default",
          dangerous: true,
          promptTemplate: "",
        }),
      ),
    );
  });

  it("keeps a manually entered command path after testing and saves it unchanged", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    testAgentCommandMock.mockResolvedValue({
      command: "/opt/codex/bin/codex",
    });
    saveAgentProfileMock.mockResolvedValue({
      ...globalProfile,
      name: "Custom Codex",
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

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(await screen.findByRole("button", { name: "New agent" }));
    await user.type(
      screen.getByLabelText("Agent profile name"),
      "Custom Codex",
    );
    await user.clear(await screen.findByLabelText("Agent command"));
    await user.type(
      screen.getByLabelText("Agent command"),
      "/opt/codex/bin/codex",
    );
    await user.click(screen.getByRole("button", { name: "测试" }));

    expect(testAgentCommandMock).toHaveBeenCalledWith({
      command: "/opt/codex/bin/codex",
    });
    expect(
      screen.getByText("Command available: /opt/codex/bin/codex"),
    ).toHaveClass("agent-dialog__toast");
    expect(screen.getByLabelText("Agent command")).toHaveValue(
      "/opt/codex/bin/codex",
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Custom Codex",
          command: "/opt/codex/bin/codex",
        }),
      ),
    );
  });

  it("loads workflow skills from the selected scope and saves project scope with the current project id", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    saveAgentProfileMock.mockResolvedValue({
      ...projectProfile,
      name: "Project Skill Agent",
      defaultSkill: "",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(await screen.findByRole("button", { name: "New agent" }));

    await waitFor(() =>
      expect(listAgentSkillsMock).toHaveBeenCalledWith({
        agentType: "codex",
        projectId: null,
      }),
    );
    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    expect(await screen.findByText("codex-global")).toBeInTheDocument();
    expect(
      screen.getByText("/home/me/.agents/skills/codex-global/SKILL.md"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("/repo/.agents/skills/codex-project/SKILL.md"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Scope" }));
    await user.click(screen.getByRole("option", { name: "Project" }));

    await waitFor(() =>
      expect(listAgentSkillsMock).toHaveBeenCalledWith({
        agentType: "codex",
        projectId: 1,
      }),
    );
    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    expect(await screen.findByText("codex-project")).toBeInTheDocument();
    expect(
      screen.getByText("/repo/.agents/skills/codex-project/SKILL.md"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("/home/me/.agents/skills/codex-global/SKILL.md"),
    ).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Agent profile name"),
      "Project Skill Agent",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "project",
          projectId: 1,
        }),
      ),
    );
  });

  it("reloads skills when switching to Claude without resetting other fields", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
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

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(await screen.findByRole("button", { name: "New agent" }));
    await user.type(
      screen.getByLabelText("Agent profile name"),
      "Claude Agent",
    );
    await user.selectOptions(screen.getByLabelText("Agent type"), "claude");

    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    expect(await screen.findByText("claude-global")).toBeInTheDocument();
    expect(screen.getByLabelText("Agent profile name")).toHaveValue(
      "Claude Agent",
    );
    expect(screen.getByLabelText("Agent command")).toHaveValue("codex");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: "claude",
        }),
      ),
    );
  });

  it("shows workflow skill names and muted paths, then saves the selected skill name", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    saveAgentProfileMock.mockResolvedValue({
      ...globalProfile,
      name: "Skill Agent",
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

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(await screen.findByRole("button", { name: "New agent" }));

    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    expect(await screen.findByText("None")).toBeInTheDocument();
    expect(screen.getByText("codex-global")).toHaveClass(
      "settings-search-select__option-label",
    );
    expect(
      screen.getByText("/home/me/.agents/skills/codex-global/SKILL.md"),
    ).toHaveClass("settings-search-select__option-description");

    await user.click(
      screen.getByRole("option", {
        name: "codex-global /home/me/.agents/skills/codex-global/SKILL.md",
      }),
    );
    await user.type(screen.getByLabelText("Agent profile name"), "Skill Agent");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultSkill: "codex-global",
        }),
      ),
    );
  });

  it("preserves an existing prompt template when editing without showing the field", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") return { profiles: [] };
      return { profiles: [legacyPromptProfile] };
    });
    saveAgentProfileMock.mockResolvedValue({
      ...legacyPromptProfile,
      name: "Legacy Prompt Codex Updated",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(
      await screen.findByRole("button", { name: "Edit Legacy Prompt Codex" }),
    );

    expect(
      screen.getByRole("heading", { name: "Edit Agent" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Prompt template")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Agent profile name"));
    await user.type(
      screen.getByLabelText("Agent profile name"),
      "Legacy Prompt Codex Updated",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: legacyPromptProfile.id,
          promptTemplate: "Keep this legacy prompt",
        }),
      ),
    );
  });

  it("keeps the current project context when editing a global agent and switching scope to project", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") return { profiles: [] };
      return { profiles: [legacyPromptProfile] };
    });
    saveAgentProfileMock.mockResolvedValue({
      ...legacyPromptProfile,
      scope: "project",
      projectId: 1,
      defaultSkill: "codex-project",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(
      await screen.findByRole("button", { name: "Edit Legacy Prompt Codex" }),
    );
    await user.click(screen.getByRole("combobox", { name: "Scope" }));
    await user.click(screen.getByRole("option", { name: "Project" }));

    await waitFor(() =>
      expect(listAgentSkillsMock).toHaveBeenCalledWith({
        agentType: "codex",
        projectId: 1,
      }),
    );
    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    await user.click(
      await screen.findByRole("option", {
        name: "codex-project /repo/.agents/skills/codex-project/SKILL.md",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: legacyPromptProfile.id,
          scope: "project",
          projectId: 1,
          defaultSkill: "codex-project",
          promptTemplate: "Keep this legacy prompt",
        }),
      ),
    );
  });

  it("moves an edited global agent into the project table without leaving a stale global row", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") return { profiles: [] };
      return { profiles: [legacyPromptProfile] };
    });
    saveAgentProfileMock.mockResolvedValue({
      ...legacyPromptProfile,
      scope: "project",
      projectId: 1,
      defaultSkill: "codex-project",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(
      await screen.findByRole("button", { name: "Edit Legacy Prompt Codex" }),
    );
    await user.click(screen.getByRole("combobox", { name: "Scope" }));
    await user.click(screen.getByRole("option", { name: "Project" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit Agent" }),
      ).not.toBeInTheDocument(),
    );

    const table = screen.getByRole("table", { name: "Configured agents" });
    expect(
      within(table).getAllByRole("button", {
        name: "Edit Legacy Prompt Codex",
      }),
    ).toHaveLength(1);
    expect(
      within(table).getByRole("cell", { name: "Project" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("cell", { name: "Global" }),
    ).not.toBeInTheDocument();
  });

  it("tracks workflow skill selection by path when visible skills share the same name", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    listAgentSkillsMock.mockResolvedValue(
      skillResponse([
        {
          name: "shared-skill",
          path: "/home/me/.agents/skills/shared-a/SKILL.md",
          agentType: "codex",
          scope: "global",
          projectId: null,
          sourceRoot: "/home/me/.agents/skills",
        },
        {
          name: "shared-skill",
          path: "/home/me/.agents/skills/shared-b/SKILL.md",
          agentType: "codex",
          scope: "global",
          projectId: null,
          sourceRoot: "/home/me/.agents/skills",
        },
      ]),
    );
    saveAgentProfileMock.mockResolvedValue({
      ...globalProfile,
      name: "Shared Skill Agent",
      defaultSkill: "shared-skill",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(await screen.findByRole("button", { name: "New agent" }));

    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    const firstSkill = await screen.findByRole("option", {
      name: "shared-skill /home/me/.agents/skills/shared-a/SKILL.md",
    });
    const secondSkill = screen.getByRole("option", {
      name: "shared-skill /home/me/.agents/skills/shared-b/SKILL.md",
    });

    await user.click(secondSkill);

    expect(firstSkill).toHaveAttribute("aria-selected", "false");
    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    expect(
      screen.getByRole("option", {
        name: "shared-skill /home/me/.agents/skills/shared-b/SKILL.md",
      }),
    ).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Escape}");
    await user.type(
      screen.getByLabelText("Agent profile name"),
      "Shared Skill Agent",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultSkill: "shared-skill",
        }),
      ),
    );
  });

  it("keeps the latest agent type skills when older requests finish later", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
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

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(await screen.findByRole("button", { name: "New agent" }));
    await waitFor(() => expect(pendingSkills.codex).toBeDefined());
    await user.selectOptions(screen.getByLabelText("Agent type"), "claude");
    await waitFor(() => expect(pendingSkills.claude).toBeDefined());

    await act(async () => {
      pendingSkills.claude?.(
        skillResponse([
          {
            name: "claude-global",
            path: "/home/me/.claude/skills/claude-global/SKILL.md",
            agentType: "claude",
            scope: "global",
            projectId: null,
            sourceRoot: "/home/me/.claude/skills",
          },
        ]),
      );
    });
    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    expect(await screen.findByText("claude-global")).toBeInTheDocument();

    await act(async () => {
      pendingSkills.codex?.(
        skillResponse([
          {
            name: "codex-global",
            path: "/home/me/.agents/skills/codex-global/SKILL.md",
            agentType: "codex",
            scope: "global",
            projectId: null,
            sourceRoot: "/home/me/.agents/skills",
          },
        ]),
      );
    });

    expect(screen.getByLabelText("Agent type")).toHaveValue("claude");
    expect(screen.getByText("claude-global")).toBeInTheDocument();
    expect(screen.queryByText("codex-global")).not.toBeInTheDocument();
  });

  it("refreshes the skill list after agent skill update events without resetting unsaved fields", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    let skillNames = ["codex-global"];
    listAgentSkillsMock.mockImplementation(async ({ agentType, projectId }) =>
      skillResponse(
        skillNames.map((name) => ({
          name,
          path: `/home/me/.agents/skills/${name}/SKILL.md`,
          agentType: agentType ?? "codex",
          scope: "global",
          projectId: projectId ?? null,
          sourceRoot: "/home/me/.agents/skills",
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

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(await screen.findByRole("button", { name: "New agent" }));
    await user.type(screen.getByLabelText("Agent profile name"), "Unsaved");
    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    expect(await screen.findByText("codex-global")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    skillNames = ["codex-global", "codex-refreshed"];
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

    await user.click(screen.getByRole("combobox", { name: "Workflow Skill" }));
    expect(await screen.findByText("codex-refreshed")).toBeInTheDocument();
    expect(screen.getByLabelText("Agent profile name")).toHaveValue("Unsaved");
  });

  it("reloads agents when project id changes", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Agents" }));
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

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(await screen.findByRole("button", { name: "New agent" }));
    expect(
      screen.getByRole("heading", { name: "New agent" }),
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
      screen.queryByRole("heading", { name: "New agent" }),
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
        projectPath="/tmp/redwhisk"
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
        repoPath: "/tmp/redwhisk",
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

  it("updates repository path in general settings after choosing a valid git directory", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/tmp/other-repo");
    updateProjectSettingsMock.mockResolvedValue({
      id: 1,
      name: "RedWhisk",
      repoPath: "/tmp/other-repo",
      completionPolicy: "manual",
      createdAt: 1_780_624_800_000,
      lastOpenedAt: 1_780_628_400_000,
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "General" }));
    await user.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(validateProjectRepoPathMock).toHaveBeenCalledWith({
      repoPath: "/tmp/other-repo",
    });
    expect(await screen.findByLabelText("Repository path")).toHaveValue(
      "/tmp/other-repo",
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateProjectSettingsMock).toHaveBeenCalledWith({
        projectId: 1,
        name: "RedWhisk",
        repoPath: "/tmp/other-repo",
        completionPolicy: "manual",
      }),
    );
  });

  it("shows repository validation errors in general settings and blocks save", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/tmp/plain-dir");
    validateProjectRepoPathMock.mockRejectedValue({
      code: "PROJECT_REPO_NOT_GIT_REPOSITORY",
      message: "所选目录不是 Git Repository。",
    });

    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "General" }));
    await user.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(
      await screen.findByRole("status", { name: "General Settings status" }),
    ).toHaveTextContent("所选目录不是 Git Repository。");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(updateProjectSettingsMock).not.toHaveBeenCalled();
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
