import { describe, expect, it } from "vitest";

import {
  countCupHomeSequences,
  createInPlaceTuiCupTracker,
  resolveInPlaceTuiScrollHintAction,
  shouldShowInPlaceTuiScrollHint,
} from "./terminal-inplace-tui-hint";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("countCupHomeSequences", () => {
  it("counts bare CSI H and 1;1H as home cups", () => {
    expect(countCupHomeSequences(encode("\x1b[Hhello\x1b[1;1H"))).toBe(2);
  });

  it("ignores CUP to lower rows", () => {
    expect(countCupHomeSequences(encode("\x1b[3;3H\x1b[10;1H"))).toBe(0);
  });

  it("counts empty-row forms as home", () => {
    expect(countCupHomeSequences(encode("\x1b[;1H\x1b[0;0H"))).toBe(2);
  });
});

describe("createInPlaceTuiCupTracker", () => {
  it("accumulates cup score and decays without cups", () => {
    const tracker = createInPlaceTuiCupTracker();
    tracker.observe(encode("\x1b[H\x1b[1;1H\x1b[H"));
    expect(tracker.getScore()).toBe(3);
    tracker.observe(encode("plain line\r\n"));
    expect(tracker.getScore()).toBe(2);
  });

  it("resets score", () => {
    const tracker = createInPlaceTuiCupTracker();
    tracker.observe(encode("\x1b[H\x1b[H\x1b[H"));
    tracker.reset();
    expect(tracker.getScore()).toBe(0);
  });
});

describe("shouldShowInPlaceTuiScrollHint", () => {
  it("shows only when baseY is 0 and cup score reaches threshold", () => {
    expect(shouldShowInPlaceTuiScrollHint(0, 3)).toBe(true);
    expect(shouldShowInPlaceTuiScrollHint(0, 2)).toBe(false);
    expect(shouldShowInPlaceTuiScrollHint(5, 10)).toBe(false);
  });
});

describe("resolveInPlaceTuiScrollHintAction", () => {
  it("does not override high-priority status sources", () => {
    expect(resolveInPlaceTuiScrollHintAction("restore", 0, 10)).toEqual({
      type: "noop",
    });
  });

  it("shows hint when eligible", () => {
    expect(resolveInPlaceTuiScrollHintAction(null, 0, 3)).toEqual({
      type: "show",
    });
  });

  it("clears previous inplace/output when no longer needed", () => {
    expect(resolveInPlaceTuiScrollHintAction("inplace", 4, 10)).toEqual({
      type: "clear",
      source: "inplace",
    });
  });
});
