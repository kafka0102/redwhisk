import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shared/commands/command-client", () => ({
  invokeCommand: vi.fn(),
}));

import { invokeCommand } from "../../shared/commands/command-client";
import {
  ensureCodeLanguageHost,
  stopCodeLanguageHost,
} from "./code-language-commands";

const invokeMock = vi.mocked(invokeCommand);

describe("code language commands", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("ensures the host with project and workspace", async () => {
    invokeMock.mockResolvedValueOnce({ status: "ready" });

    await expect(
      ensureCodeLanguageHost({
        projectId: 7,
        workspacePath: "/tmp/redwhisk",
      }),
    ).resolves.toEqual({ status: "ready" });

    expect(invokeMock).toHaveBeenCalledWith("ensure_code_language_host", {
      input: { projectId: 7, workspacePath: "/tmp/redwhisk" },
    });
  });

  it("stops the host with project and workspace", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await stopCodeLanguageHost({
      projectId: 7,
      workspacePath: "/tmp/redwhisk",
    });

    expect(invokeMock).toHaveBeenCalledWith("stop_code_language_host", {
      input: { projectId: 7, workspacePath: "/tmp/redwhisk" },
    });
  });
});
