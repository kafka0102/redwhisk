import { describe, expect, it } from "vitest";

import { isAgentProfileTypeVisible } from "./agent-profile-visibility";

describe("isAgentProfileTypeVisible", () => {
  it("keeps the four user-selectable agent types visible", () => {
    expect(
      (["codex", "claude", "opencode", "grok"] as const).map(
        isAgentProfileTypeVisible,
      ),
    ).toEqual([true, true, true, true]);
  });

  it("hides deepseek", () => {
    expect(isAgentProfileTypeVisible("deepseek")).toBe(false);
  });
});
