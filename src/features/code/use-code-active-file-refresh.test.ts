import { act, renderHook } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CodeFileTab } from "./code-workspace-cache";
import {
  buildActiveFileSignature,
  useCodeActiveFileRefresh,
} from "./use-code-active-file-refresh";

vi.mock("../../shared/workspace/workspace-commands", () => ({
  readProjectWorktreeFile: vi.fn(),
  statProjectWorktreeFile: vi.fn(),
}));

import {
  readProjectWorktreeFile,
  statProjectWorktreeFile,
} from "../../shared/workspace/workspace-commands";

const statMock = vi.mocked(statProjectWorktreeFile);
const readMock = vi.mocked(readProjectWorktreeFile);

const fileContent = {
  content: "export const value = 1;\n",
  filePath: "src/file.ts",
  isBinary: false,
  isTooLarge: false,
  language: "typescript",
  modifiedAt: 1,
  sizeBytes: 24,
};

function setVisibility(visible: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCodeActiveFileRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    statMock.mockReset();
    readMock.mockReset();
    setVisibility(true);
    statMock.mockResolvedValue({
      filePath: fileContent.filePath,
      sizeBytes: fileContent.sizeBytes,
      modifiedAt: fileContent.modifiedAt,
    });
    readMock.mockResolvedValue(fileContent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not re-read when the metadata signature is unchanged", async () => {
    const setTabs = vi.fn();
    const knownSignature = buildActiveFileSignature(
      fileContent.sizeBytes,
      fileContent.modifiedAt,
    );

    renderHook(() =>
      useCodeActiveFileRefresh({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        activePath: "src/file.ts",
        enabled: true,
        knownSignature,
        setTabs,
        resolveErrorMessage: () => "err",
      }),
    );
    await settle();

    statMock.mockClear();
    readMock.mockClear();
    setTabs.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settle();

    expect(statMock).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
      filePath: "src/file.ts",
    });
    expect(readMock).not.toHaveBeenCalled();
    expect(setTabs).not.toHaveBeenCalled();
  });

  it("silently reloads content when the metadata signature changes", async () => {
    let tabs: CodeFileTab[] = [
      {
        content: fileContent,
        errorMessage: null,
        fileName: "file.ts",
        filePath: "src/file.ts",
        isDirty: false,
        isEditable: false,
        isLoading: false,
        lastActiveAt: 1,
        savedContent: fileContent.content,
      },
    ];
    const setTabs = vi.fn(
      (value: CodeFileTab[] | ((current: CodeFileTab[]) => CodeFileTab[])) => {
        tabs = typeof value === "function" ? value(tabs) : value;
      },
    ) as unknown as Dispatch<SetStateAction<CodeFileTab[]>> &
      ReturnType<typeof vi.fn>;
    const knownSignature = buildActiveFileSignature(
      fileContent.sizeBytes,
      fileContent.modifiedAt,
    );

    renderHook(() =>
      useCodeActiveFileRefresh({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        activePath: "src/file.ts",
        enabled: true,
        knownSignature,
        setTabs,
        resolveErrorMessage: () => "err",
      }),
    );
    await settle();
    readMock.mockClear();
    setTabs.mockClear();

    const updated = {
      ...fileContent,
      content: "export const value = 2;\n",
      modifiedAt: 2,
      sizeBytes: 25,
    };
    statMock.mockResolvedValue({
      filePath: updated.filePath,
      sizeBytes: updated.sizeBytes,
      modifiedAt: updated.modifiedAt,
    });
    readMock.mockResolvedValue(updated);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settle();

    expect(readMock).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath: "/tmp/redwhisk",
      filePath: "src/file.ts",
    });
    expect(tabs[0]?.content?.content).toBe(updated.content);
    expect(tabs[0]?.isLoading).toBe(false);
    expect(tabs[0]?.errorMessage).toBeNull();
  });

  it("enters the error state when stat fails", async () => {
    let tabs: CodeFileTab[] = [
      {
        content: fileContent,
        errorMessage: null,
        fileName: "file.ts",
        filePath: "src/file.ts",
        isDirty: false,
        isEditable: false,
        isLoading: false,
        lastActiveAt: 1,
        savedContent: fileContent.content,
      },
    ];
    const setTabs = vi.fn(
      (value: CodeFileTab[] | ((current: CodeFileTab[]) => CodeFileTab[])) => {
        tabs = typeof value === "function" ? value(tabs) : value;
      },
    ) as unknown as Dispatch<SetStateAction<CodeFileTab[]>> &
      ReturnType<typeof vi.fn>;
    const knownSignature = buildActiveFileSignature(
      fileContent.sizeBytes,
      fileContent.modifiedAt,
    );

    renderHook(() =>
      useCodeActiveFileRefresh({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        activePath: "src/file.ts",
        enabled: true,
        knownSignature,
        setTabs,
        resolveErrorMessage: () => "文件不存在",
      }),
    );
    await settle();
    setTabs.mockClear();

    statMock.mockRejectedValue({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      reason: "workspaceFileReadFailed",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settle();

    expect(tabs[0]?.content).toBeNull();
    expect(tabs[0]?.errorMessage).toBe("文件不存在");
    expect(tabs[0]?.isLoading).toBe(false);
    expect(readMock).not.toHaveBeenCalled();
  });

  it("reloads content after a failed refresh once the file is readable again", async () => {
    let tabs: CodeFileTab[] = [
      {
        content: fileContent,
        errorMessage: null,
        fileName: "file.ts",
        filePath: "src/file.ts",
        isDirty: false,
        isEditable: false,
        isLoading: false,
        lastActiveAt: 1,
        savedContent: fileContent.content,
      },
    ];
    const setTabs = vi.fn(
      (value: CodeFileTab[] | ((current: CodeFileTab[]) => CodeFileTab[])) => {
        tabs = typeof value === "function" ? value(tabs) : value;
      },
    ) as unknown as Dispatch<SetStateAction<CodeFileTab[]>> &
      ReturnType<typeof vi.fn>;
    const knownSignature = buildActiveFileSignature(
      fileContent.sizeBytes,
      fileContent.modifiedAt,
    );

    const { rerender } = renderHook(
      (props: { knownSignature: string | null }) =>
        useCodeActiveFileRefresh({
          projectId: 1,
          workspacePath: "/tmp/redwhisk",
          activePath: "src/file.ts",
          enabled: true,
          knownSignature: props.knownSignature,
          setTabs,
          resolveErrorMessage: () => "文件不存在",
        }),
      { initialProps: { knownSignature: knownSignature as string | null } },
    );
    await settle();

    statMock.mockRejectedValueOnce({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      reason: "workspaceFileReadFailed",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settle();
    expect(tabs[0]?.content).toBeNull();
    expect(tabs[0]?.errorMessage).toBe("文件不存在");

    rerender({ knownSignature: null });
    const restored = {
      ...fileContent,
      content: "restored\n",
      modifiedAt: 9,
      sizeBytes: 9,
    };
    statMock.mockResolvedValue({
      filePath: restored.filePath,
      sizeBytes: restored.sizeBytes,
      modifiedAt: restored.modifiedAt,
    });
    readMock.mockResolvedValue(restored);
    readMock.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settle();

    expect(readMock).toHaveBeenCalled();
    expect(tabs[0]?.content?.content).toBe("restored\n");
    expect(tabs[0]?.errorMessage).toBeNull();
  });

  it("pauses polling while the document is hidden and checks immediately when visible again", async () => {
    const setTabs = vi.fn();
    const knownSignature = buildActiveFileSignature(
      fileContent.sizeBytes,
      fileContent.modifiedAt,
    );

    renderHook(() =>
      useCodeActiveFileRefresh({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        activePath: "src/file.ts",
        enabled: true,
        knownSignature,
        setTabs,
        resolveErrorMessage: () => "err",
      }),
    );
    await settle();
    const callsAfterMount = statMock.mock.calls.length;

    act(() => setVisibility(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(statMock).toHaveBeenCalledTimes(callsAfterMount);

    act(() => setVisibility(true));
    await settle();
    expect(statMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("does not poll when disabled or missing active path", async () => {
    const setTabs = vi.fn();
    renderHook(() =>
      useCodeActiveFileRefresh({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        activePath: null,
        enabled: true,
        knownSignature: null,
        setTabs,
        resolveErrorMessage: () => "err",
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(statMock).not.toHaveBeenCalled();

    renderHook(() =>
      useCodeActiveFileRefresh({
        projectId: 1,
        workspacePath: "/tmp/redwhisk",
        activePath: "src/file.ts",
        enabled: false,
        knownSignature: buildActiveFileSignature(24, 1),
        setTabs,
        resolveErrorMessage: () => "err",
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(statMock).not.toHaveBeenCalled();
  });
});
