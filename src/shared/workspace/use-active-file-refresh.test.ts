import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  WorkspaceFileContent,
  WorkspaceFileStat,
} from "./workspace-commands";

const windowMocks = vi.hoisted(() => ({
  focusListener: null as ((event: { payload: boolean }) => void) | null,
  isFocused: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: windowMocks.isFocused,
    onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
      windowMocks.focusListener = handler;
      return Promise.resolve(() => undefined);
    },
  }),
}));

vi.mock("./workspace-commands", () => ({
  readProjectWorktreeFile: vi.fn(),
  statProjectWorktreeFile: vi.fn(),
}));

import {
  readProjectWorktreeFile,
  statProjectWorktreeFile,
} from "./workspace-commands";
import {
  buildActiveFileSignature,
  resetActiveFileRefreshStateForTests,
  useActiveFileRefresh,
  type UseActiveFileRefreshOptions,
} from "./use-active-file-refresh";

const statMock = vi.mocked(statProjectWorktreeFile);
const readMock = vi.mocked(readProjectWorktreeFile);

const FILE_PATH = "src/file.ts";

const fileContent: WorkspaceFileContent = {
  content: "export const value = 1;\n",
  filePath: FILE_PATH,
  isBinary: false,
  isTooLarge: false,
  previewKind: null,
  previewBytesBase64: "",
  language: "typescript",
  modifiedAt: 1,
  sizeBytes: 24,
};

const baselineSignature = buildActiveFileSignature(
  fileContent.sizeBytes,
  fileContent.modifiedAt,
);

type RefreshProps = Omit<UseActiveFileRefreshOptions, "onContent" | "onError">;

function rootFor(name: string): string {
  return `/tmp/redwhisk-active-file-refresh/${name}`;
}

