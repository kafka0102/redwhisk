import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExpandableText } from "./expandable-text";

const LONG_TEXT = Array.from(
  { length: 12 },
  (_, index) => `第 ${index + 1} 行`,
).join("\n");

/** jsdom 不做布局，折叠判定所需的尺寸只能手工注入。 */
function mockContentMetrics(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number },
) {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => metrics.scrollHeight,
  });
}

describe("ExpandableText", () => {
  let resizeCallbacks: ResizeObserverCallback[] = [];

  beforeEach(() => {
    resizeCallbacks = [];
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }

      observe() {}

      unobserve() {}

      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderText() {
    const view = render(
      <ExpandableText
        className="test-text"
        text={LONG_TEXT}
        maxLines={5}
        expandLabel="展开更多"
        collapseLabel="收起"
      />,
    );
    const content = view.container.querySelector<HTMLElement>(".test-text");
    if (!content) {
      throw new Error("missing text container");
    }
    return { view, content };
  }

  function notifyResize() {
    act(() => {
      for (const callback of resizeCallbacks) {
        callback([], {} as ResizeObserver);
      }
    });
  }

  it("内容未超出折叠行数时不渲染切换按钮", () => {
    const { view, content } = renderText();
    mockContentMetrics(content, { clientHeight: 70, scrollHeight: 68 });
    notifyResize();

    expect(screen.queryByRole("button")).toBeNull();
    expect(content.textContent).toBe(LONG_TEXT);
    expect(view.container.querySelector(".test-text")?.className).toContain(
      "expandable-text__content--clamped",
    );
  });

  it("超出折叠行数时可展开并收起", () => {
    const { view, content } = renderText();
    mockContentMetrics(content, { clientHeight: 70, scrollHeight: 280 });
    notifyResize();

    const expandButton = screen.getByRole("button", { name: "展开更多" });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(expandButton);
    expect(
      view.container.querySelector(".expandable-text__content--clamped"),
    ).toBeNull();
    const collapseButton = screen.getByRole("button", { name: "收起" });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapseButton);
    expect(
      view.container.querySelector(".expandable-text__content--clamped"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "展开更多" }),
    ).toBeInTheDocument();
  });

  it("折叠态下容器尺寸变化会重新判定", () => {
    const { content } = renderText();
    mockContentMetrics(content, { clientHeight: 70, scrollHeight: 68 });
    notifyResize();
    expect(screen.queryByRole("button")).toBeNull();

    mockContentMetrics(content, { clientHeight: 70, scrollHeight: 280 });
    notifyResize();
    expect(
      screen.getByRole("button", { name: "展开更多" }),
    ).toBeInTheDocument();
  });
});
