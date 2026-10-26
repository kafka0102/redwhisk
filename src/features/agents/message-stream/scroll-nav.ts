// 长内容滚动跳转按钮的显隐与方向判定：消息流与归档回看共用。
//
// 内容超过两屏时显示；滚动中按方向判定（下滚向下、上滚向上），停稳后按位置判定
// （未贴底显示向下，便于快速到底；贴底显示向上，便于快速到顶）。

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/** 距底部阈值（px），小于此值视为"贴底"。 */
export const PIN_TO_BOTTOM_THRESHOLD_PX = 80;

/** 滚动停稳判定（ms）：最后一次 scroll 事件后超过该时长视为静态。 */
export const SCROLL_IDLE_TIMEOUT_MS = 150;

/** 长内容跳转按钮的方向；hidden 时不渲染按钮。 */
export type ScrollNavTarget = "hidden" | "to-bottom" | "to-top";

/** 最近一次滚动方向；null 表示已停稳（静态）。 */
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
  const scrollIdleTimerRef = useRef<number | null>(null);

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
      if (direction === "down") {
        next = "to-bottom";
      } else if (direction === "up") {
        next = "to-top";
      } else {
        next =
          distanceFromBottom <= PIN_TO_BOTTOM_THRESHOLD_PX
            ? "to-top"
            : "to-bottom";
      }
    }
    setNavTarget((prev) => (prev === next ? prev : next));
  }, [scrollRef]);

  // 滚动停稳后退出方向判定，交回位置判定，避免箭头长期停留在方向结果上。
  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current !== null) {
        window.clearTimeout(scrollIdleTimerRef.current);
        scrollIdleTimerRef.current = null;
      }
    };
  }, []);

  const handleScroll = useCallback(
    (node: HTMLElement) => {
      // 位置真正变化时记录方向并重置停稳计时；同位置的重复事件不改变方向。
      const previousTop = lastScrollTopRef.current;
      lastScrollTopRef.current = node.scrollTop;
      if (previousTop !== null && node.scrollTop !== previousTop) {
        scrollDirectionRef.current =
          node.scrollTop > previousTop ? "down" : "up";
        if (scrollIdleTimerRef.current !== null) {
          window.clearTimeout(scrollIdleTimerRef.current);
        }
        scrollIdleTimerRef.current = window.setTimeout(() => {
          scrollIdleTimerRef.current = null;
          scrollDirectionRef.current = null;
          measureNav();
        }, SCROLL_IDLE_TIMEOUT_MS);
      }
      measureNav();
    },
    [measureNav],
  );

  return { navTarget, measureNav, handleScroll };
}
