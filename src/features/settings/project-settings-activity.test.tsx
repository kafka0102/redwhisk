import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSettingsActivity } from "./project-settings-activity";
import {
  detectCodexCommand,
  listAgentProfiles,
  listProjectAgentOverrides,
  saveAgentProfile,
  saveProjectAgentOverride,
  testAgentCommand,
  type AgentProfileRecord,
  type ProjectAgentOverrideRecord,
} from "./settings-commands";

vi.mock("./settings-commands", () => ({
  detectCodexCommand: vi.fn(),
  testAgentCommand: vi.fn(),
  listAgentProfiles: vi.fn(),
  saveAgentProfile: vi.fn(),
  listProjectAgentOverrides: vi.fn(),
  saveProjectAgentOverride: vi.fn(),
}));

const detectCodexCommandMock = vi.mocked(detectCodexCommand);
const testAgentCommandMock = vi.mocked(testAgentCommand);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const saveAgentProfileMock = vi.mocked(saveAgentProfile);
const listProjectAgentOverridesMock = vi.mocked(listProjectAgentOverrides);
const saveProjectAgentOverrideMock = vi.mocked(saveProjectAgentOverride);

const profile: AgentProfileRecord = {
  id: 1,
  name: "Codex",
  agentType: "codex",
  command: "/usr/local/bin/codex",
  defaultArgs: ["exec"],
  defaultSkill: "global-skill",
  promptTemplate: "Global prompt",
  enabled: true,
};

const override: ProjectAgentOverrideRecord = {
  id: 10,
  projectId: 1,
  agentProfileId: 1,
  defaultArgs: ["exec", "--sandbox"],
  defaultSkill: "project-skill",
  promptTemplate: "Project prompt",
  enabled: true,
};

describe("ProjectSettingsActivity", () => {
  beforeEach(() => {
    detectCodexCommandMock.mockReset();
    testAgentCommandMock.mockReset();
    listAgentProfilesMock.mockReset();
    saveAgentProfileMock.mockReset();
    listProjectAgentOverridesMock.mockReset();
    saveProjectAgentOverrideMock.mockReset();
    listAgentProfilesMock.mockResolvedValue({ profiles: [profile] });
    listProjectAgentOverridesMock.mockResolvedValue({ overrides: [override] });
  });

  it("renders current project overrides separately from global settings", async () => {
    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Current project:")).toBeInTheDocument();
    expect(screen.getAllByText("RedWhisk")).toHaveLength(2);
    expect(
      await screen.findByDisplayValue("project-skill"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Global Settings" }),
    ).not.toBeInTheDocument();
  });

  it("opens global settings and shows codex detection failure while save stays disabled without a command", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    listProjectAgentOverridesMock.mockResolvedValue({ overrides: [] });
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });

    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

    await user.click(
      await screen.findByRole("button", { name: "Open Global Settings" }),
    );
    await user.click(screen.getByRole("button", { name: "New Codex Profile" }));

    expect(
      await screen.findByRole("status", { name: "Global profile status" }),
    ).toHaveTextContent("Agent command 不可用。");
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
  });

  it("saves a global agent profile after manual command test succeeds", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });
    listProjectAgentOverridesMock.mockResolvedValue({ overrides: [] });
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });
    testAgentCommandMock.mockResolvedValue({
      command: "/opt/codex/bin/codex",
    });
    saveAgentProfileMock.mockResolvedValue({
      ...profile,
      command: "/opt/codex/bin/codex",
    });

    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

    await user.click(
      await screen.findByRole("button", { name: "Open Global Settings" }),
    );
    await user.click(screen.getByRole("button", { name: "New Codex Profile" }));
    await user.clear(screen.getByLabelText("Agent command"));
    await user.type(
      screen.getByLabelText("Agent command"),
      "/opt/codex/bin/codex",
    );
    await user.click(screen.getByRole("button", { name: "Test command" }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "/opt/codex/bin/codex",
          name: "Codex",
        }),
      ),
    );
    expect(screen.getAllByText("/opt/codex/bin/codex")).toHaveLength(2);
  });

  it("keeps overrides scoped to the current project when project id changes", async () => {
    listProjectAgentOverridesMock
      .mockResolvedValueOnce({ overrides: [override] })
      .mockResolvedValueOnce({ overrides: [] });

    const { rerender } = render(
      <ProjectSettingsActivity projectId={1} projectName="RedWhisk" />,
    );

    expect(
      await screen.findByDisplayValue("Project prompt"),
    ).toBeInTheDocument();

    rerender(
      <ProjectSettingsActivity projectId={2} projectName="Agents Lab" />,
    );

    expect(
      await screen.findByDisplayValue("Global prompt"),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Project prompt"),
    ).not.toBeInTheDocument();
  });

  it("saves project overrides for the current project only", async () => {
    const user = userEvent.setup();
    saveProjectAgentOverrideMock.mockResolvedValue({
      ...override,
      promptTemplate: "Updated project prompt",
    });

    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

    const promptField = await screen.findByLabelText(
      "Prompt template for Codex",
    );
    await user.clear(promptField);
    await user.type(promptField, "Updated project prompt");
    await waitFor(() =>
      expect(screen.getByLabelText("Prompt template for Codex")).toHaveValue(
        "Updated project prompt",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Save override" }));

    await waitFor(() =>
      expect(saveProjectAgentOverrideMock).toHaveBeenCalledWith({
        projectId: 1,
        agentProfileId: 1,
        defaultArgs: ["exec", "--sandbox"],
        defaultSkill: "project-skill",
        promptTemplate: "Updated project prompt",
        enabled: true,
      }),
    );
  });

  it("refreshes inherited project values after editing the global profile", async () => {
    const user = userEvent.setup();
    listProjectAgentOverridesMock.mockResolvedValue({ overrides: [] });
    detectCodexCommandMock.mockResolvedValue({
      command: "/usr/local/bin/codex",
    });
    saveAgentProfileMock.mockResolvedValue({
      ...profile,
      defaultSkill: "updated-global-skill",
      promptTemplate: "Updated global prompt",
    });

    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

    expect(await screen.findByDisplayValue("global-skill")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open Global Settings" }),
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const globalSettingsDialog = screen.getByRole("dialog", {
      name: "Global Settings",
    });
    const defaultSkillInput =
      within(globalSettingsDialog).getByLabelText("Default skill");
    await user.clear(defaultSkillInput);
    await user.type(defaultSkillInput, "updated-global-skill");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Default skill for Codex")).toHaveValue(
        "updated-global-skill",
      ),
    );
  });
});
