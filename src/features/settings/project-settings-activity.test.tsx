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

vi.mock("./settings-commands", () => ({
  detectCodexCommand: vi.fn(),
  testAgentCommand: vi.fn(),
  listAgentProfiles: vi.fn(),
  saveAgentProfile: vi.fn(),
}));

const detectCodexCommandMock = vi.mocked(detectCodexCommand);
const testAgentCommandMock = vi.mocked(testAgentCommand);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const saveAgentProfileMock = vi.mocked(saveAgentProfile);

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
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") return { profiles: [projectProfile] };
      return { profiles: [globalProfile] };
    });
  });

  it("renders two-column layout with agents menu active by default", async () => {
    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

    expect(
      await screen.findByRole("navigation", { name: "Settings menu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "基本信息" }),
    ).toBeInTheDocument();
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
    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

    expect(await screen.findByText("Project Codex")).toBeInTheDocument();
    expect(screen.getByText("Global Codex")).toBeInTheDocument();
  });

  it("shows No agents for empty project and global lists", async () => {
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });

    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

    expect(await screen.findAllByText("No agents")).toHaveLength(2);
  });

  it("opens the add form for project scope when clicking the project add button", async () => {
    const user = userEvent.setup();
    detectCodexCommandMock.mockRejectedValue({
      code: "AGENT_COMMAND_UNAVAILABLE",
      message: "Agent command 不可用。",
    });

    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

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

    render(<ProjectSettingsActivity projectId={1} projectName="RedWhisk" />);

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
      <ProjectSettingsActivity projectId={1} projectName="RedWhisk" />,
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
      <ProjectSettingsActivity projectId={2} projectName="Agents Lab" />,
    );

    await waitFor(() =>
      expect(listAgentProfilesMock).toHaveBeenCalledWith({
        scope: "project",
        projectId: 2,
      }),
    );
  });
});
