import * as React from "react";

export interface DialogLayoutProps {
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  size?: "sm" | "md" | "lg" | "xl";
  compact?: boolean;
}

const sizeClasses = {
  sm: "ds-dialog-sm",
  md: "ds-dialog-md",
  lg: "ds-dialog-lg",
  xl: "ds-dialog-xl",
};

export function DialogLayout({
  title,
  children,
  actions,
  onClose,
  size = "lg",
  compact = false,
}: DialogLayoutProps) {
  return (
    <div className="ds-dialog-overlay" role="presentation">
      <div
        className={`ds-dialog ${sizeClasses[size]} ${compact ? "ds-dialog-compact" : ""}`}
        role="dialog"
        aria-label={title}
        aria-modal="true"
      >
        <div className="ds-dialog-header">
          {title && <h3>{title}</h3>}
          {onClose && (
            <button
              className="ds-dialog-close"
              type="button"
              aria-label="Close dialog"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
        <div className="ds-dialog-body">{children}</div>
        {actions && <div className="ds-dialog-footer">{actions}</div>}
      </div>
    </div>
  );
}
