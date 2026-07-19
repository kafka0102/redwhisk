import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConditionalPolling } from "./use-conditional-polling";

describe("useConditionalPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes immediately on activate when refreshOnActivate is default (true)", () => {
    const refresh = vi.fn();
    renderHook(() =>
      useConditionalPolling({ refresh, intervalMs: 1_000, isActive: true }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh or tick when inactive", () => {
    const refresh = vi.fn();
    renderHook(() =>
      useConditionalPolling({ refresh, intervalMs: 1_000, isActive: false }),
    );
    vi.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ticks at intervalMs when active", () => {
    const refresh = vi.fn();
    renderHook(() =>
      useConditionalPolling({ refresh, intervalMs: 1_000, isActive: true }),
    );
    expect(refresh).toHaveBeenCalledTimes(1); // refreshOnActivate 补拉
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("does not refresh on activate when refreshOnActivate is false", () => {
    const refresh = vi.fn();
    renderHook(() =>
      useConditionalPolling({
        refresh,
        intervalMs: 1_000,
        isActive: true,
        refreshOnActivate: false,
      }),
    );
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("starts polling on false->true and stops on true->false", () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(
      ({ isActive }: { isActive: boolean }) =>
        useConditionalPolling({ refresh, intervalMs: 1_000, isActive }),
      { initialProps: { isActive: false } },
    );
    vi.advanceTimersByTime(3_000);
    expect(refresh).not.toHaveBeenCalled();

    rerender({ isActive: true });
    expect(refresh).toHaveBeenCalledTimes(1); // 激活补拉
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    rerender({ isActive: false });
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(2); // 失活后不再 tick
  });

  it("restarts interval when intervalMs changes while active", () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(
      ({ intervalMs }: { intervalMs: number }) =>
        useConditionalPolling({ refresh, intervalMs, isActive: true }),
      { initialProps: { intervalMs: 5_000 } },
    );
    expect(refresh).toHaveBeenCalledTimes(1); // 初始激活补拉
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    // intervalMs 变化：effect 重启，refreshOnActivate 默认 true 再补拉一次 + 新节奏。
    rerender({ intervalMs: 1_000 });
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("clears interval on unmount", () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() =>
      useConditionalPolling({ refresh, intervalMs: 1_000, isActive: true }),
    );
    expect(refresh).toHaveBeenCalledTimes(1); // 激活补拉
    unmount();
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledTimes(1); // 卸载后不再 tick
  });
});
