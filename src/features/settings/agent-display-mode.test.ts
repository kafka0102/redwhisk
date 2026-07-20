import { describe, expect, it } from "vitest";

import {
  getDisplayModeDefaults,
  resolveDisplayModeOnAgentTypeChange,
} from "./agent-display-mode";
import type { AgentType } from "../agents/agent-session-commands";

describe("getDisplayModeDefaults", () => {
  it.each(["codex", "claude"] as const)(
    "returns json default + switchable for %s",
    (agentType: AgentType) => {
      expect(getDisplayModeDefaults(agentType)).toEqual({
        defaultMode: "json",
        canSwitch: true,
      });
    },
  );

  it.each(["opencode", "grok"] as const)(
    "returns tui default + locked for %s",
    (agentType: AgentType) => {
      expect(getDisplayModeDefaults(agentType)).toEqual({
        defaultMode: "tui",
        canSwitch: false,
      });
    },
  );
});

describe("resolveDisplayModeOnAgentTypeChange", () => {
  it("forces tui when switching to opencode", () => {
    expect(resolveDisplayModeOnAgentTypeChange("opencode", "json")).toBe("tui");
    expect(resolveDisplayModeOnAgentTypeChange("opencode", "tui")).toBe("tui");
  });

  it("forces tui when switching to grok", () => {
    expect(resolveDisplayModeOnAgentTypeChange("grok", "json")).toBe("tui");
  });

  it("preserves tui when switching to codex/claude with tui selected", () => {
    expect(resolveDisplayModeOnAgentTypeChange("codex", "tui")).toBe("tui");
    expect(resolveDisplayModeOnAgentTypeChange("claude", "tui")).toBe("tui");
  });

  it("falls back to json when switching to codex/claude with json current", () => {
    expect(resolveDisplayModeOnAgentTypeChange("codex", "json")).toBe("json");
    expect(resolveDisplayModeOnAgentTypeChange("claude", "json")).toBe("json");
  });
});
