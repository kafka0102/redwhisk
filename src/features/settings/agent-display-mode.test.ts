import { describe, expect, it } from "vitest";

import {
  getDisplayModeDefaults,
  resolveDisplayModeOnAgentTypeChange,
} from "./agent-display-mode";
import type { AgentType } from "../agents/agent-session-commands";

describe("getDisplayModeDefaults", () => {
  it.each(["codex", "claude", "opencode"] as const)(
    "returns json default + switchable for %s",
    (agentType: AgentType) => {
      expect(getDisplayModeDefaults(agentType)).toEqual({
        defaultMode: "json",
        canSwitch: true,
      });
    },
  );

  it("returns tui default + locked for grok", () => {
    expect(getDisplayModeDefaults("grok")).toEqual({
      defaultMode: "tui",
      canSwitch: false,
    });
  });
});

describe("resolveDisplayModeOnAgentTypeChange", () => {
  it("preserves tui when switching to opencode with tui selected", () => {
    expect(resolveDisplayModeOnAgentTypeChange("opencode", "tui")).toBe("tui");
  });

  it("falls back to json when switching to opencode with json current", () => {
    expect(resolveDisplayModeOnAgentTypeChange("opencode", "json")).toBe(
      "json",
    );
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
