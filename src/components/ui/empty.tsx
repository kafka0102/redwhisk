import * as React from "react";

import { cn } from "@/lib/utils";

export interface EmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
}

export const Empty = React.forwardRef<HTMLDivElement, EmptyProps>(
  ({ className, icon, title, description, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-6 text-center",
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="text-[var(--color-text-muted)]">
          {icon}
        </div>
      )}
      {title && (
        <h3 className="text-[13px] font-[650] leading-[1.32] text-[var(--color-text)]">
          {title}
        </h3>
      )}
      {description && (
        <p className="text-[12px] leading-[1.4] text-[var(--color-text-muted)]">
          {description}
        </p>
      )}
      {children}
    </div>
  ),
);

Empty.displayName = "Empty";
