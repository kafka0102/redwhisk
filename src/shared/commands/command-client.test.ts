import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initializeLocalData } from "../../features/project/project-commands";
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
