import { describe, expect, it } from "vitest";

import {
  compareAgentProfilesForDisplay,
  sortAgentProfilesForDisplay,
} from "./agent-profile-sort";
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
    ...overrides,
  };
}

describe("compareAgentProfilesForDisplay", () => {
  it("ranks enabled profile ahead of disabled regardless of id", () => {
    const enabled = makeProfile({ id: 100, enabled: true });
    const disabled = makeProfile({ id: 1, enabled: false });
    expect(compareAgentProfilesForDisplay(enabled, disabled)).toBeLessThan(0);
    expect(compareAgentProfilesForDisplay(disabled, enabled)).toBeGreaterThan(
      0,
    );
  });

  it("sorts by id ascending within enabled group", () => {
    const a = makeProfile({ id: 10, enabled: true });
    const b = makeProfile({ id: 5, enabled: true });
    expect(compareAgentProfilesForDisplay(a, b)).toBeGreaterThan(0);
    expect(compareAgentProfilesForDisplay(b, a)).toBeLessThan(0);
  });

  it("sorts by id ascending within disabled group", () => {
    const a = makeProfile({ id: 10, enabled: false });
    const b = makeProfile({ id: 5, enabled: false });
    expect(compareAgentProfilesForDisplay(a, b)).toBeGreaterThan(0);
    expect(compareAgentProfilesForDisplay(b, a)).toBeLessThan(0);
  });

  it("returns 0 when id and enabled both match", () => {
    const a = makeProfile({ id: 7, enabled: true });
    const b = makeProfile({ id: 7, enabled: true });
    expect(compareAgentProfilesForDisplay(a, b)).toBe(0);
  });
});

describe("sortAgentProfilesForDisplay", () => {
  it("places enabled-by-id-asc before disabled-by-id-asc", () => {
    const enabledLower = makeProfile({
      id: 1,
      enabled: true,
      name: "enabled-lower",
    });
    const enabledHigher = makeProfile({
      id: 2,
      enabled: true,
      name: "enabled-higher",
    });
    const disabledLower = makeProfile({
      id: 3,
      enabled: false,
      name: "disabled-lower",
    });
    const disabledHigher = makeProfile({
      id: 4,
      enabled: false,
      name: "disabled-higher",
    });

    const sorted = sortAgentProfilesForDisplay([
      disabledHigher,
      enabledHigher,
      disabledLower,
      enabledLower,
    ]);

    expect(sorted.map((profile) => profile.name)).toEqual([
      "enabled-lower",
      "enabled-higher",
      "disabled-lower",
      "disabled-higher",
    ]);
  });

  it("does not mutate the input array", () => {
    const enabled = makeProfile({ id: 1, enabled: true });
    const disabled = makeProfile({ id: 2, enabled: false });
    const input = [disabled, enabled];
    sortAgentProfilesForDisplay(input);
    expect(input[0]).toBe(disabled);
    expect(input[1]).toBe(enabled);
  });

  it("returns empty array for empty input", () => {
    expect(sortAgentProfilesForDisplay([])).toEqual([]);
  });
});
