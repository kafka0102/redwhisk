import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWindowFocus } from "./use-window-focus";

const mocks = vi.hoisted(() => ({
  focusListener: null as ((event: { payload: boolean }) => void) | null,
  isFocused: vi.fn(),
  shouldThrow: false,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (mocks.shouldThrow) {
      throw new Error("window unavailable");
    }

    return {
      isFocused: mocks.isFocused,
      onFocusChanged: (handler: (event: { payload: boolean }) => void) => {
        mocks.focusListener = handler;
        return Promise.resolve(mocks.unlisten);
      },
    };
  },
}));

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useWindowFocus", () => {
  beforeEach(() => {
    mocks.focusListener = null;
    mocks.isFocused.mockReset();
    mocks.unlisten.mockClear();
    mocks.shouldThrow = false;
  });

  afterEach(() => {
    mocks.shouldThrow = false;
  });

  it("reads the initial window focus and follows focus changes", async () => {
    mocks.isFocused.mockResolvedValue(false);

    const { result } = renderHook(() => useWindowFocus());
    await settle();
    expect(result.current).toBe(false);

    act(() => {
      mocks.focusListener?.({ payload: true });
    });
    expect(result.current).toBe(true);

    act(() => {
      mocks.focusListener?.({ payload: false });
    });
    expect(result.current).toBe(false);
  });

  it("stays focused when the window API is unavailable", async () => {
    mocks.shouldThrow = true;

    const { result } = renderHook(() => useWindowFocus());
    await settle();

    expect(result.current).toBe(true);
  });

  it("unlistens on unmount", async () => {
    mocks.isFocused.mockResolvedValue(true);

    const { unmount } = renderHook(() => useWindowFocus());
    await settle();
    unmount();

    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });
});
