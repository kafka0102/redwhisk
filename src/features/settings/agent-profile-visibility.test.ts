import { describe, expect, it } from "vitest";

import { filterVisibleAgentProfiles } from "./agent-profile-visibility";
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

describe("filterVisibleAgentProfiles", () => {
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
});
