import * as React from "react";

import { cn } from "@/lib/utils";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, required, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "block text-[12px] font-[600] leading-[1.35] text-[var(--color-text)]",
        className,
      )}
      {...props}
    >
      {children}
      {required && <span className="ml-1 text-[var(--color-danger)]">*</span>}
    </label>
  ),
);

Label.displayName = "Label";
