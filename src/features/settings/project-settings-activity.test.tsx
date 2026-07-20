import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSettingsActivity } from "./project-settings-activity";
import {
  deleteAgentProfile,
  deleteProjectLabel,
  detectCodexCommand,
  listAgentProfiles,
  listAgentSkills,
  listProjectLabels,
  listSavedAgentSkills,
  saveAgentProfile,
  saveProjectLabel,
  testAgentCommand,
  type AgentSkillListResponse,
  type AgentProfileRecord,
  type ProjectLabelRecord,
} from "./settings-commands";
import {
  updateProjectSettings,
  validateProjectRepoPath,
} from "../project/project-commands";
import {
  openShadcnSelect,
  selectShadcnOption,
} from "../../test/select-helpers";
import { toast } from "../../shared/toast";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("./settings-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settings-commands")>();
  return {
    ...actual,
    detectCodexCommand: vi.fn(),
    deleteAgentProfile: vi.fn(),
    deleteProjectLabel: vi.fn(),
    testAgentCommand: vi.fn(),
    listAgentProfiles: vi.fn(),
    listAgentSkills: vi.fn(),
    listProjectLabels: vi.fn(),
    listSavedAgentSkills: vi.fn(),
    saveAgentProfile: vi.fn(),
    saveProjectLabel: vi.fn(),
  };
});

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

vi.mock("../../shared/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const detectCodexCommandMock = vi.mocked(detectCodexCommand);
const deleteAgentProfileMock = vi.mocked(deleteAgentProfile);
const deleteProjectLabelMock = vi.mocked(deleteProjectLabel);
const testAgentCommandMock = vi.mocked(testAgentCommand);
const listAgentProfilesMock = vi.mocked(listAgentProfiles);
const listAgentSkillsMock = vi.mocked(listAgentSkills);
const listSavedAgentSkillsMock = vi.mocked(listSavedAgentSkills);
const listProjectLabelsMock = vi.mocked(listProjectLabels);
const saveAgentProfileMock = vi.mocked(saveAgentProfile);
const saveProjectLabelMock = vi.mocked(saveProjectLabel);
const updateProjectSettingsMock = vi.mocked(updateProjectSettings);
const validateProjectRepoPathMock = vi.mocked(validateProjectRepoPath);
const toastSuccessMock = vi.mocked(toast.success);
const toastErrorMock = vi.mocked(toast.error);
const { open } = await import("@tauri-apps/plugin-dialog");
const openDialogMock = vi.mocked(open);
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
  del: 0,
  displayMode: "json",
  enabled: true,
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
  displayMode: "json",
  enabled: true,
};

const legacyPromptProfile: AgentProfileRecord = {
  ...globalProfile,
  id: 3,
  name: "Legacy Prompt Codex",
  promptTemplate: "Keep this legacy prompt",
};

const projectLabel: ProjectLabelRecord = {
  id: 11,
  name: "Urgent",
  scope: "project",
  projectId: 1,
  color: "#E11D48",
  workflowSkill: "codex-project",
  del: 0,
};

const globalLabel: ProjectLabelRecord = {
  id: 12,
  name: "Shared",
  scope: "global",
  projectId: null,
  color: "#3B82F6",
  workflowSkill: null,
  del: 0,
};

