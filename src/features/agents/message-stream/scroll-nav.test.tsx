import { act, renderHook } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useScrollNav } from "./scroll-nav";

interface ScrollBox {
  node: HTMLDivElement;
  scrollRef: RefObject<HTMLDivElement | null>;
  setScrollTop: (value: number) => void;
}

function createScrollBox(metrics: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}): ScrollBox {
  const node = document.createElement("div");
  let scrollTop = metrics.scrollTop;
  Object.defineProperty(node, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(node, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
  Object.defineProperty(node, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  return {
    node,
    scrollRef: createRef<HTMLDivElement>(),
    setScrollTop: (value: number) => {
      scrollTop = value;
    },
  };
}

function renderNav(box: ScrollBox) {
  box.scrollRef.current = box.node;
  return renderHook(() => useScrollNav(box.scrollRef));
}

describe("useScrollNav", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("打开时贴顶默认向下，贴底默认向上，中段默认向下", () => {
    const top = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 0,
    });
    const topNav = renderNav(top);
    act(() => {
      topNav.result.current.measureNav();
    });
    expect(topNav.result.current.navTarget).toBe("to-bottom");

    const middle = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 180,
    });
    const middleNav = renderNav(middle);
    act(() => {
      middleNav.result.current.measureNav();
    });
    expect(middleNav.result.current.navTarget).toBe("to-bottom");

    const bottom = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 400,
    });
    const bottomNav = renderNav(bottom);
    act(() => {
      bottomNav.result.current.measureNav();
    });
    expect(bottomNav.result.current.navTarget).toBe("to-top");

    const nearBottom = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 330,
    });
    const nearBottomNav = renderNav(nearBottom);
    act(() => {
      nearBottomNav.result.current.measureNav();
    });
    expect(nearBottomNav.result.current.navTarget).toBe("to-bottom");
  });

  it("向上滚动停稳后仍保持向上", () => {
    vi.useFakeTimers();
    const box = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 240,
    });
    const nav = renderNav(box);
    act(() => {
      nav.result.current.handleScroll(box.node);
    });
    box.setScrollTop(120);
    act(() => {
      nav.result.current.handleScroll(box.node);
    });

    expect(nav.result.current.navTarget).toBe("to-top");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(nav.result.current.navTarget).toBe("to-top");
  });

  it("向下滚动停稳后仍保持向下", () => {
    vi.useFakeTimers();
    const box = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 80,
    });
    const nav = renderNav(box);
    act(() => {
      nav.result.current.handleScroll(box.node);
    });
    box.setScrollTop(180);
    act(() => {
      nav.result.current.handleScroll(box.node);
    });

    expect(nav.result.current.navTarget).toBe("to-bottom");
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(nav.result.current.navTarget).toBe("to-bottom");
  });

  it("滚到顶部后无论刚才方向如何都向下", () => {
    const box = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 160,
    });
    const nav = renderNav(box);
    act(() => {
      nav.result.current.handleScroll(box.node);
    });
    box.setScrollTop(0);
    act(() => {
      nav.result.current.handleScroll(box.node);
    });

    expect(nav.result.current.navTarget).toBe("to-bottom");
  });

  it("滚到底部后无论刚才方向如何都向上", () => {
    const box = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 200,
    });
    const nav = renderNav(box);
    act(() => {
      nav.result.current.handleScroll(box.node);
    });
    box.setScrollTop(400);
    act(() => {
      nav.result.current.handleScroll(box.node);
    });

    expect(nav.result.current.navTarget).toBe("to-top");
  });

  it("离开端点 2px 后仍跟随滚动方向，不把附近当成端点", () => {
    const nearTop = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 80,
    });
    const nearTopNav = renderNav(nearTop);
    act(() => {
      nearTopNav.result.current.handleScroll(nearTop.node);
    });
    nearTop.setScrollTop(2);
    act(() => {
      nearTopNav.result.current.handleScroll(nearTop.node);
    });
    expect(nearTopNav.result.current.navTarget).toBe("to-top");

    const nearBottom = createScrollBox({
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 200,
    });
    const nearBottomNav = renderNav(nearBottom);
    act(() => {
      nearBottomNav.result.current.handleScroll(nearBottom.node);
    });
    nearBottom.setScrollTop(398);
    act(() => {
      nearBottomNav.result.current.handleScroll(nearBottom.node);
    });
    expect(nearBottomNav.result.current.navTarget).toBe("to-bottom");
  });

  it("内容不足两屏时不显示", () => {
    const box = createScrollBox({
      clientHeight: 100,
      scrollHeight: 150,
      scrollTop: 0,
    });
    const nav = renderNav(box);
    act(() => {
      nav.result.current.measureNav();
    });
    expect(nav.result.current.navTarget).toBe("hidden");
  });
});
