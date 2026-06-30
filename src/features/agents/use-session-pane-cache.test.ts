import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSessionPaneCache } from "./use-session-pane-cache";

describe("useSessionPaneCache", () => {
  it("将当前选中的 sessionId 同步加入缓存末尾", () => {
    const { result } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({ currentSessionId, maxCached: 5 }),
      { initialProps: 301 },
    );

    // render 阶段同步 touch，首次渲染后 cachedSessionIds 即包含当前 session。
    expect(result.current.cachedSessionIds).toEqual([301]);
  });

  it("切换 session 时把新 session 移到末尾，保留历史 session", () => {
    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({ currentSessionId, maxCached: 5 }),
      { initialProps: 301 },
    );

    rerender(302);
    expect(result.current.cachedSessionIds).toEqual([301, 302]);

    rerender(303);
    expect(result.current.cachedSessionIds).toEqual([301, 302, 303]);
  });

  it("切回已缓存的 session 时把它移到末尾（LRU 更新）", () => {
    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({ currentSessionId, maxCached: 5 }),
      { initialProps: 301 },
    );

    rerender(302);
    rerender(303);
    // 切回 301，应移到末尾。
    rerender(301);

    expect(result.current.cachedSessionIds).toEqual([302, 303, 301]);
  });

  it("超过上限时淘汰最久未访问的 session（LRU 淘汰）", () => {
    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({ currentSessionId, maxCached: 3 }),
      { initialProps: 301 },
    );

    rerender(302);
    rerender(303);
    expect(result.current.cachedSessionIds).toEqual([301, 302, 303]);

    // 访问第 4 个 session，应淘汰最久未访问的 301。
    rerender(304);
    expect(result.current.cachedSessionIds).toEqual([302, 303, 304]);
    expect(result.current.cachedSessionIds).not.toContain(301);
  });

  it("currentSessionId 为 null 时不加入缓存", () => {
    const { result } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({ currentSessionId, maxCached: 5 }),
      { initialProps: null },
    );

    expect(result.current.cachedSessionIds).toEqual([]);
  });

  it("remove 从缓存中移除指定 session", () => {
    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({ currentSessionId, maxCached: 5 }),
      { initialProps: 301 },
    );

    rerender(302);
    rerender(303);
    expect(result.current.cachedSessionIds).toEqual([301, 302, 303]);

    act(() => {
      result.current.remove(302);
    });

    expect(result.current.cachedSessionIds).toEqual([301, 303]);
  });

  it("currentSessionId 从 null 切到有效值后能重新 touch", () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof useSessionPaneCache>,
      number | null
    >(
      (currentSessionId) =>
        useSessionPaneCache({ currentSessionId, maxCached: 5 }),
      { initialProps: null },
    );

    expect(result.current.cachedSessionIds).toEqual([]);

    rerender(301);
    expect(result.current.cachedSessionIds).toEqual([301]);
  });
});
