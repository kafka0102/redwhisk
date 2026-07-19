import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SIDEBAR_WIDTH,
  selectInitialRoot,
  useWorkspaceShell,
} from "./use-workspace-shell";

vi.mock("./workspace-commands", () => ({
  CODE_WORKSPACE_ROOTS_UPDATED_EVENT: "code-workspace-roots-updated",
  listCodeWorkspaceRoots: vi.fn(),
}));
vi.mock("../tauri-event/use-tauri-event", () => ({
  subscribeTauriEvent: () => () => {},
}));

import { listCodeWorkspaceRoots } from "./workspace-commands";

const listRootsMock = vi.mocked(listCodeWorkspaceRoots);

const projectRoot = { branch: "main", path: "/tmp/repo", isProjectRoot: true };
const featureRoot = {
  branch: "issue-1",
  path: "/tmp/repo.wt/issue-1",
  isProjectRoot: false,
};

describe("selectInitialRoot", () => {
  it("returns the project root when present", () => {
    expect(selectInitialRoot([featureRoot, projectRoot])).toEqual(projectRoot);
  });

  it("returns null when no project root exists", () => {
    expect(selectInitialRoot([featureRoot])).toBeNull();
  });
});

describe("useWorkspaceShell", () => {
  beforeEach(() => {
    listRootsMock.mockReset();
    listRootsMock.mockResolvedValue({ roots: [projectRoot] });
  });

  it("exposes the default sidebar width constant as 400", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(400);
  });

  it("initializes selectedRoot from initialSelectedRootPath when it exists in roots", async () => {
    listRootsMock.mockResolvedValue({ roots: [projectRoot, featureRoot] });
    const { result } = renderHook(() =>
      useWorkspaceShell({
        projectId: 1,
        initialRoots: [projectRoot, featureRoot],
        initialSelectedRootPath: featureRoot.path,
        initialSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      }),
    );

    expect(result.current.selectedRootWorkspacePath).toBe(featureRoot.path);
  });

  it("falls back to the project root when the cached selected root disappears", async () => {
    listRootsMock.mockResolvedValue({ roots: [projectRoot] });
    const { result } = renderHook(() =>
      useWorkspaceShell({
        projectId: 1,
        initialRoots: [projectRoot],
        initialSelectedRootPath: "/tmp/repo.wt/gone",
        initialSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      }),
    );

    await vi.waitFor(() => {
      expect(result.current.selectedRootWorkspacePath).toBe(projectRoot.path);
    });
  });

  it("invokes onRootChange when selectRoot is called", async () => {
    const onRootChange = vi.fn();
    listRootsMock.mockResolvedValue({ roots: [projectRoot, featureRoot] });
    const { result } = renderHook(() =>
      useWorkspaceShell({
        projectId: 1,
        initialRoots: [projectRoot, featureRoot],
        initialSelectedRootPath: projectRoot.path,
        initialSidebarWidth: DEFAULT_SIDEBAR_WIDTH,
        onRootChange,
      }),
    );

    await vi.waitFor(() => {
      expect(result.current.roots).toHaveLength(2);
    });

    act(() => {
      result.current.selectRoot(featureRoot);
    });

    expect(result.current.selectedRootWorkspacePath).toBe(featureRoot.path);
    expect(onRootChange).toHaveBeenCalled();
  });
});
