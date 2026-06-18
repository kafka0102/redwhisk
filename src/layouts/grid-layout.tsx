import * as React from "react";

export interface GridLayoutProps {
  children: React.ReactNode;
  columns?: number;
  gap?: string;
  minItemWidth?: string;
}

export function GridLayout({
  children,
  columns,
  gap = "12px",
  minItemWidth = "260px",
}: GridLayoutProps) {
  const gridTemplateColumns = columns
    ? `repeat(${columns}, minmax(0, 1fr))`
    : `repeat(auto-fit, minmax(${minItemWidth}, 1fr))`;

  return (
    <div
      className="grid w-full"
      style={{
        gridTemplateColumns,
        gap,
      }}
    >
      {children}
    </div>
  );
}
