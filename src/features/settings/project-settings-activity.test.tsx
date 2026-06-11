import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSettingsActivity } from "./project-settings-activity";
import {
  detectCodexCommand,
  listAgentProfiles,
  saveAgentProfile,
  testAgentCommand,
  type AgentProfileRecord,
} from "./settings-commands";
import { updateProjectSettings } from "../project/project-commands";

vi.mock("./settings-commands", () => ({
  detectCodexCommand: vi.fn(),
  testAgentCommand: vi.fn(),
  listAgentProfiles: vi.fn(),
  saveAgentProfile: vi.fn(),
}));

vi.mock("../project/project-commands", () => ({
  updateProjectSettings: vi.fn(),
}));

const detectCodexCommandMock = vi.mocked(detectCodexCommand);
const testAgentCommandMock = vi.mocked(testAgentCommand);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
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
    saveAgentProfileMock.mockReset();
    updateProjectSettingsMock.mockReset();
    onProjectUpdated.mockReset();
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
      screen.getByRole("region", { name: "Project Agents" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Global Agents" }),
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
      screen.getByRole("region", { name: "Project Agents" }),
    ).toBeInTheDocument();
  });

  it("shows project and global agents in separate sections", async () => {
    render(
      <ProjectSettingsActivity
        completionPolicy="manual"
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    expect(await screen.findByText("Project Codex")).toBeInTheDocument();
    expect(screen.getByText("Global Codex")).toBeInTheDocument();
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

    expect(await screen.findAllByText("No agents")).toHaveLength(2);
  });

  it("opens the add form for project scope when clicking the project add button", async () => {
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

    await user.click(
      await screen.findByRole("button", { name: "Add project agent" }),
    );

    expect(
      screen.getByRole("heading", { name: "Add Project Agent" }),
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

    await user.click(
      await screen.findByRole("button", { name: "Add global agent" }),
    );
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
          projectId: null,
        }),
      ),
    );
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
    await screen.findAllByText("No agents");
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

    await user.click(
      await screen.findByRole("button", { name: "Add project agent" }),
    );
    expect(
      screen.getByRole("heading", { name: "Add Project Agent" }),
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
      screen.queryByRole("heading", { name: "Add Project Agent" }),
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
