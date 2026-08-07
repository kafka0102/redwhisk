import { describe, expect, it } from "vitest";

import {
  hasInactiveShellLikeTerminal,
  isShellLikeLaunchCommand,
} from "./project-terminal-shell-kind";

describe("isShellLikeLaunchCommand", () => {
  it("treats empty or whitespace as shell-like", () => {
    expect(isShellLikeLaunchCommand("")).toBe(true);
    expect(isShellLikeLaunchCommand("   ")).toBe(true);
    expect(isShellLikeLaunchCommand("\t")).toBe(true);
  });

  it("treats default shell paths and basenames as shell-like", () => {
    expect(isShellLikeLaunchCommand("/bin/zsh")).toBe(true);
    expect(isShellLikeLaunchCommand("zsh")).toBe(true);
    expect(isShellLikeLaunchCommand("  /bin/zsh  ")).toBe(true);
    expect(isShellLikeLaunchCommand("/bin/bash")).toBe(true);
    expect(isShellLikeLaunchCommand("bash")).toBe(true);
  });

  it("rejects business launch commands", () => {
    expect(isShellLikeLaunchCommand("pnpm dev")).toBe(false);
    expect(isShellLikeLaunchCommand("pnpm dev:admin-api")).toBe(false);
    expect(isShellLikeLaunchCommand("/usr/bin/python3")).toBe(false);
  });
});

describe("hasInactiveShellLikeTerminal", () => {
  it("detects inactive shell-like configs only", () => {
    expect(
      hasInactiveShellLikeTerminal([
        { sessionId: -1, launchCommand: "/bin/zsh" },
        { sessionId: 0, launchCommand: "pnpm dev" },
      ]),
    ).toBe(false);

    expect(
      hasInactiveShellLikeTerminal([
        { sessionId: 0, launchCommand: "/bin/zsh" },
        { sessionId: 0, launchCommand: "pnpm dev" },
      ]),
    ).toBe(true);

    expect(
      hasInactiveShellLikeTerminal([{ sessionId: 0, launchCommand: "" }]),
    ).toBe(true);
  });
});
