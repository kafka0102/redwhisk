import { describe, expect, it } from "vitest";

import {
  filterLaunchVisibleAgentProfiles,
  pickDefaultLaunchSelectableProfile,
  resolveAgentProfileLaunchEligibility,
} from "./agent-launch-eligibility";
import type { AgentProfileRecord } from "../settings/settings-commands";

function makeProfile(
  overrides: Partial<AgentProfileRecord>,
): AgentProfileRecord {
  return {
    id: 1,
    name: "Codex",
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

describe("resolveAgentProfileLaunchEligibility", () => {
  it("enabled=false 时完全隐藏", () => {
    expect(
      resolveAgentProfileLaunchEligibility(makeProfile({ enabled: false })),
    ).toEqual({ visible: false, selectable: false });
  });

  it.each(["codex", "claude", "claude_code", "opencode", "grok"] as const)(
    "agentType=%s 且 enabled=true → 正常可选",
    (agentType) => {
      expect(
        resolveAgentProfileLaunchEligibility(makeProfile({ agentType })),
      ).toEqual({ visible: true, selectable: true });
    },
  );

  it("grok 且 enabled=false → enabled 判定优先，完全隐藏", () => {
    expect(
      resolveAgentProfileLaunchEligibility(
        makeProfile({ agentType: "grok", enabled: false }),
      ),
    ).toEqual({ visible: false, selectable: false });
  });
});

describe("filterLaunchVisibleAgentProfiles", () => {
  it("剔除 enabled=false 的项（保留 grok 与可选 OpenCode）", () => {
    const profiles = [
      makeProfile({ id: 1, name: "Codex" }),
      makeProfile({ id: 2, name: "Old Codex", enabled: false }),
      makeProfile({ id: 3, name: "OpenCode", agentType: "opencode" }),
      makeProfile({ id: 4, name: "Grok", agentType: "grok" }),
    ];
    const visible = filterLaunchVisibleAgentProfiles(profiles);
    expect(visible.map((profile) => profile.id)).toEqual([1, 3, 4]);
  });

  it("返回新数组，不修改入参", () => {
    const profiles = [
      makeProfile({ id: 1 }),
      makeProfile({ id: 2, enabled: false }),
    ];
    const snapshot = [...profiles];
    filterLaunchVisibleAgentProfiles(profiles);
    expect(profiles).toEqual(snapshot);
  });
});

describe("pickDefaultLaunchSelectableProfile", () => {
  it("返回首个可选 profile（含 grok）", () => {
    const profiles = [
      makeProfile({ id: 1, agentType: "grok" }),
      makeProfile({ id: 2, agentType: "opencode" }),
      makeProfile({ id: 3, agentType: "codex" }),
      makeProfile({ id: 4, agentType: "claude" }),
    ];
    expect(pickDefaultLaunchSelectableProfile(profiles)?.id).toBe(1);
  });

  it("全部不可选时返回 null", () => {
    const profiles = [
      makeProfile({ id: 1, agentType: "grok", enabled: false }),
      makeProfile({ id: 2, agentType: "codex", enabled: false }),
      makeProfile({ id: 3, agentType: "opencode", enabled: false }),
    ];
    expect(pickDefaultLaunchSelectableProfile(profiles)).toBeNull();
  });

  it("空数组返回 null", () => {
    expect(pickDefaultLaunchSelectableProfile([])).toBeNull();
  });
});
