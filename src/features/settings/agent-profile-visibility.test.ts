import { describe, expect, it } from "vitest";

import {
  filterVisibleAgentProfiles,
  isAgentProfileTypeVisible,
  mergeVisibleAgentOrderIntoAllProfiles,
} from "./agent-profile-visibility";
import type { AgentProfileRecord } from "./settings-commands";

function makeProfile(
  overrides: Partial<AgentProfileRecord>,
): AgentProfileRecord {
  return {
    id: 1,
    name: "Agent",
    agentType: "codex",
    command: "codex",
    scope: "global",
    projectId: null,
    mode: "full-access",
    dangerous: true,
    defaultSkill: "",
    promptTemplate: "",
    del: 0,
    displayMode: "json",
    enabled: true,
    displayOrder: 1,
    ...overrides,
  };
}

describe("agent profile visibility", () => {
  it("keeps the four user-selectable agent types visible", () => {
    expect(
      ["codex", "claude", "opencode", "grok"].map((agentType) =>
        isAgentProfileTypeVisible(agentType as AgentProfileRecord["agentType"]),
      ),
    ).toEqual([true, true, true, true]);
    expect(isAgentProfileTypeVisible("deepseek")).toBe(false);
  });

  it("filters hidden profiles without changing the input", () => {
    const profiles = [
      makeProfile({ id: 1, agentType: "codex" }),
      makeProfile({ id: 2, agentType: "deepseek" }),
      makeProfile({ id: 3, agentType: "grok" }),
    ];

    expect(
      filterVisibleAgentProfiles(profiles).map((profile) => profile.id),
    ).toEqual([1, 3]);
    expect(profiles.map((profile) => profile.id)).toEqual([1, 2, 3]);
  });

  it("reorders visible slots while hidden profiles keep their positions", () => {
    const profiles = [
      makeProfile({ id: 11, agentType: "codex" }),
      makeProfile({ id: 22, agentType: "deepseek" }),
      makeProfile({ id: 33, agentType: "grok" }),
    ];

    expect(mergeVisibleAgentOrderIntoAllProfiles(profiles, [33, 11])).toEqual([
      33, 22, 11,
    ]);
  });
});
