import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface IssueSurfaceHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
  variant?: "activity" | "fullscreen" | "card";
  titleLevel?: 2 | 3;
  titleAsChild?: boolean;
  className?: string;
}

export function IssueSurfaceHeader({
  title,
  actions,
  variant = "card",
  titleLevel = 3,
  titleAsChild = false,
  className,
}: IssueSurfaceHeaderProps) {
  const titleClassName = "issue-surface-header__title";
  const titleNode = titleAsChild ? (
    title
  ) : titleLevel === 2 ? (
    <h2 className={titleClassName}>{title}</h2>
  ) : (
    <h3 className={titleClassName}>{title}</h3>
  );

  return (
    <header
      className={cn(
        "issue-surface-header",
        `issue-surface-header--${variant}`,
        className,
      )}
    >
      {titleNode}
      {actions ? (
        <div className="issue-surface-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}
