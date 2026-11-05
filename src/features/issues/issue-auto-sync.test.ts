import { describe, expect, it } from "vitest";

import { nextAutoSyncDelaySeconds } from "./issue-auto-sync";

describe("issue auto sync delay", () => {
  it("doubles the saved interval and caps at 900 seconds", () => {
    expect(nextAutoSyncDelaySeconds(90, 0)).toBe(90);
    expect(nextAutoSyncDelaySeconds(90, 1)).toBe(180);
    expect(nextAutoSyncDelaySeconds(90, 2)).toBe(360);
    expect(nextAutoSyncDelaySeconds(90, 3)).toBe(720);
    expect(nextAutoSyncDelaySeconds(90, 4)).toBe(900);
    expect(nextAutoSyncDelaySeconds(90, 5)).toBe(900);
  });
});
