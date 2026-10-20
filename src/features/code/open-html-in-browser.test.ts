import { beforeEach, describe, expect, it, vi } from "vitest";

const openPath = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath,
}));

import {
  joinWorkspaceFilePath,
  openHtmlInBrowser,
} from "./open-html-in-browser";

describe("joinWorkspaceFilePath", () => {
  it("joins a workspace root and a relative file path", () => {
    expect(joinWorkspaceFilePath("/tmp/repo", "docs/index.html")).toBe(
      "/tmp/repo/docs/index.html",
    );
  });

  it("drops extra separators on either side", () => {
    expect(joinWorkspaceFilePath("/tmp/repo/", "/index.html")).toBe(
      "/tmp/repo/index.html",
    );
  });
});

describe("openHtmlInBrowser", () => {
  beforeEach(() => {
    openPath.mockReset();
  });

  it("opens the absolute file path with the system default app", async () => {
    openPath.mockResolvedValue(undefined);

    await expect(openHtmlInBrowser("/tmp/repo", "index.html")).resolves.toBe(
      true,
    );
    expect(openPath).toHaveBeenCalledWith("/tmp/repo/index.html");
  });

  it("returns false when the opener rejects", async () => {
    openPath.mockRejectedValue(new Error("blocked"));

    await expect(openHtmlInBrowser("/tmp/repo", "index.html")).resolves.toBe(
      false,
    );
  });

  it("returns false without calling the opener when a path is missing", async () => {
    await expect(openHtmlInBrowser("", "index.html")).resolves.toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });
});