function setWindowFocused(focused: boolean): void {
  act(() => {
    windowMocks.focusListener?.({ payload: focused });
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve();
    }
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

function renderRefresh(initialProps: RefreshProps) {
  const onContent = vi.fn();
  const onError = vi.fn();
  const view = renderHook(
    (props: RefreshProps) =>
      useActiveFileRefresh({ ...props, onContent, onError }),
    { initialProps },
  );
  return { ...view, onContent, onError };
}

function callsForFile(filePath: string): number {
  return statMock.mock.calls.filter(([input]) => input.filePath === filePath)
    .length;
}

describe("useActiveFileRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    statMock.mockReset();
    readMock.mockReset();
    resetActiveFileRefreshStateForTests();
    windowMocks.focusListener = null;
    windowMocks.isFocused.mockReset();
    windowMocks.isFocused.mockResolvedValue(true);
    setWindowFocused(true);
    statMock.mockResolvedValue({
      filePath: FILE_PATH,
      sizeBytes: fileContent.sizeBytes,
      modifiedAt: fileContent.modifiedAt,
    });
    readMock.mockResolvedValue(fileContent);
  });

  afterEach(() => {
    setWindowFocused(true);
    vi.useRealTimers();
  });

  it("A1 stats on the 3000ms boundary while the file tab is visible and focused", async () => {
    const workspacePath = rootFor("a1");
    renderRefresh({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    });
    await advance(0);
    expect(statMock).toHaveBeenCalledTimes(1);
    expect(statMock).toHaveBeenLastCalledWith({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
    });

    statMock.mockClear();
    await advance(2999);
    expect(statMock).not.toHaveBeenCalled();

    await advance(1);
    expect(statMock).toHaveBeenCalledTimes(1);
  });

  it("A2 does not read content or report a change when the signature is unchanged", async () => {
    const workspacePath = rootFor("a2");
    const { onContent } = renderRefresh({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    });
    await advance(0);
    statMock.mockClear();
    readMock.mockClear();
    onContent.mockClear();

    await advance(3000);

    expect(statMock).toHaveBeenCalledTimes(1);
    expect(readMock).not.toHaveBeenCalled();
    expect(onContent).not.toHaveBeenCalled();
  });

  it("A3 reads once and reports the new content when the signature changes", async () => {
    const workspacePath = rootFor("a3");
    const updated: WorkspaceFileContent = {
      ...fileContent,
      content: "export const value = 2;\n",
      modifiedAt: 2,
      sizeBytes: 25,
    };
    const { onContent } = renderRefresh({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    });
    await advance(0);
    readMock.mockClear();
    onContent.mockClear();

    statMock.mockResolvedValue({
      filePath: updated.filePath,
      sizeBytes: updated.sizeBytes,
      modifiedAt: updated.modifiedAt,
    });
    readMock.mockResolvedValue(updated);

    await advance(3000);

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenCalledWith({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
    });
    expect(onContent).toHaveBeenCalledTimes(1);
    expect(onContent).toHaveBeenCalledWith(updated);
  });

  it("A4 pauses while the file tab is hidden and checks immediately once it has been 3s", async () => {
    const workspacePath = rootFor("a4");
    const initialProps: RefreshProps = {
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    };
    const { rerender } = renderRefresh(initialProps);
    await advance(0);
    expect(statMock).toHaveBeenCalledTimes(1);
    statMock.mockClear();

    rerender({ ...initialProps, enabled: false });
    await advance(30_000);
    expect(statMock).not.toHaveBeenCalled();

    rerender({ ...initialProps, enabled: true });
    await advance(0);
    expect(statMock).toHaveBeenCalledTimes(1);
  });

  it("A5 pauses while the window is blurred and checks immediately after refocus", async () => {
    const workspacePath = rootFor("a5");
    renderRefresh({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    });
    await advance(0);
    expect(statMock).toHaveBeenCalledTimes(1);
    statMock.mockClear();

    setWindowFocused(false);
    await advance(30_000);
    expect(statMock).not.toHaveBeenCalled();

    setWindowFocused(true);
    await advance(0);
    expect(statMock).toHaveBeenCalledTimes(1);
  });

  it("A6 does not stack another stat while a check for the same file is in flight", async () => {
    const workspacePath = rootFor("a6");
    let resolveStat: (stat: WorkspaceFileStat) => void = () => undefined;
    statMock.mockReturnValueOnce(
      new Promise<WorkspaceFileStat>((resolve) => {
        resolveStat = resolve;
      }),
    );
    renderRefresh({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    });
    await advance(0);
    expect(statMock).toHaveBeenCalledTimes(1);

    await advance(9000);
    expect(statMock).toHaveBeenCalledTimes(1);

    resolveStat({
      filePath: FILE_PATH,
      sizeBytes: fileContent.sizeBytes,
      modifiedAt: fileContent.modifiedAt,
    });
    await settle();
    await advance(3000);

    expect(statMock).toHaveBeenCalledTimes(2);
  });

  it("supports Session files with sessionId and no workspacePath", async () => {
    const updated: WorkspaceFileContent = {
      ...fileContent,
      content: "export const value = 2;\n",
      modifiedAt: 2,
      sizeBytes: 25,
    };
    const { onContent } = renderRefresh({
      projectId: 1,
      sessionId: 10,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    });
    await advance(0);
    expect(statMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 10,
      filePath: FILE_PATH,
    });

    statMock.mockResolvedValue({
      filePath: FILE_PATH,
      sizeBytes: updated.sizeBytes,
      modifiedAt: updated.modifiedAt,
    });
    readMock.mockResolvedValue(updated);
    await advance(3000);

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 10,
      filePath: FILE_PATH,
    });
    expect(onContent).toHaveBeenCalledWith(updated);
  });

  it("retries the body read after hiding during an in-flight changed check", async () => {
    const workspacePath = rootFor("in-flight-hide");
    const updated: WorkspaceFileContent = {
      ...fileContent,
      content: "export const value = 2;\n",
      modifiedAt: 2,
      sizeBytes: 25,
    };
    const initialProps: RefreshProps = {
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    };
    const { onContent, rerender } = renderRefresh(initialProps);
    await advance(0);

    statMock.mockResolvedValue({
      filePath: FILE_PATH,
      sizeBytes: updated.sizeBytes,
      modifiedAt: updated.modifiedAt,
    });
    let resolveRead: (content: WorkspaceFileContent) => void = () => undefined;
    readMock.mockReturnValueOnce(
      new Promise<WorkspaceFileContent>((resolve) => {
        resolveRead = resolve;
      }),
    );
    await advance(3000);
    expect(statMock).toHaveBeenCalledTimes(2);
    expect(readMock).toHaveBeenCalledTimes(1);

    rerender({ ...initialProps, enabled: false });
    resolveRead(updated);
    readMock.mockResolvedValue(updated);
    await settle();
    expect(onContent).not.toHaveBeenCalled();

    rerender({ ...initialProps, enabled: true });
    await advance(3000);

    expect(readMock).toHaveBeenCalledTimes(2);
    expect(onContent).toHaveBeenCalledWith(updated);
  });

  it("B1 waits out the remaining interval when returning to a tab checked less than 3s ago", async () => {
    const workspacePath = rootFor("b1");
    const initialProps: RefreshProps = {
      projectId: 1,
      workspacePath,
      filePath: "src/a.ts",
      enabled: true,
      knownSignature: baselineSignature,
    };
    const { rerender } = renderRefresh(initialProps);
    await advance(0);
    expect(callsForFile("src/a.ts")).toBe(1);

    await advance(1000);
    rerender({ ...initialProps, filePath: "src/b.ts" });
    await advance(0);
    expect(callsForFile("src/b.ts")).toBe(1);

    statMock.mockClear();
    await advance(1000);
    rerender({ ...initialProps, filePath: "src/a.ts" });
    await advance(0);
    expect(callsForFile("src/a.ts")).toBe(0);

    await advance(1000);
    expect(callsForFile("src/a.ts")).toBe(1);
  });

  it("B2 checks immediately when returning to a tab after 3s or more", async () => {
    const workspacePath = rootFor("b2");
    const initialProps: RefreshProps = {
      projectId: 1,
      workspacePath,
      filePath: "src/a.ts",
      enabled: true,
      knownSignature: baselineSignature,
    };
    const { rerender } = renderRefresh(initialProps);
    await advance(0);
    await advance(1000);
    rerender({ ...initialProps, filePath: "src/b.ts" });
    await advance(0);

    statMock.mockClear();
    await advance(2000);
    rerender({ ...initialProps, filePath: "src/a.ts" });
    await advance(1);

    expect(callsForFile("src/a.ts")).toBe(1);
  });

  it("B3 keeps detection timestamps separate per session and workspace root", async () => {
    const workspacePath = rootFor("b3");
    const initialProps: RefreshProps = {
      projectId: 1,
      sessionId: 10,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    };
    const { rerender } = renderRefresh(initialProps);
    await advance(0);
    expect(statMock).toHaveBeenCalledTimes(1);

    await advance(1000);
    rerender({ ...initialProps, sessionId: 11 });
    await advance(0);
    expect(statMock).toHaveBeenCalledTimes(2);
    expect(statMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 11,
      workspacePath,
      filePath: FILE_PATH,
    });

    await advance(1000);
    const otherRoot = rootFor("b3-other");
    rerender({ ...initialProps, sessionId: 11, workspacePath: otherRoot });
    await advance(0);
    expect(statMock).toHaveBeenCalledTimes(3);
    expect(statMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 11,
      workspacePath: otherRoot,
      filePath: FILE_PATH,
    });
  });

  it("C1 reports a stat failure without reading or reporting stale content", async () => {
    const workspacePath = rootFor("c1");
    const { onContent, onError } = renderRefresh({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    });
    await advance(0);
    readMock.mockClear();
    onContent.mockClear();

    const failure = {
      code: "AGENT_SESSION_VALIDATION_FAILED",
      reason: "workspaceFileReadFailed",
    };
    statMock.mockRejectedValue(failure);
    await advance(3000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure, FILE_PATH);
    expect(readMock).not.toHaveBeenCalled();
    expect(onContent).not.toHaveBeenCalled();
  });

  it("C3 keeps the loaded signature when git worktree list fails with too many open files", async () => {
    const workspacePath = rootFor("c3");
    const { onContent, onError } = renderRefresh({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    });
    await advance(0);

    const failure = {
      code: "AGENT_SESSION_VALIDATION_FAILED",
      message: "代码工作区读取失败。",
      reason: "codeWorkspaceReadFailed",
      details: [
        {
          "@type": "Cause",
          message:
            "git command failed for git worktree list --porcelain: Too many open files (os error 24)",
        },
      ],
    };
    statMock.mockRejectedValueOnce(failure);
    await advance(3000);

    expect(onError).not.toHaveBeenCalled();
    expect(onContent).not.toHaveBeenCalled();
    expect(readMock).not.toHaveBeenCalled();

    statMock.mockResolvedValue({
      filePath: FILE_PATH,
      sizeBytes: fileContent.sizeBytes,
      modifiedAt: fileContent.modifiedAt,
    });
    readMock.mockClear();
    statMock.mockClear();
    await advance(3000);

    expect(statMock).toHaveBeenCalledTimes(1);
    expect(readMock).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onContent).not.toHaveBeenCalled();
  });

  it("C2 reads the file again on the next check after a stat failure", async () => {
    const workspacePath = rootFor("c2");
    const { onContent, onError } = renderRefresh({
      projectId: 1,
      workspacePath,
      filePath: FILE_PATH,
      enabled: true,
      knownSignature: baselineSignature,
    });
    await advance(0);

    statMock.mockRejectedValueOnce({
      code: "AGENT_SESSION_VALIDATION_FAILED",
      reason: "workspaceFileReadFailed",
    });
    await advance(3000);
    expect(onError).toHaveBeenCalledTimes(1);

    const restored: WorkspaceFileContent = {
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
    onContent.mockClear();

    await advance(3000);

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(onContent).toHaveBeenCalledWith(restored);
  });
});
