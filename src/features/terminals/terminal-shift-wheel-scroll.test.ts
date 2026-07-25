import { describe, expect, it, vi } from "vitest";

import {
  createTerminalShiftWheelScrollHandler,
  resolveShiftWheelScrollLines,
} from "./terminal-shift-wheel-scroll";

function wheelEvent(
  partial: Pick<WheelEvent, "deltaY" | "shiftKey"> &
    Partial<Pick<WheelEvent, "preventDefault">>,
): WheelEvent {
  return {
    deltaY: partial.deltaY,
    shiftKey: partial.shiftKey,
    preventDefault: partial.preventDefault ?? vi.fn(),
  } as unknown as WheelEvent;
}

describe("resolveShiftWheelScrollLines", () => {
  it("returns null without shift, without delta, or without scrollback", () => {
    expect(resolveShiftWheelScrollLines(100, false, 40)).toBeNull();
    expect(resolveShiftWheelScrollLines(0, true, 40)).toBeNull();
    expect(resolveShiftWheelScrollLines(-40, true, 0)).toBeNull();
  });

  it("maps wheel direction to xterm scrollLines amount when shift + scrollback", () => {
    // deltaY < 0 = wheel up → scroll viewport toward older history (negative)
    expect(resolveShiftWheelScrollLines(-120, true, 40)).toBe(-3);
    // deltaY > 0 = wheel down → toward bottom (positive)
    expect(resolveShiftWheelScrollLines(120, true, 40)).toBe(3);
  });
});

describe("createTerminalShiftWheelScrollHandler", () => {
  it("scrolls buffer and blocks xterm/app handling on shift+wheel with scrollback", () => {
    const scrollLines = vi.fn();
    const preventDefault = vi.fn();
    const handler = createTerminalShiftWheelScrollHandler({
      scrollLines,
      buffer: { active: { baseY: 20 } },
    });

    const shouldProcess = handler(
      wheelEvent({ deltaY: -100, shiftKey: true, preventDefault }),
    );

    expect(shouldProcess).toBe(false);
    expect(scrollLines).toHaveBeenCalledWith(-3);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("lets non-shift wheel through so mouse-reporting apps still receive it", () => {
    const scrollLines = vi.fn();
    const handler = createTerminalShiftWheelScrollHandler({
      scrollLines,
      buffer: { active: { baseY: 20 } },
    });

    expect(handler(wheelEvent({ deltaY: -100, shiftKey: false }))).toBe(true);
    expect(scrollLines).not.toHaveBeenCalled();
  });

  it("does not invent scroll when buffer has no scrollback", () => {
    const scrollLines = vi.fn();
    const handler = createTerminalShiftWheelScrollHandler({
      scrollLines,
      buffer: { active: { baseY: 0 } },
    });

    expect(handler(wheelEvent({ deltaY: -100, shiftKey: true }))).toBe(true);
    expect(scrollLines).not.toHaveBeenCalled();
  });
});
