import * as React from "react";

export interface SplitLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
  leftWidth?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
}

export function SplitLayout({
  left,
  right,
  leftWidth = 230,
  minLeftWidth = 200,
  minRightWidth = 300,
}: SplitLayoutProps) {
  return (
    <div className="activity-surface p-0">
      <div className="ds-split-layout">
        <div
          className="ds-split-left"
          style={{ width: leftWidth, minWidth: minLeftWidth }}
        >
          {left}
        </div>
        <div className="ds-split-right" style={{ minWidth: minRightWidth }}>
          {right}
        </div>
      </div>
    </div>
  );
}
