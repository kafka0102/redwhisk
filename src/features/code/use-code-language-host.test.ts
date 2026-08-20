import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodeFileTab } from "./code-workspace-cache";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("./code-language-commands", () => ({
  CODE_LANGUAGE_DIAGNOSTICS_EVENT: "code-language-diagnostics",
  ensureCodeLanguageHost: vi.fn(),
  notifyCodeLanguageDocument: vi.fn(),
  stopCodeLanguageHost: vi.fn(),
}));

import {
  ensureCodeLanguageHost,
  stopCodeLanguageHost,
} from "./code-language-commands";
import { useCodeLanguageHost } from "./use-code-language-host";

const ensureMock = vi.mocked(ensureCodeLanguageHost);
const stopMock = vi.mocked(stopCodeLanguageHost);

function createTab(overrides: Partial<CodeFileTab> = {}): CodeFileTab {
  return {
    fileName: "file.ts",
    filePath: "src/file.ts",
    errorMessage: null,
    isDirty: false,
    isEditable: false,
    isLoading: false,
    lastActiveAt: 1,
    savedContent: "export const value = 1;\n",
    content: {
      content: "export const value = 1;\n",
      filePath: "src/file.ts",
      isBinary: false,
      isTooLarge: false,
      language: "typescript",
      modifiedAt: 1,
      sizeBytes: 24,
    },
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCodeLanguageHost", () => {
  beforeEach(() => {
    ensureMock.mockReset();
    stopMock.mockReset();
    ensureMock.mockResolvedValue({ status: "ready" });
    stopMock.mockResolvedValue(undefined);
  });

  it("ensures the host for a typescript file", async () => {
    const { result } = renderHook(() =>
      useCodeLanguageHost({
        projectId: 7,
        workspacePath: "/tmp/redwhisk",
        activeTab: createTab(),
      }),
    );
    await settle();

    expect(ensureMock).toHaveBeenCalledWith({
      projectId: 7,
      workspacePath: "/tmp/redwhisk",
    });
    expect(result.current.isReady).toBe(true);
  });

  it("does not ensure for markdown, binary, or too-large files", async () => {
    const { rerender } = renderHook(
      ({ tab }: { tab: CodeFileTab }) =>
        useCodeLanguageHost({
          projectId: 7,
          workspacePath: "/tmp/redwhisk",
          activeTab: tab,
        }),
      {
        initialProps: {
          tab: createTab({
            fileName: "readme.md",
            filePath: "docs/readme.md",
            content: {
              content: "# hi\n",
              filePath: "docs/readme.md",
              isBinary: false,
              isTooLarge: false,
              language: "markdown",
              modifiedAt: 1,
              sizeBytes: 5,
            },
          }),
        },
      },
    );
    await settle();
    expect(ensureMock).not.toHaveBeenCalled();

    rerender({
      tab: createTab({
        content: {
          content: "",
          filePath: "src/file.ts",
          isBinary: true,
          isTooLarge: false,
          language: "typescript",
          modifiedAt: 1,
          sizeBytes: 12,
        },
      }),
    });
    await settle();
    expect(ensureMock).not.toHaveBeenCalled();

    rerender({
      tab: createTab({
        content: {
          content: "",
          filePath: "src/file.ts",
          isBinary: false,
          isTooLarge: true,
          language: "typescript",
          modifiedAt: 1,
          sizeBytes: 9_999_999,
        },
      }),
    });
    await settle();
    expect(ensureMock).not.toHaveBeenCalled();
  });

  it("exposes an unavailable reason when the host cannot start", async () => {
    ensureMock.mockResolvedValue({
      status: "unavailable",
      reason: "nodeNotFound",
    });
    const { result } = renderHook(() =>
      useCodeLanguageHost({
        projectId: 7,
        workspacePath: "/tmp/redwhisk",
        activeTab: createTab(),
      }),
    );
    await settle();
    expect(result.current.unavailableReason).toBe("nodeNotFound");
  });

  it("stops the previous host when the workspace changes or the activity unmounts", async () => {
    const { rerender, unmount } = renderHook(
      ({ workspacePath }: { workspacePath: string }) =>
        useCodeLanguageHost({
          projectId: 7,
          workspacePath,
          activeTab: createTab(),
        }),
      { initialProps: { workspacePath: "/tmp/root-a" } },
    );
    await settle();

    rerender({ workspacePath: "/tmp/root-b" });
    await settle();
    expect(stopMock).toHaveBeenCalledWith({
      projectId: 7,
      workspacePath: "/tmp/root-a",
    });

    unmount();
    expect(stopMock).toHaveBeenCalledWith({
      projectId: 7,
      workspacePath: "/tmp/root-b",
    });
  });
});
