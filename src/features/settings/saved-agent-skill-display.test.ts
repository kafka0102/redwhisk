import { describe, expect, it } from "vitest";

import {
  groupSupportedAgents,
  normalizeSkillAgentType,
  orderSkillPathEntries,
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
