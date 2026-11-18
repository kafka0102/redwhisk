// 长内容滚动跳转按钮的显隐与方向判定：消息流与归档回看共用。
//
// 内容超过两屏时显示。还没滚动时：贴顶和中段默认向下，贴底默认向上。
// 一旦滚动，停稳后仍保持这次的方向。只有真正到顶才一律向下，真正到底才一律向上。

import { useCallback, useRef, useState, type RefObject } from "react";

/** 距底部阈值（px），小于此值视为"贴底"。供消息流跟随新内容，不决定箭头方向。 */
export const PIN_TO_BOTTOM_THRESHOLD_PX = 80;

/** 贴住内容端点的容差（px）。只有真正到顶或到底才覆盖滚动方向。 */
const SCROLL_EDGE_THRESHOLD_PX = 1;

/** 长内容跳转按钮的方向；hidden 时不渲染按钮。 */
export type ScrollNavTarget = "hidden" | "to-bottom" | "to-top";

/** 最近一次滚动方向；null 表示打开后还没有滚动。 */
type ScrollDirection = "down" | "up" | null;

interface ScrollNavState {
  navTarget: ScrollNavTarget;
  /** 内容变化后重新测量按钮方向。 */
  measureNav: () => void;
  /** 供滚动容器 onScroll 调用：记录方向并刷新按钮。 */
  handleScroll: (node: HTMLElement) => void;
}

/** 长内容跳转按钮的显隐状态与滚动方向判定。 */
export function useScrollNav(
  scrollRef: RefObject<HTMLElement | null>,
): ScrollNavState {
  const [navTarget, setNavTarget] = useState<ScrollNavTarget>("hidden");
  const lastScrollTopRef = useRef<number | null>(null);
  const scrollDirectionRef = useRef<ScrollDirection>(null);

  const measureNav = useCallback(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    const { scrollHeight, clientHeight, scrollTop } = node;
    const longEnough = scrollHeight > clientHeight * 2;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const direction = scrollDirectionRef.current;
    let next: ScrollNavTarget = "hidden";
    if (longEnough) {
      const atTop = scrollTop <= SCROLL_EDGE_THRESHOLD_PX;
      const atBottom = distanceFromBottom <= SCROLL_EDGE_THRESHOLD_PX;
      if (atTop) {
        next = "to-bottom";
      } else if (atBottom) {
        next = "to-top";
      } else if (direction === "up") {
        next = "to-top";
      } else {
        next = "to-bottom";
      }
    }
    setNavTarget((prev) => (prev === next ? prev : next));
  }, [scrollRef]);

  const handleScroll = useCallback(
    (node: HTMLElement) => {
      // 位置真正变化时才更新方向；同位置的重复事件保留上一次方向。
      const previousTop = lastScrollTopRef.current;
      lastScrollTopRef.current = node.scrollTop;
      if (previousTop !== null && node.scrollTop !== previousTop) {
        scrollDirectionRef.current =
          node.scrollTop > previousTop ? "down" : "up";
      }
      measureNav();
    },
    [measureNav],
  );

  return { navTarget, measureNav, handleScroll };
}
