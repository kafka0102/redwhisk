import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[var(--radius-control)] px-2 py-0.5 text-[11px] font-[600] leading-[1.35]",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-accent-muted)] text-[var(--color-accent)]",
        secondary:
          "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] border border-[var(--color-border)]",
        success:
          "bg-[rgba(36,148,71,0.1)] text-[var(--color-lane-review-marker)]",
        warning:
          "bg-[rgba(200,144,0,0.1)] text-[var(--color-lane-running-marker)]",
        danger:
          "bg-[var(--color-danger-muted)] text-[var(--color-danger)] border border-[var(--color-danger-border)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);

Badge.displayName = "Badge";
