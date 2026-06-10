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
import { updateProjectCompletionPolicy } from "../project/project-commands";

vi.mock("./settings-commands", () => ({
  detectCodexCommand: vi.fn(),
  testAgentCommand: vi.fn(),
  listAgentProfiles: vi.fn(),
  saveAgentProfile: vi.fn(),
}));

vi.mock("../project/project-commands", () => ({
  updateProjectCompletionPolicy: vi.fn(),
}));

const detectCodexCommandMock = vi.mocked(detectCodexCommand);
const testAgentCommandMock = vi.mocked(testAgentCommand);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const saveAgentProfileMock = vi.mocked(saveAgentProfile);
const updateProjectCompletionPolicyMock = vi.mocked(
  updateProjectCompletionPolicy,
);
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
    updateProjectCompletionPolicyMock.mockReset();
    onProjectUpdated.mockReset();
    updateProjectCompletionPolicyMock.mockResolvedValue({
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
    expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("region", { name: "Project Agents" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Global Agents" }),
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

    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") return { profiles: [] };
      return { profiles: [globalProfile] };
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
  });

  it("updates project completion policy from the general settings section", async () => {
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
    await user.selectOptions(
      await screen.findByLabelText("Completion Policy"),
      "agent_auto_commit",
    );

    await waitFor(() =>
      expect(updateProjectCompletionPolicyMock).toHaveBeenCalledWith({
        projectId: 1,
        completionPolicy: "agent_auto_commit",
      }),
    );
    expect(onProjectUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        completionPolicy: "agent_auto_commit",
      }),
    );
  });
});
