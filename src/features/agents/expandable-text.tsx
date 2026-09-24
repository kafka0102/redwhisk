// 通用的「超过 N 行折叠 + 展开/收起」纯文本渲染件。
//
// 折叠判定基于实际布局（scrollHeight / clientHeight），容器宽度变化会重新判定，
// 因此不依赖调用方预先估算行数。当前由会话右侧栏 issue 描述与消息流用户消息共用。

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface ExpandableTextProps {
  /** 纯文本内容；文本容器会继承透传 className 的排版规则。 */
  text: string;
  /** 折叠时最多展示的行数，超出则在末行截断；默认 8 行。 */
  maxLines?: number;
  /** 未展开时的切换按钮文案。 */
  expandLabel: string;
  /** 已展开时的切换按钮文案。 */
  collapseLabel: string;
  /** 透传到文本容器的 className，承载既有排版规则。 */
  className?: string;
}

export function ExpandableText({
  text,
  maxLines = 8,
  expandLabel,
  collapseLabel,
  className,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 折叠态下判定内容是否真的超出 maxLines，决定是否显示切换按钮。
  useLayoutEffect(() => {
    if (expanded) {
      return;
    }
    const element = contentRef.current;
    if (element) {
      setClamped(element.scrollHeight > element.clientHeight + 1);
    }
  }, [expanded, maxLines, text]);

  // 容器宽度变化（窗口/侧栏 resize）会改变实际行数，需要重新判定。
  useEffect(() => {
    if (expanded || typeof ResizeObserver === "undefined") {
      return;
    }
    const element = contentRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setClamped(element.scrollHeight > element.clientHeight + 1);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, maxLines, text]);

  const showToggle = expanded || clamped;

  return (
    <div className="expandable-text">
      <div
        ref={contentRef}
        className={cn(
          className,
          !expanded && "expandable-text__content--clamped",
        )}
        style={!expanded ? { WebkitLineClamp: maxLines } : undefined}
      >
        {text}
      </div>
      {showToggle ? (
        <button
          type="button"
          className="expandable-text__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? collapseLabel : expandLabel}
        </button>
      ) : null}
    </div>
  );
}
