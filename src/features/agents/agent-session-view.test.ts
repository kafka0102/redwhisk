import { describe, expect, it } from "vitest";

import { computeEffectiveTurnStatus } from "./agent-session-view";

describe("computeEffectiveTurnStatus", () => {
  it("reducer running 时直接 running", () => {
    expect(computeEffectiveTurnStatus("running", false, true)).toBe("running");
  });

  it("grace 期内 isTurnRunning 维持 running，即使 reducer idle", () => {
    expect(computeEffectiveTurnStatus("idle", true, true)).toBe("running");
  });

  it("grace 过期 isTurnRunning=false 且 reducer idle 时 idle", () => {
    expect(computeEffectiveTurnStatus("idle", false, true)).toBe("idle");
  });

  it("canUseExternalTurnRunning=false 时不靠 isTurnRunning", () => {
    expect(computeEffectiveTurnStatus("idle", true, false)).toBe("idle");
  });

  it("reducer failed 且 isTurnRunning=false 时 failed", () => {
    expect(computeEffectiveTurnStatus("failed", false, true)).toBe("failed");
  });
});
