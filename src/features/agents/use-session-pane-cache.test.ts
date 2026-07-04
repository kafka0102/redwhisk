import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSessionPaneCache } from "./use-session-pane-cache";

// 默认 isOpenSession：所有 session 视为 closed，可被正常 LRU 淘汰。
// 与历史行为等价，用于覆盖纯 LRU 路径的测试。
const allClosed = () => false;

describe("useSessionPaneCache", () => {
  it("将当前选中的 sessionId 同步加入缓存末尾", () => {
    const { result } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({
          currentSessionId,
          maxCached: 5,
          isOpenSession: allClosed,
        }),
      { initialProps: 301 },
    );

    // render 阶段同步 touch，首次渲染后 cachedSessionIds 即包含当前 session。
    expect(result.current.cachedSessionIds).toEqual([301]);
  });

  it("切换 session 时把新 session 移到末尾，保留历史 session", () => {
    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({
          currentSessionId,
          maxCached: 5,
          isOpenSession: allClosed,
        }),
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
        useSessionPaneCache({
          currentSessionId,
          maxCached: 5,
          isOpenSession: allClosed,
        }),
      { initialProps: 301 },
    );

    rerender(302);
    rerender(303);
    // 切回 301，应移到末尾。
    rerender(301);

    expect(result.current.cachedSessionIds).toEqual([302, 303, 301]);
  });

  it("超过上限时淘汰最久未访问的 closed session（LRU 淘汰）", () => {
    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({
          currentSessionId,
          maxCached: 3,
          isOpenSession: allClosed,
        }),
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
        useSessionPaneCache({
          currentSessionId,
          maxCached: 5,
          isOpenSession: allClosed,
        }),
      { initialProps: null },
    );

    expect(result.current.cachedSessionIds).toEqual([]);
  });

  it("remove 从缓存中移除指定 session", () => {
    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({
          currentSessionId,
          maxCached: 5,
          isOpenSession: allClosed,
        }),
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
        useSessionPaneCache({
          currentSessionId,
          maxCached: 5,
          isOpenSession: allClosed,
        }),
      { initialProps: null },
    );

    expect(result.current.cachedSessionIds).toEqual([]);

    rerender(301);
    expect(result.current.cachedSessionIds).toEqual([301]);
  });

  it("open session 即使最久未访问也不被淘汰", () => {
    // 301/302 为 running（open），303/304 为 closed。
    const openSessions = new Set<number>([301, 302]);
    const isOpenSession = (id: number) => openSessions.has(id);

    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({
          currentSessionId,
          maxCached: 3,
          isOpenSession,
        }),
      { initialProps: 301 },
    );

    rerender(302);
    rerender(303);
    expect(result.current.cachedSessionIds).toEqual([301, 302, 303]);

    // 访问第 4 个（closed）session：只能淘汰 closed 的 303，301/302 保留。
    rerender(304);
    expect(result.current.cachedSessionIds).toEqual([301, 302, 304]);
    expect(result.current.cachedSessionIds).not.toContain(303);
  });

  it("缓存全为 open 时超上限不强制淘汰", () => {
    // 全部 running：典型场景是同时开多个 claude code issue session。
    const isOpenSession = (id: number) => [301, 302, 303, 304].includes(id);

    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({
          currentSessionId,
          maxCached: 3,
          isOpenSession,
        }),
      { initialProps: 301 },
    );

    rerender(302);
    rerender(303);
    expect(result.current.cachedSessionIds).toEqual([301, 302, 303]);

    // 全为 open 时即使超上限也不淘汰——保证进程不被 kill。
    rerender(304);
    expect(result.current.cachedSessionIds).toEqual([301, 302, 303, 304]);
  });

  it("混合场景：优先淘汰最久未访问的 closed session", () => {
    // 301 open, 302 closed, 303 open, 304 closed
    const openSessions = new Set<number>([301, 303]);
    const isOpenSession = (id: number) => openSessions.has(id);

    const { result, rerender } = renderHook(
      (currentSessionId: number | null) =>
        useSessionPaneCache({
          currentSessionId,
          maxCached: 3,
          isOpenSession,
        }),
      { initialProps: 301 },
    );

    rerender(302); // [301(open), 302(closed)]
    rerender(303); // [301(open), 302(closed), 303(open)]
    expect(result.current.cachedSessionIds).toEqual([301, 302, 303]);

    // 访问 304(closed)：淘汰最久未访问的 closed = 302，open 的 301/303 保留。
    rerender(304);
    expect(result.current.cachedSessionIds).toEqual([301, 303, 304]);
    expect(result.current.cachedSessionIds).not.toContain(302);
  });
});
