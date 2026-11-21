import { describe, expect, it } from "vitest";

import { mergeVisibleAgentOrderIntoAllProfiles } from "./agent-profile-order";
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

describe("mergeVisibleAgentOrderIntoAllProfiles", () => {
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
