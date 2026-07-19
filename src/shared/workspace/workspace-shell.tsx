import { ChevronDown } from "lucide-react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui";
import type { CodeWorkspaceRoot } from "./workspace-commands";

interface WorkspaceShellProps {
  ariaLabel: string;
  /** 分支下拉未选中时的占位文案（如 messages.agentsFeature.loadingCode）。 */
  loadingBranchText: string;
  roots: CodeWorkspaceRoot[];
  selectedRoot: CodeWorkspaceRoot | null;
  onSelectRoot: (root: CodeWorkspaceRoot) => void;
  sidebarWidth: number;
  onBeginResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** 侧栏分支下拉之外的内容（code: 文件树；changes: 变更面板）。 */
  sidebar: ReactNode;
  /** 主区内容（code: tabs+编辑器；changes: diff 查看器）。 */
  main: ReactNode;
}

/**
 * 代码 / 变更两个 Activity 共享的无状态两栏布局：左侧分支下拉 + sidebar slot，
 * 右侧 main slot，中间可拖拽 splitter。复用既有 `code-workspace__*` CSS 类名。
 * 不持有任何跨 Activity 状态——roots / selectedRoot / onSelectRoot / sidebarWidth
 * 均由调用方（各自 Activity）传入。
 */
export function WorkspaceShell({
  ariaLabel,
  loadingBranchText,
  roots,
  selectedRoot,
  onSelectRoot,
  sidebarWidth,
  onBeginResize,
  sidebar,
  main,
}: WorkspaceShellProps) {
  return (
    <section
      className="code-workspace"
      aria-label={ariaLabel}
      style={{ "--code-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="code-workspace__sidebar">
        <div className="code-workspace__branch-bar">
          <DropdownMenu>
            <DropdownMenuTrigger className="code-workspace__branch">
              <span>{selectedRoot?.branch ?? loadingBranchText}</span>
              <ChevronDown aria-hidden="true" size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {roots.map((root) => (
                <DropdownMenuItem
                  key={root.path}
                  onClick={() => onSelectRoot(root)}
                >
                  {root.branch}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {sidebar}
      </aside>
      <div
        className="code-workspace__splitter"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={230}
        aria-valuemax={640}
        aria-valuenow={sidebarWidth}
        onMouseDown={onBeginResize}
      />
      <main className="code-workspace__main">{main}</main>
    </section>
  );
}
