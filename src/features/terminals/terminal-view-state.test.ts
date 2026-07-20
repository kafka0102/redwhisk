import { afterEach, describe, expect, it } from "vitest";

import {
  clearTerminalViewStatesForTests,
  peekTerminalViewState,
  resolveHistoryScrollViewportY,
  saveTerminalViewState,
} from "./terminal-view-state";

describe("terminal-view-state", () => {
  afterEach(() => {
    clearTerminalViewStatesForTests();
  });

  it("stores and peeks view state by key", () => {
    expect(peekTerminalViewState("t1")).toBeNull();

    saveTerminalViewState("t1", { sequence: 3, viewportY: 12 });
    expect(peekTerminalViewState("t1")).toEqual({
      sequence: 3,
      viewportY: 12,
    });

    saveTerminalViewState("t1", { sequence: 5, viewportY: 0 });
    expect(peekTerminalViewState("t1")).toEqual({
      sequence: 5,
      viewportY: 0,
    });
    expect(peekTerminalViewState("t2")).toBeNull();
  });

  it("restores viewport only when restore sequence is unchanged", () => {
    expect(resolveHistoryScrollViewportY(null, 1)).toBeNull();
    expect(
      resolveHistoryScrollViewportY({ sequence: 10, viewportY: 7 }, 10),
    ).toBe(7);
    expect(
      resolveHistoryScrollViewportY({ sequence: 10, viewportY: 7 }, 11),
    ).toBeNull();
  });
});
