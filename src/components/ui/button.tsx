import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border text-[13px] font-[400] leading-[1.3] outline-none transition-[color,background-color,border-color] disabled:cursor-not-allowed disabled:opacity-65",
  {
    variants: {
      variant: {
        default:
          "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-app)]",
        outline:
          "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-muted)]",
        ghost:
          "border-transparent bg-transparent text-[var(--color-text)] hover:bg-[var(--color-accent-muted)]",
      },
      size: {
        default: "min-h-[30px] px-[10px] py-[5px]",
        sm: "min-h-[28px] px-2 text-[12px]",
        lg: "min-h-[36px] px-4",
        icon: "h-[30px] w-[30px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, variant, ...props }, ref) => (
    <button
      className={cn(
        buttonVariants({ variant, size }),
        "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);

Button.displayName = "Button";
