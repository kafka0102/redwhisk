import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    className={cn(
      "flex min-h-8 w-full min-w-0 rounded-[var(--radius-card)] border border-input bg-background px-3 py-1.5 text-[13px] text-foreground outline-none transition-[color,background-color,border-color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-focus-offset)] disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    ref={ref}
    type={type}
    {...props}
  />
));

Input.displayName = "Input";
