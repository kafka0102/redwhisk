import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProject,
  initializeLocalData,
  listProjects,
  openProject,
  openProjectWindow,
} from "../../features/project/project-commands";
import { isCommandError, toCommandError } from "./command-error";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("command client", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes Rust Core through the initialize local data command", async () => {
    invokeMock.mockResolvedValue({
      databaseExists: true,
      currentVersion: "0001_core",
      appliedVersions: ["0001_core"],
    });

    await expect(initializeLocalData()).resolves.toEqual({
      databaseExists: true,
      currentVersion: "0001_core",
      appliedVersions: ["0001_core"],
    });
    expect(invokeMock).toHaveBeenCalledWith("initialize_local_data", undefined);
  });

  it("invokes Rust Core through the create project command", async () => {
    invokeMock.mockResolvedValue({
      id: 1,
      name: "redwhisk",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_581_600_000,
    });

    await expect(
      createProject({
        repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      }),
    ).resolves.toEqual({
      id: 1,
      name: "redwhisk",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_581_600_000,
    });
    expect(invokeMock).toHaveBeenCalledWith("create_project", {
      input: {
        repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      },
    });
  });

  it("invokes Rust Core through the list projects command", async () => {
    invokeMock.mockResolvedValue({
      projects: [
        {
          id: 1,
          name: "redwhisk",
          repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
          createdAt: 1_780_581_600_000,
          lastOpenedAt: 1_780_581_600_000,
          pathStatus: "available",
        },
      ],
    });

    await expect(listProjects()).resolves.toEqual({
      projects: [
        {
          id: 1,
          name: "redwhisk",
          repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
          createdAt: 1_780_581_600_000,
          lastOpenedAt: 1_780_581_600_000,
          pathStatus: "available",
        },
      ],
    });
    expect(invokeMock).toHaveBeenCalledWith("list_projects", undefined);
  });

  it("invokes Rust Core through the open project command", async () => {
    invokeMock.mockResolvedValue({
      id: 1,
      name: "redwhisk",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_624_800_000,
    });

    await expect(openProject({ projectId: 1 })).resolves.toEqual({
      id: 1,
      name: "redwhisk",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_624_800_000,
    });
    expect(invokeMock).toHaveBeenCalledWith("open_project", {
      input: { projectId: 1 },
    });
  });

  it("invokes Rust Core through the open project window command", async () => {
    invokeMock.mockResolvedValue({
      projectId: 1,
      windowLabel: "project-1",
    });

    await expect(openProjectWindow({ projectId: 1 })).resolves.toEqual({
      projectId: 1,
      windowLabel: "project-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("open_project_window", {
      input: { projectId: 1 },
    });
  });

  it("normalizes structured command errors", () => {
    const error = toCommandError({
      code: "LOCAL_DATA_INITIALIZATION_FAILED",
      message: "本地数据初始化失败。",
      details: [{ "@type": "DatabasePath", path: "/tmp/redwhisk" }],
    });

    expect(isCommandError(error)).toBe(true);
    expect(error).toEqual({
      code: "LOCAL_DATA_INITIALIZATION_FAILED",
      message: "本地数据初始化失败。",
      details: [{ "@type": "DatabasePath", path: "/tmp/redwhisk" }],
    });
  });

  it("rejects malformed command errors", () => {
    const error = toCommandError({
      code: "not-valid",
      message: "bad shape",
      details: [{ path: "/tmp/redwhisk" }],
    });

    expect(isCommandError(error)).toBe(true);
    expect(error).toEqual({
      code: "UNKNOWN_COMMAND_ERROR",
      message: "bad shape",
    });
  });

  it("wraps unknown invoke failures as command errors", async () => {
    invokeMock.mockRejectedValue("bridge unavailable");

    await expect(initializeLocalData()).rejects.toMatchObject({
      code: "UNKNOWN_COMMAND_ERROR",
      message: "bridge unavailable",
    });
  });
});
