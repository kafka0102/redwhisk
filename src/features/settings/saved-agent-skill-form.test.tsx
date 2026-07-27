import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SavedAgentSkillForm } from "./saved-agent-skill-form";
import {
  listAgentSkills,
  saveSavedAgentSkill,
  type AgentSkillListResponse,
  type SavedAgentSkillRecord,
} from "./settings-commands";

vi.mock("./settings-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settings-commands")>();
  return {
    ...actual,
    listAgentSkills: vi.fn(),
    saveSavedAgentSkill: vi.fn(),
  };
});

const listAgentSkillsMock = vi.mocked(listAgentSkills);
const saveSavedAgentSkillMock = vi.mocked(saveSavedAgentSkill);

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

const scannedSkills = [
  {
    name: "demo-skill",
    path: "/home/me/.agents/skills/demo-skill/SKILL.md",
    agentType: "codex" as const,
    scope: "global" as const,
    projectId: null,
    sourceRoot: "/home/me/.agents/skills",
  },
  {
    name: "demo-skill",
    path: "/home/me/.codex/skills/demo-skill/SKILL.md",
    agentType: "codex" as const,
    scope: "global" as const,
    projectId: null,
    sourceRoot: "/home/me/.codex/skills",
  },
  {
    name: "demo-skill",
    path: "/home/me/.agents/skills/demo-skill/SKILL.md",
    agentType: "opencode" as const,
    scope: "global" as const,
    projectId: null,
    sourceRoot: "/home/me/.agents/skills",
  },
  {
    name: "demo-skill",
    path: "/home/me/.config/opencode/skills/demo-skill/SKILL.md",
    agentType: "opencode" as const,
    scope: "global" as const,
    projectId: null,
    sourceRoot: "/home/me/.config/opencode/skills",
  },
  {
    name: "demo-skill",
    path: "/home/me/.claude/skills/demo-skill/SKILL.md",
    agentType: "claude" as const,
    scope: "global" as const,
    projectId: null,
    sourceRoot: "/home/me/.claude/skills",
  },
  {
    name: "demo-skill",
    path: "/home/me/.agents/skills/demo-skill/SKILL.md",
    agentType: "grok" as const,
    scope: "global" as const,
    projectId: null,
    sourceRoot: "/home/me/.agents/skills",
  },
  {
    name: "demo-skill",
    path: "/home/me/.grok/skills/demo-skill/SKILL.md",
    agentType: "grok" as const,
    scope: "global" as const,
    projectId: null,
    sourceRoot: "/home/me/.grok/skills",
  },
];

describe("SavedAgentSkillForm", () => {
  beforeEach(() => {
    listAgentSkillsMock.mockReset();
    saveSavedAgentSkillMock.mockReset();
    listAgentSkillsMock.mockResolvedValue(skillResponse(scannedSkills));
  });

  it("shows add skill title without checkbox path selection", async () => {
    render(
      <SavedAgentSkillForm
        mode="create"
        projectId={1}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Add skill" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Select All")).not.toBeInTheDocument();
    expect(screen.queryByText("Deselect All")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("disables save when no scanned paths are available", async () => {
    listAgentSkillsMock.mockResolvedValue(skillResponse([]));

    render(
      <SavedAgentSkillForm
        mode="create"
        projectId={1}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows read-only preferred path rows one per agent for edit mode", async () => {
    const skill: SavedAgentSkillRecord = {
      id: 3,
      name: "demo-skill",
      scope: "global",
      projectId: null,
      skillPaths: [
        {
          agentType: "codex",
          path: "/old/path/SKILL.md",
        },
      ],
    };

    render(
      <SavedAgentSkillForm
        mode="edit"
        skill={skill}
        projectId={1}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Edit skill" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
    expect(screen.getByText("Grok")).toBeInTheDocument();
    expect(
      screen.getByText("/home/me/.codex/skills/demo-skill/SKILL.md"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("/home/me/.config/opencode/skills/demo-skill/SKILL.md"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("/home/me/.grok/skills/demo-skill/SKILL.md"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("/home/me/.agents/skills/demo-skill/SKILL.md"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Select All")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("submits all scanned paths for the skill", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const saved: SavedAgentSkillRecord = {
      id: 9,
      name: "demo-skill",
      scope: "global",
      projectId: null,
      skillPaths: [
        {
          agentType: "codex",
          path: "/home/me/.agents/skills/demo-skill/SKILL.md",
        },
      ],
    };
    saveSavedAgentSkillMock.mockResolvedValue(saved);

    const skill: SavedAgentSkillRecord = {
      id: 9,
      name: "demo-skill",
      scope: "global",
      projectId: null,
      skillPaths: [
        {
          agentType: "codex",
          path: "/old/path/SKILL.md",
        },
      ],
    };

    render(
      <SavedAgentSkillForm
        mode="edit"
        skill={skill}
        projectId={1}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await screen.findByText("Codex");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveSavedAgentSkillMock).toHaveBeenCalledWith({
        id: 9,
        name: "demo-skill",
        scope: "global",
        projectId: null,
        skillPaths: [
          {
            agentType: "codex",
            path: "/home/me/.agents/skills/demo-skill/SKILL.md",
          },
          {
            agentType: "codex",
            path: "/home/me/.codex/skills/demo-skill/SKILL.md",
          },
          {
            agentType: "claude",
            path: "/home/me/.claude/skills/demo-skill/SKILL.md",
          },
          {
            agentType: "opencode",
            path: "/home/me/.agents/skills/demo-skill/SKILL.md",
          },
          {
            agentType: "opencode",
            path: "/home/me/.config/opencode/skills/demo-skill/SKILL.md",
          },
          {
            agentType: "grok",
            path: "/home/me/.agents/skills/demo-skill/SKILL.md",
          },
          {
            agentType: "grok",
            path: "/home/me/.grok/skills/demo-skill/SKILL.md",
          },
        ],
      });
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("loads scanned paths for edit mode and keeps save disabled when empty", async () => {
    listAgentSkillsMock.mockResolvedValue(skillResponse([]));
    const skill: SavedAgentSkillRecord = {
      id: 3,
      name: "ghost-skill",
      scope: "global",
      projectId: null,
      skillPaths: [
        {
          agentType: "codex",
          path: "/old/path/SKILL.md",
        },
      ],
    };

    render(
      <SavedAgentSkillForm
        mode="edit"
        skill={skill}
        projectId={1}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Edit skill" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Not detected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
