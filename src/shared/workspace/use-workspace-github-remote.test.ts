import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceGithubRemote } from "./use-workspace-github-remote";
import { resolveWorkspaceGithubRemote } from "./workspace-commands";

vi.mock("./workspace-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-commands")>();
  return {
    ...actual,
    resolveWorkspaceGithubRemote: vi.fn(),
  };
});

const resolveMock = vi.mocked(resolveWorkspaceGithubRemote);

describe("useWorkspaceGithubRemote", () => {
  beforeEach(() => {
    resolveMock.mockReset();
  });

  it("returns resolved github remote", async () => {
    resolveMock.mockResolvedValue({
      remote: { owner: "acme", repo: "widgets" },
    });

    const { result } = renderHook(() =>
      useWorkspaceGithubRemote({ projectId: 1, workspacePath: "/tmp/repo" }),
    );

    await waitFor(() => {
      expect(result.current).toEqual({ owner: "acme", repo: "widgets" });
    });
    expect(resolveMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: null,
      workspacePath: "/tmp/repo",
    });
  });

  it("returns null when remote missing or command fails", async () => {
    resolveMock.mockResolvedValue({ remote: null });
    const { result, rerender } = renderHook(
      ({ input }) => useWorkspaceGithubRemote(input),
      { initialProps: { input: { projectId: 1 } } },
    );
    await waitFor(() => {
      expect(result.current).toBeNull();
    });

    resolveMock.mockRejectedValue(new Error("fail"));
    rerender({ input: { projectId: 2 } });
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
  });

  it("clears remote when workspace input is absent", async () => {
    resolveMock.mockResolvedValue({
      remote: { owner: "acme", repo: "widgets" },
    });
    const { result, rerender } = renderHook(
      ({ input }: { input: { projectId: number } | null }) =>
        useWorkspaceGithubRemote(input),
      {
        initialProps: {
          input: { projectId: 1 } as { projectId: number } | null,
        },
      },
    );
    await waitFor(() => {
      expect(result.current).toEqual({ owner: "acme", repo: "widgets" });
    });

    rerender({ input: null });
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
  });
});
