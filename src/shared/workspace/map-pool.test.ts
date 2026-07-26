import { describe, expect, it, vi } from "vitest";

import { mapPool } from "./map-pool";

describe("mapPool", () => {
  it("runs all items", async () => {
    const seen: number[] = [];
    await mapPool([1, 2, 3], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  it("caps concurrent workers", async () => {
    let active = 0;
    let maxActive = 0;
    const delays = [30, 10, 10, 10];

    await mapPool(delays, 2, async (delay) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("handles empty input", async () => {
    const worker = vi.fn();
    await mapPool([], 4, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});