describe("ProjectSettingsActivity", () => {
  beforeEach(() => {
    vi.useRealTimers();
    detectCodexCommandMock.mockReset();
    deleteAgentProfileMock.mockReset();
    deleteProjectLabelMock.mockReset();
    testAgentCommandMock.mockReset();
    listAgentProfilesMock.mockReset();
    listAgentSkillsMock.mockReset();
    listSavedAgentSkillsMock.mockReset();
    listProjectLabelsMock.mockReset();
    saveAgentProfileMock.mockReset();
    saveProjectLabelMock.mockReset();
    updateProjectSettingsMock.mockReset();
    validateProjectRepoPathMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    openDialogMock.mockReset();
    settingsEventMocks.listeners.length = 0;
    settingsEventMocks.unlisten.mockReset();
    onProjectUpdated.mockReset();
    detectCodexCommandMock.mockResolvedValue({
      command: "/usr/local/bin/codex",
    });
    testAgentCommandMock.mockResolvedValue({
      command: "/usr/local/bin/codex",
    });
    deleteAgentProfileMock.mockResolvedValue(undefined);
    deleteProjectLabelMock.mockResolvedValue(undefined);
    updateProjectSettingsMock.mockResolvedValue({
      id: 1,
      name: "RedWhisk",
      repoPath: "/tmp/redwhisk",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
      createdAt: 1_780_624_800_000,
      lastOpenedAt: 1_780_628_400_000,
      codeWorkspaces: [],
    });
    validateProjectRepoPathMock.mockImplementation(async ({ repoPath }) => ({
      repoPath,
      suggestedName: repoPath.split("/").pop() ?? "repo",
    }));
    listAgentProfilesMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") return { profiles: [projectProfile] };
      return { profiles: [globalProfile] };
    });
    listProjectLabelsMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") return { labels: [projectLabel] };
      return { labels: [globalLabel] };
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
    listSavedAgentSkillsMock.mockImplementation(async ({ scope }) => ({
      skills:
        scope === "project"
          ? []
          : [
              {
                id: 1,
                name: "codex-global",
                scope: "global",
                projectId: null,
                skillPaths: [
                  {
                    agentType: "codex",
                    path: "/home/me/.agents/skills/codex-global/SKILL.md",
                  },
                ],
              },
            ],
    }));
  });

  it("renders two-column layout with general menu active by default", async () => {
    render(
      <ProjectSettingsActivity
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
    expect(screen.getByTestId("settings-menu-icon-labels")).toHaveAttribute(
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
    expect(screen.getByRole("button", { name: "Labels" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Settings menu" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["General", "Agents", "Skills", "Labels"]);
    expect(
      screen.getByRole("heading", { name: "General" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Project Name")).toHaveValue("RedWhisk");
  });

  it("exposes and updates the settings menu splitter width", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
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

    await user.click(screen.getByRole("button", { name: "Labels" }));
    expect(screen.getByRole("heading", { name: "Labels" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Labels" })).toBeInTheDocument();
  });

  it("renders labels page with table columns and values", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Labels" }));

    expect(
      screen.getByRole("button", { name: "New label" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Name" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Scope" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Color" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Workflow Skills" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Urgent" })).toBeInTheDocument();
    expect(screen.getByText("#E11D48")).toBeInTheDocument();
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("opens the new label form with workflow skill options sourced from saved skills", async () => {
    const user = userEvent.setup();
    saveProjectLabelMock.mockResolvedValue(projectLabel);
    listSavedAgentSkillsMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") return { skills: [] };

      return {
        skills: [
          {
            id: 1,
            name: "label-skill-a",
            scope: "global",
            projectId: null,
            skillPaths: [
              {
                agentType: "codex",
                path: "/home/me/.agents/skills/label-skill-a/SKILL.md",
              },
            ],
          },
          {
            id: 2,
            name: "label-skill-b",
            scope: "global",
            projectId: null,
            skillPaths: [
              {
                agentType: "codex",
                path: "/home/me/.agents/skills/label-skill-b/SKILL.md",
              },
            ],
          },
        ],
      };
    });

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Labels" }));
    await user.click(screen.getByRole("button", { name: "New label" }));

    expect(
      screen.getByRole("dialog", { name: "New label" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute(
      "autocapitalize",
      "none",
    );
    expect(screen.getByLabelText("Scope")).toHaveTextContent("Global");
    expect(screen.getByLabelText("Color")).toHaveValue("#e11d48");
    expect(screen.queryByLabelText("Agent")).not.toBeInTheDocument();

    const workflowSkill = await screen.findByLabelText("Workflow Skill");
    expect(workflowSkill).toBeInTheDocument();
    await openShadcnSelect(user, screen, "Workflow Skill");
    expect(
      await screen.findByRole("option", { name: "label-skill-a" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "label-skill-b" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "codex-project" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Manage skills" }),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="select-separator"]'),
    ).not.toBeNull();
  });

  it("navigates to skills settings from the label workflow skill menu", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Labels" }));
    await user.click(screen.getByRole("button", { name: "New label" }));
    await openShadcnSelect(user, screen, "Workflow Skill");
    await user.click(
      await screen.findByRole("option", { name: "Manage skills" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "New label" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skills" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens edit label dialog when clicking a label name and deletes labels", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Labels" }));
    await user.click(screen.getByRole("button", { name: "Urgent" }));
    expect(
      screen.getByRole("dialog", { name: "Edit label" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Delete Urgent" }));
    expect(
      screen.getByRole("dialog", {
        name: 'Are you sure you want to delete Agent Profile "Urgent"?',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(deleteProjectLabelMock).toHaveBeenCalledWith({ id: 11 }),
    );
    expect(screen.queryByText("Urgent")).not.toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith("Deleted successfully");
  });

  it("opens the edit label dialog from the action column edit button", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Labels" }));
    await user.click(
      await screen.findByRole("button", { name: "Edit Urgent" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Edit label" }),
    ).toBeInTheDocument();
  });

  it("sorts labels project-first by recency and dims global labels shadowed by project labels", async () => {
    const user = userEvent.setup();
    listProjectLabelsMock.mockImplementation(async ({ scope }) => {
      if (scope === "project") {
        return {
          labels: [
            {
              id: 20,
              name: "bug",
              scope: "project",
              projectId: 1,
              color: "#E11D48",
              workflowSkill: null,
              del: 0,
            },
            {
              id: 11,
              name: "Urgent",
              scope: "project",
              projectId: 1,
              color: "#E11D48",
              workflowSkill: null,
              del: 0,
            },
          ],
        };
      }

      return {
        labels: [
          {
            id: 12,
            name: "bug",
            scope: "global",
            projectId: null,
            color: "#3B82F6",
            workflowSkill: null,
            del: 0,
          },
          {
            id: 13,
            name: "Shared",
            scope: "global",
            projectId: null,
            color: "#3B82F6",
            workflowSkill: null,
            del: 0,
          },
        ],
      };
    });

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Labels" }));

    const rows = (await screen.findAllByRole("row")).slice(1);
    const rowInfo = rows.map((row) => {
      const cells = row.querySelectorAll("td");
      return {
        element: row,
        name: cells[0]?.textContent?.trim() ?? "",
        scope: cells[1]?.textContent?.trim() ?? "",
      };
    });

    // 项目级在前（id 降序），全局级在后（id 降序）；全局同名 bug 被排到末尾。
    expect(rowInfo.map((row) => row.name)).toEqual([
      "bug",
      "Urgent",
      "Shared",
      "bug",
    ]);

    const globalBug = rowInfo.find(
      (row) => row.name === "bug" && row.scope === "Global",
    );
    expect(globalBug).toBeTruthy();
    expect(globalBug?.element).toHaveClass("bg-muted/50");

    const sharedGlobal = rowInfo.find(
      (row) => row.name === "Shared" && row.scope === "Global",
    );
    expect(sharedGlobal).toBeTruthy();
    expect(sharedGlobal?.element).not.toHaveClass("bg-muted/50");

    const globalBugButton = globalBug?.element.querySelector("button");
    expect(globalBugButton).not.toBeNull();
    await user.hover(globalBugButton ?? document.body);
    expect(
      await screen.findByText(/overridden by a project-level label/i),
    ).toBeInTheDocument();
  });

  it("opens the edit skill dialog from the action column edit button", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Skills" }));
    await user.click(
      await screen.findByRole("button", { name: "Edit codex-global" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Edit skill" }),
    ).toBeInTheDocument();
  });

  it("opens the edit skill dialog when clicking the skill name in the first column", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Skills" }));
    await user.click(
      await screen.findByRole("button", { name: "codex-global" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Edit skill" }),
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
    expect(screen.getAllByAltText("Agent type: Codex")).toHaveLength(2);

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

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(
      await screen.findByRole("button", { name: "Delete Project Codex" }),
    );

    expect(
      screen.getByRole("dialog", {
        name: 'Are you sure you want to delete Agent Profile "Project Codex"?',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: 'Are you sure you want to delete Agent Profile "Project Codex"?',
        }),
      ).not.toBeInTheDocument(),
    );
    expect(deleteAgentProfileMock).not.toHaveBeenCalled();
    expect(screen.getByText("Project Codex")).toBeInTheDocument();
  });

  it("soft deletes an agent profile after confirmation", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(
      await screen.findByRole("button", { name: "Delete Project Codex" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(deleteAgentProfileMock).toHaveBeenCalledWith({ id: 1 }),
    );
    expect(screen.queryByText("Project Codex")).not.toBeInTheDocument();
    expect(screen.getByText("Global Codex")).toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith("Deleted successfully");
  });

  it("opens the edit form from table row action buttons with click and keyboard shortcuts", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
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

  it("opens the edit form when clicking the agent name in the first column", async () => {
    const user = userEvent.setup();

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Agents" }));
    await user.click(
      await screen.findByRole("button", { name: "Project Codex" }),
    );

    expect(
      screen.getByRole("heading", { name: "Edit Agent" }),
    ).toBeInTheDocument();
  });

  it("shows No agents for empty project and global lists", async () => {
    const user = userEvent.setup();
    listAgentProfilesMock.mockResolvedValue({ profiles: [] });

    render(
      <ProjectSettingsActivity
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
      /Name[\s\S]*Type[\s\S]*Command[\s\S]*Scope/,
    );
    expect(screen.getByLabelText("Agent type")).toHaveTextContent("Codex");
    expect(await screen.findByLabelText("Agent command")).toHaveValue("codex");
    expect(screen.getByRole("combobox", { name: "Scope" })).toHaveValue(
      "Global",
    );
    expect(screen.queryByLabelText("Worktree path")).not.toBeInTheDocument();
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
          mode: "full-access",
          dangerous: true,
          promptTemplate: "",
        }),
      ),
    );
  });

  it("saves project worktree location in general settings", async () => {
    const user = userEvent.setup();
    updateProjectSettingsMock.mockResolvedValue({
      id: 1,
      name: "RedWhisk",
      repoPath: "/tmp/redwhisk",
      worktreeLocation: "repo_internal",
      worktreeSetupCommand: "",
      createdAt: 1,
      lastOpenedAt: 2,
      codeWorkspaces: [],
    });

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
        worktreeLocation="repo_sibling"
        worktreeSetupCommand=""
      />,
    );

    await selectShadcnOption(
      user,
      screen,
      "Worktree path",
      "/tmp/redwhisk/.worktrees",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateProjectSettingsMock).toHaveBeenCalledWith({
        projectId: 1,
        name: "RedWhisk",
        repoPath: "/tmp/redwhisk",
        worktreeLocation: "repo_internal",
        worktreeSetupCommand: "",
      }),
    );
  });

  it("keeps project worktree path options synchronized with the repository path", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/tmp/redwhisk");

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk-old"
        worktreeLocation="repo_sibling"
        worktreeSetupCommand=""
      />,
    );

    await user.click(screen.getByRole("button", { name: "Choose folder" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Worktree path")).toHaveTextContent(
        "/tmp/redwhisk.worktrees",
      ),
    );
  });

  it("uses a detected worktree setup command as the textarea value", () => {
    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="Go Service"
        projectPath="/tmp/go-service"
        worktreeLocation="repo_sibling"
        worktreeSetupCommand=""
      />,
    );

    expect(screen.getByLabelText("Worktree setup after creation")).toHaveValue(
      "go mod download",
    );
  });

  it("prompts for setup command input when no command is detected", () => {
    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="Plain"
        projectPath="/tmp/plain"
        worktreeLocation="repo_sibling"
        worktreeSetupCommand=""
      />,
    );

    expect(screen.getByLabelText("Worktree setup after creation")).toHaveValue(
      "",
    );
    expect(
      screen.getByLabelText("Worktree setup after creation"),
    ).toHaveAttribute(
      "placeholder",
      "Enter initialization steps to run after creating the worktree",
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
    await user.click(screen.getByRole("button", { name: "Test" }));

    expect(testAgentCommandMock).toHaveBeenCalledWith({
      command: "/opt/codex/bin/codex",
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Command available: codex");
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
      expect(saveAgentProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: legacyPromptProfile.id,
          scope: "project",
          projectId: 1,
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
        onProjectUpdated={onProjectUpdated}
        projectId={2}
        projectName="Agents Lab"
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "New agent" }),
    ).not.toBeInTheDocument();
  });

  it("saves project name from the general settings section", async () => {
    const user = userEvent.setup();
    updateProjectSettingsMock.mockResolvedValue({
      id: 1,
      name: "RedWhisk Desktop",
      repoPath: "/tmp/redwhisk",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
      createdAt: 1_780_624_800_000,
      lastOpenedAt: 1_780_628_400_000,
      codeWorkspaces: [],
    });

    render(
      <ProjectSettingsActivity
        onProjectUpdated={onProjectUpdated}
        projectId={1}
        projectName="RedWhisk"
        projectPath="/tmp/redwhisk"
      />,
    );

    await user.click(screen.getByRole("button", { name: "General" }));
    await user.clear(await screen.findByLabelText("Project Name"));
    await user.type(screen.getByLabelText("Project Name"), "RedWhisk Desktop");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateProjectSettingsMock).toHaveBeenCalledWith({
        projectId: 1,
        name: "RedWhisk Desktop",
        repoPath: "/tmp/redwhisk",
        worktreeLocation: "repo_sibling",
        worktreeSetupCommand: "",
      }),
    );
    expect(onProjectUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        name: "RedWhisk Desktop",
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
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
      createdAt: 1_780_624_800_000,
      lastOpenedAt: 1_780_628_400_000,
      codeWorkspaces: [],
    });

    render(
      <ProjectSettingsActivity
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
        worktreeLocation: "repo_sibling",
        worktreeSetupCommand: "",
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
    ).toHaveTextContent("The selected directory is not a Git repository.");
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
