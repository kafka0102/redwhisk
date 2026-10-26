// 浮在滚动容器右下角的圆形跳转按钮；内容不足两屏时不渲染。

import { ArrowDown, ArrowUp } from "lucide-react";
import type { RefObject } from "react";

import { useI18n } from "../../../shared/i18n/i18n";
import type { ScrollNavTarget } from "./scroll-nav";

interface ScrollNavButtonProps {
  navTarget: ScrollNavTarget;
  scrollRef: RefObject<HTMLElement | null>;
}

export function ScrollNavButton({
  navTarget,
  scrollRef,
}: ScrollNavButtonProps) {
  const { messages } = useI18n();
  if (navTarget === "hidden") {
    return null;
  }
  return (
    <button
      type="button"
      className="agents-message-stream__nav"
      aria-label={
        navTarget === "to-bottom"
          ? messages.agentsFeature.scrollToBottom
          : messages.agentsFeature.scrollToTop
      }
      onClick={() => {
        const node = scrollRef.current;
        if (!node) {
          return;
        }
        const toTop = navTarget === "to-top";
        const reduceMotion =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        node.scrollTo({
          top: toTop ? 0 : node.scrollHeight,
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }}
    >
      {navTarget === "to-bottom" ? (
        <ArrowDown aria-hidden="true" size={16} strokeWidth={2} />
      ) : (
        <ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
      )}
    </button>
  );
}
