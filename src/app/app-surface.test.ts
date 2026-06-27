import { describe, expect, it } from "vitest";

import { resolveAppSurface } from "./app-surface";

describe("resolveAppSurface", () => {
  it("resolves the desktop session monitor surface", () => {
    expect(
      resolveAppSurface(
        "?surface=session-monitor&projectId=7&ownerWindowLabel=main",
      ),
    ).toEqual({
      ownerWindowLabel: "main",
      projectId: 7,
      type: "session-monitor",
    });
  });

  it("falls back to the project app for invalid monitor parameters", () => {
    expect(resolveAppSurface("?surface=session-monitor&projectId=0")).toEqual({
      type: "project",
    });
  });
});
