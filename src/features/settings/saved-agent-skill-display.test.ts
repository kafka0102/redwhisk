import { describe, expect, it } from "vitest";

import {
  groupSupportedAgents,
  normalizeSkillAgentType,
  orderSkillPathEntries,
  preferredSkillPathEntries,
  selectPreferredSkillPath,
} from "./saved-agent-skill-display";

describe("normalizeSkillAgentType", () => {
  it("maps claude_code to claude", () => {
    expect(normalizeSkillAgentType("claude_code")).toBe("claude");
  });

  it("keeps known agent types", () => {
    expect(normalizeSkillAgentType("codex")).toBe("codex");
    expect(normalizeSkillAgentType("opencode")).toBe("opencode");
    expect(normalizeSkillAgentType("grok")).toBe("grok");
  });
});

describe("groupSupportedAgents", () => {
  it("orders agents Codex → Claude → OpenCode → Grok and de-dupes agents", () => {
    const groups = groupSupportedAgents([
      { agentType: "grok", path: "/g1" },
      { agentType: "opencode", path: "/o1" },
      { agentType: "claude", path: "/c1" },
      { agentType: "codex", path: "/x1" },
      { agentType: "codex", path: "/x2" },
    ]);

    expect(groups.map((group) => group.agentType)).toEqual([
      "codex",
      "claude",
      "opencode",
      "grok",
    ]);
    expect(groups[0]?.paths).toEqual(["/x1", "/x2"]);
  });

  it("merges claude_code into claude and keeps multiple paths", () => {
    const groups = groupSupportedAgents([
      { agentType: "claude_code", path: "/a" },
      { agentType: "claude", path: "/b" },
      { agentType: "claude", path: "/a" },
    ]);

    expect(groups).toEqual([{ agentType: "claude", paths: ["/a", "/b"] }]);
  });

  it("returns empty when no paths", () => {
    expect(groupSupportedAgents([])).toEqual([]);
  });

  it("appends unknown agent types after known order", () => {
    const groups = groupSupportedAgents([
      { agentType: "zeta", path: "/z" },
      { agentType: "codex", path: "/x" },
      { agentType: "alpha", path: "/a" },
    ]);

    expect(groups.map((group) => group.agentType)).toEqual([
      "codex",
      "alpha",
      "zeta",
    ]);
  });
});

describe("orderSkillPathEntries", () => {
  it("orders path rows by agent display order then path", () => {
    const ordered = orderSkillPathEntries([
      { agentType: "grok", path: "/g-b" },
      { agentType: "codex", path: "/x-b" },
      { agentType: "grok", path: "/g-a" },
      { agentType: "claude", path: "/c" },
      { agentType: "codex", path: "/x-a" },
    ]);

    expect(ordered.map((entry) => `${entry.agentType}:${entry.path}`)).toEqual([
      "codex:/x-a",
      "codex:/x-b",
      "claude:/c",
      "grok:/g-a",
      "grok:/g-b",
    ]);
  });
});

