import { describe, expect, it, vi } from "vitest";

// vi.mock 会自动 hoist。svg 资源经 Vite 在运行时被打成 URL 字符串，
// 在 vitest 里用静态字面量替换以稳定断言。
vi.mock("../../assets/images/codex.svg", () => ({ default: "mock-codex.svg" }));
vi.mock("../../assets/images/claude.svg", () => ({
  default: "mock-claude.svg",
}));
vi.mock("../../assets/images/opencode.svg", () => ({
  default: "mock-opencode.svg",
}));
vi.mock("../../assets/images/grok.svg", () => ({ default: "mock-grok.svg" }));

import { formatAgentTypeLabel, getAgentLogoSrc } from "./agent-visuals";

describe("formatAgentTypeLabel", () => {
  it("returns Codex for codex", () => {
    expect(formatAgentTypeLabel("codex")).toBe("Codex");
  });

  it("returns Claude for claude and claude_code UI alias", () => {
    expect(formatAgentTypeLabel("claude")).toBe("Claude");
    expect(formatAgentTypeLabel("claude_code")).toBe("Claude");
  });

  it("returns OpenCode for opencode", () => {
    expect(formatAgentTypeLabel("opencode")).toBe("OpenCode");
  });

  it("returns Grok for grok", () => {
    expect(formatAgentTypeLabel("grok")).toBe("Grok");
  });

  it("falls back to raw agentType for unknown values", () => {
    expect(formatAgentTypeLabel("foo")).toBe("foo");
  });
});

describe("getAgentLogoSrc", () => {
  it("returns codex logo for codex", () => {
    expect(getAgentLogoSrc("codex")).toBe("mock-codex.svg");
  });

  it("returns claude logo for claude and claude_code UI alias", () => {
    expect(getAgentLogoSrc("claude")).toBe("mock-claude.svg");
    expect(getAgentLogoSrc("claude_code")).toBe("mock-claude.svg");
  });

  it("returns opencode logo for opencode", () => {
    expect(getAgentLogoSrc("opencode")).toBe("mock-opencode.svg");
  });

  it("returns grok logo for grok", () => {
    expect(getAgentLogoSrc("grok")).toBe("mock-grok.svg");
  });

  it("falls back to codex logo for unknown values", () => {
    expect(getAgentLogoSrc("foo")).toBe("mock-codex.svg");
  });
});
