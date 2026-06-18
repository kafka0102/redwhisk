import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex w-full rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[8px] py-[6px] text-[13px] text-[var(--color-text)] outline-none transition-[color,background-color,border-color] placeholder:text-[var(--color-text-subtle)] disabled:cursor-not-allowed disabled:opacity-65 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";