describe("selectPreferredSkillPath", () => {
  it("prefers OpenCode dedicated root over .agents/skills and .claude/skills", () => {
    const preferred = selectPreferredSkillPath("opencode", [
      "/home/me/.agents/skills/demo/SKILL.md",
      "/home/me/.claude/skills/demo/SKILL.md",
      "/home/me/.config/opencode/skills/demo/SKILL.md",
      "/repo/.opencode/skills/demo/SKILL.md",
    ]);

    // 同级专属根取字典序第一条
    expect(preferred).toBe("/home/me/.config/opencode/skills/demo/SKILL.md");
  });

  it("prefers Grok dedicated root over shared roots", () => {
    const preferred = selectPreferredSkillPath("grok", [
      "/home/me/.agents/skills/demo/SKILL.md",
      "/home/me/.claude/skills/demo/SKILL.md",
      "/home/me/.grok/skills/demo/SKILL.md",
    ]);

    expect(preferred).toBe("/home/me/.grok/skills/demo/SKILL.md");
  });

  it("prefers Codex dedicated roots including superpowers and /etc", () => {
    expect(
      selectPreferredSkillPath("codex", [
        "/home/me/.agents/skills/demo/SKILL.md",
        "/home/me/.codex/skills/demo/SKILL.md",
      ]),
    ).toBe("/home/me/.codex/skills/demo/SKILL.md");

    expect(
      selectPreferredSkillPath("codex", [
        "/home/me/.agents/skills/demo/SKILL.md",
        "/home/me/.codex/superpowers/skills/demo/SKILL.md",
      ]),
    ).toBe("/home/me/.codex/superpowers/skills/demo/SKILL.md");

    expect(
      selectPreferredSkillPath("codex", [
        "/home/me/.agents/skills/demo/SKILL.md",
        "/etc/codex/skills/demo/SKILL.md",
      ]),
    ).toBe("/etc/codex/skills/demo/SKILL.md");
  });

  it("prefers Claude dedicated root over other paths", () => {
    expect(
      selectPreferredSkillPath("claude", [
        "/tmp/other/demo/SKILL.md",
        "/home/me/.claude/skills/demo/SKILL.md",
      ]),
    ).toBe("/home/me/.claude/skills/demo/SKILL.md");

    expect(
      selectPreferredSkillPath("claude_code", [
        "/tmp/other/demo/SKILL.md",
        "/home/me/.claude/skills/demo/SKILL.md",
      ]),
    ).toBe("/home/me/.claude/skills/demo/SKILL.md");
  });

  it("falls back to .agents/skills before other shared and remainder", () => {
    expect(
      selectPreferredSkillPath("opencode", [
        "/tmp/custom/demo/SKILL.md",
        "/home/me/.claude/skills/demo/SKILL.md",
        "/home/me/.agents/skills/demo/SKILL.md",
      ]),
    ).toBe("/home/me/.agents/skills/demo/SKILL.md");

    expect(
      selectPreferredSkillPath("opencode", [
        "/tmp/custom/demo/SKILL.md",
        "/home/me/.claude/skills/demo/SKILL.md",
      ]),
    ).toBe("/home/me/.claude/skills/demo/SKILL.md");

    expect(
      selectPreferredSkillPath("opencode", [
        "/tmp/z-custom/demo/SKILL.md",
        "/tmp/a-custom/demo/SKILL.md",
      ]),
    ).toBe("/tmp/a-custom/demo/SKILL.md");
  });

  it("returns null for empty paths and first lexical when single", () => {
    expect(selectPreferredSkillPath("codex", [])).toBeNull();
    expect(selectPreferredSkillPath("codex", ["/only/path/SKILL.md"])).toBe(
      "/only/path/SKILL.md",
    );
  });
});

describe("preferredSkillPathEntries", () => {
  it("returns one preferred path per agent in display order", () => {
    const preferred = preferredSkillPathEntries([
      {
        agentType: "opencode",
        path: "/home/me/.agents/skills/demo/SKILL.md",
      },
      {
        agentType: "opencode",
        path: "/home/me/.config/opencode/skills/demo/SKILL.md",
      },
      {
        agentType: "grok",
        path: "/home/me/.agents/skills/demo/SKILL.md",
      },
      {
        agentType: "grok",
        path: "/home/me/.grok/skills/demo/SKILL.md",
      },
      {
        agentType: "codex",
        path: "/home/me/.agents/skills/demo/SKILL.md",
      },
      {
        agentType: "codex",
        path: "/home/me/.codex/skills/demo/SKILL.md",
      },
      {
        agentType: "claude",
        path: "/home/me/.claude/skills/demo/SKILL.md",
      },
    ]);

    expect(preferred).toEqual([
      {
        agentType: "codex",
        path: "/home/me/.codex/skills/demo/SKILL.md",
      },
      {
        agentType: "claude",
        path: "/home/me/.claude/skills/demo/SKILL.md",
      },
      {
        agentType: "opencode",
        path: "/home/me/.config/opencode/skills/demo/SKILL.md",
      },
      {
        agentType: "grok",
        path: "/home/me/.grok/skills/demo/SKILL.md",
      },
    ]);
  });
});
