import * as React from "react";

export interface PageLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  header?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageLayout({
  children,
  title,
  subtitle,
  header,
  actions,
}: PageLayoutProps) {
  return (
    <div className="activity-surface p-[24px]">
      {(title || subtitle || header || actions) && (
        <div className="mb-[24px] flex items-start justify-between gap-[16px]">
          <div>
            {header}
            {title && <h1 className="text-[22px] font-[650] leading-[1.2]">{title}</h1>}
            {subtitle && (
              <p className="mt-[8px] text-[13px] text-[var(--color-text-muted)] leading-[1.45]">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-[8px]">{actions}</div>}
        </div>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
