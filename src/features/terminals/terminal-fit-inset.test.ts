import { describe, expect, it } from "vitest";

import { computeTerminalBottomInset } from "./terminal-fit-inset";

describe("computeTerminalBottomInset", () => {
  it("reproduces size-dependent gap between terminal rows and status bar", () => {
    // fontSize 14 / lineHeight 1 的典型 cell 高度
    const cellHeight = 14;

    // 用户症状：某些高度约 8px 缝，某些接近 0–2px
    expect(computeTerminalBottomInset(1002, cellHeight)).toBe(8);
    expect(computeTerminalBottomInset(282, cellHeight)).toBe(2);
    expect(computeTerminalBottomInset(280, cellHeight)).toBe(0);
    expect(computeTerminalBottomInset(247, cellHeight)).toBe(9);
  });

  it("keeps inset in [0, cellHeight) so content sits on the bottom edge", () => {
    const cellHeight = 17;
    for (let height = cellHeight; height <= 400; height += 1) {
      const inset = computeTerminalBottomInset(height, cellHeight);
      expect(inset).toBeGreaterThanOrEqual(0);
      expect(inset).toBeLessThan(cellHeight);
      const rows = Math.floor(height / cellHeight);
      expect(height - inset).toBe(rows * cellHeight);
    }
  });

  it("returns 0 for non-positive or non-finite inputs", () => {
    expect(computeTerminalBottomInset(0, 14)).toBe(0);
    expect(computeTerminalBottomInset(100, 0)).toBe(0);
    expect(computeTerminalBottomInset(-10, 14)).toBe(0);
    expect(computeTerminalBottomInset(Number.NaN, 14)).toBe(0);
    expect(computeTerminalBottomInset(100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("applyTerminalBottomInset", () => {
  it("sets xterm element height to an integer multiple of the cell height", async () => {
    const { applyTerminalBottomInset, clearTerminalBottomInset } =
      await import("./terminal-fit-inset");

    const host = document.createElement("div");
    Object.defineProperty(host, "clientHeight", {
      configurable: true,
      value: 1002,
    });

    const element = document.createElement("div");
    host.appendChild(element);

    const terminal = {
      element,
      _core: {
        _renderService: {
          dimensions: {
            css: {
              cell: { height: 14 },
            },
          },
        },
      },
    };

    const inset = applyTerminalBottomInset(terminal as never, host);
    expect(inset).toBe(8);
    expect(element.style.height).toBe("994px");

    clearTerminalBottomInset(terminal as never);
    expect(element.style.height).toBe("");
  });
});
