import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shared/commands/command-client", () => ({
  invokeCommand: vi.fn(),
}));

import { invokeCommand } from "../../shared/commands/command-client";
import {
  CODE_LANGUAGE_DIAGNOSTICS_EVENT,
  ensureCodeLanguageHost,
  notifyCodeLanguageDocument,
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

  it("notifies document sync with project workspace and uri", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await notifyCodeLanguageDocument({
      projectId: 7,
      workspacePath: "/tmp/redwhisk",
      uri: "file:///tmp/redwhisk/src/file.ts",
      kind: "didOpen",
      languageId: "typescript",
      version: 1,
      text: "const foo = bar;\n",
    });

    expect(invokeMock).toHaveBeenCalledWith("notify_code_language_document", {
      input: {
        projectId: 7,
        workspacePath: "/tmp/redwhisk",
        uri: "file:///tmp/redwhisk/src/file.ts",
        kind: "didOpen",
        languageId: "typescript",
        version: 1,
        text: "const foo = bar;\n",
      },
    });
  });

  it("exports the diagnostics event name", () => {
    expect(CODE_LANGUAGE_DIAGNOSTICS_EVENT).toBe("code-language-diagnostics");
  });
});
