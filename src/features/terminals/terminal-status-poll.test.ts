import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTerminalStatusPoll } from "./terminal-status-poll";

describe("createTerminalStatusPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls only while synced visible, without stacking timers", () => {
    const poll = vi.fn();
    const controller = createTerminalStatusPoll(2_000, poll);

    controller.sync(true);
    controller.sync(true);
    vi.advanceTimersByTime(4_000);
    expect(poll).toHaveBeenCalledTimes(2);

    controller.sync(false);
    vi.advanceTimersByTime(6_000);
    expect(poll).toHaveBeenCalledTimes(2);

    controller.sync(true);
    vi.advanceTimersByTime(2_000);
    expect(poll).toHaveBeenCalledTimes(3);

    controller.dispose();
    vi.advanceTimersByTime(10_000);
    expect(poll).toHaveBeenCalledTimes(3);
  });
});
