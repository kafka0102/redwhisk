import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      className={cn(
        "flex w-full min-w-0 h-[32px] rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[8px] py-[6px] text-[13px] text-[var(--color-text)] outline-none transition-[color,background-color,border-color] placeholder:text-[var(--color-text-subtle)] disabled:cursor-not-allowed disabled:opacity-65 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
        className,
      )}
      ref={ref}
      type={type}
      {...props}
    />
  ),
);

Input.displayName = "Input";
