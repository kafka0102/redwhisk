import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionFileLinks } from "./session-file-links";
import {
  clearWorkspaceFileExistenceCacheForTest,
  useWorkspaceFileExistence,
} from "./use-workspace-file-existence";

vi.mock("../../../shared/workspace/workspace-commands", () => ({
  statProjectWorktreeFile: vi.fn(),
}));

const { statProjectWorktreeFile } =
  await import("../../../shared/workspace/workspace-commands");
const statMock = vi.mocked(statProjectWorktreeFile);

function fileLinks(sessionId: number): SessionFileLinks {
  return {
    projectId: 1,
    sessionId,
    workspacePath: "/Users/tester/repo",
    homePath: "/Users/tester",
    openFilePath: () => {},
  };
}

function renderExistence(
  sessionFileLinks: SessionFileLinks | undefined,
  candidatePaths: string[],
) {
  return renderHook(
    (props: {
      sessionFileLinks: SessionFileLinks | undefined;
      candidatePaths: string[];
    }) =>
      useWorkspaceFileExistence(props.sessionFileLinks, props.candidatePaths),
    { initialProps: { sessionFileLinks, candidatePaths } },
  );
}

beforeEach(() => {
  statMock.mockReset();
  statMock.mockRejectedValue(new Error("file not found"));
  clearWorkspaceFileExistenceCacheForTest();
});

describe("useWorkspaceFileExistence", () => {
  it("未注入文件链接能力时不发存在性检查请求", async () => {
    const { result } = renderExistence(undefined, ["src/app/a.ts"]);

    await waitFor(() => {
      expect(result.current("src/app/a.ts")).toBe(false);
    });
    expect(statMock).not.toHaveBeenCalled();
  });

  it("探测存在的候选路径，结果落地后判定为可点", async () => {
    statMock.mockResolvedValue({
      filePath: "src/app/a.ts",
      sizeBytes: 10,
      modifiedAt: null,
    });

    const { result } = renderExistence(fileLinks(1), ["src/app/a.ts"]);

    await waitFor(() => {
      expect(result.current("src/app/a.ts")).toBe(true);
    });
    expect(statMock).toHaveBeenCalledTimes(1);
    expect(statMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 1,
      filePath: "src/app/a.ts",
    });
    expect(result.current("src/app/missing.ts")).toBe(false);
  });

  it("后端拒绝的候选路径判定为不可点", async () => {
    const { result } = renderExistence(fileLinks(1), ["src/app/missing.ts"]);

    await waitFor(() => {
      expect(statMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current("src/app/missing.ts")).toBe(false);
  });

  it("同一路径只探测一次，流式重渲染不重复请求", async () => {
    statMock.mockResolvedValue({
      filePath: "src/app/a.ts",
      sizeBytes: 10,
      modifiedAt: null,
    });

    const { result, rerender } = renderExistence(fileLinks(1), [
      "src/app/a.ts",
    ]);
    await waitFor(() => {
      expect(result.current("src/app/a.ts")).toBe(true);
    });

    rerender({
      sessionFileLinks: fileLinks(1),
      candidatePaths: ["src/app/a.ts"],
    });
    rerender({
      sessionFileLinks: fileLinks(1),
      candidatePaths: ["src/app/a.ts", "src/app/b.ts"],
    });

    await waitFor(() => {
      expect(statMock).toHaveBeenCalledTimes(2);
    });
  });

  it("缓存 key 含 session，不同会话的同一路径各自探测", async () => {
    statMock.mockResolvedValue({
      filePath: "src/app/a.ts",
      sizeBytes: 10,
      modifiedAt: null,
    });

    const { result, rerender } = renderExistence(fileLinks(1), [
      "src/app/a.ts",
    ]);
    await waitFor(() => {
      expect(result.current("src/app/a.ts")).toBe(true);
    });

    rerender({
      sessionFileLinks: fileLinks(2),
      candidatePaths: ["src/app/a.ts"],
    });

    await waitFor(() => {
      expect(statMock).toHaveBeenCalledTimes(2);
    });
    expect(statMock).toHaveBeenLastCalledWith({
      projectId: 1,
      sessionId: 2,
      filePath: "src/app/a.ts",
    });
  });
});
