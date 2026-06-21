import { GitBranch, X } from "lucide-react";
import type { ReactNode } from "react";

import { SessionDiffPlaceholder } from "./session-diff-placeholder";
import { SessionFilePreviewPlaceholder } from "./session-file-preview-placeholder";
import type {
  SessionWorkspaceChangeTab,
  SessionWorkspaceFileTab,
  SessionWorkspaceTabKind,
} from "./session-workspace-types";

interface SessionWorkspaceTabsProps {
  activeTab: SessionWorkspaceTabKind;
  changeTab: SessionWorkspaceChangeTab | null;
  fileTab: SessionWorkspaceFileTab | null;
  sessionContent: ReactNode;
  onCloseTab: (tab: Exclude<SessionWorkspaceTabKind, "session">) => void;
  onSelectTab: (tab: SessionWorkspaceTabKind) => void;
}

export function SessionWorkspaceTabs({
  activeTab,
  changeTab,
  fileTab,
  sessionContent,
  onCloseTab,
  onSelectTab,
}: SessionWorkspaceTabsProps) {
  const selectedTab = getSelectedTab(activeTab, fileTab, changeTab);

  return (
    <div className="session-workspace-tabs">
      <div className="session-workspace-tabs__list" role="tablist">
        <button
          aria-selected={selectedTab === "session"}
          className="session-workspace-tabs__tab"
          role="tab"
          type="button"
          onClick={() => onSelectTab("session")}
        >
          Session
        </button>
        {fileTab ? (
          <ClosableWorkspaceTab
            label={fileTab.fileName}
            selected={selectedTab === "file"}
            tab="file"
            onCloseTab={onCloseTab}
            onSelectTab={onSelectTab}
          />
        ) : null}
        {changeTab ? (
          <ClosableWorkspaceTab
            icon={<GitBranch aria-hidden="true" size={14} strokeWidth={1.8} />}
            label={changeTab.fileName}
            selected={selectedTab === "changes"}
            tab="changes"
            onCloseTab={onCloseTab}
            onSelectTab={onSelectTab}
          />
        ) : null}
      </div>
      <div className="session-workspace-tabs__content" role="tabpanel">
        {selectedTab === "file" && fileTab ? (
          <SessionFilePreviewPlaceholder file={fileTab} />
        ) : selectedTab === "changes" && changeTab ? (
          <SessionDiffPlaceholder file={changeTab} />
        ) : (
          sessionContent
        )}
      </div>
    </div>
  );
}

interface ClosableWorkspaceTabProps {
  icon?: ReactNode;
  label: string;
  selected: boolean;
  tab: Exclude<SessionWorkspaceTabKind, "session">;
  onCloseTab: (tab: Exclude<SessionWorkspaceTabKind, "session">) => void;
  onSelectTab: (tab: SessionWorkspaceTabKind) => void;
}

function ClosableWorkspaceTab({
  icon,
  label,
  selected,
  tab,
  onCloseTab,
  onSelectTab,
}: ClosableWorkspaceTabProps) {
  return (
    <span className="session-workspace-tabs__closable-tab">
      <button
        aria-selected={selected}
        className="session-workspace-tabs__tab"
        role="tab"
        type="button"
        onClick={() => onSelectTab(tab)}
      >
        {icon}
        <span className="session-workspace-tabs__label">{label}</span>
      </button>
      <button
        aria-label={`关闭 ${label}`}
        className="session-workspace-tabs__close"
        type="button"
        onClick={() => onCloseTab(tab)}
      >
        <X aria-hidden="true" size={13} strokeWidth={1.8} />
      </button>
    </span>
  );
}

function getSelectedTab(
  activeTab: SessionWorkspaceTabKind,
  fileTab: SessionWorkspaceFileTab | null,
  changeTab: SessionWorkspaceChangeTab | null,
): SessionWorkspaceTabKind {
  if (activeTab === "file" && fileTab) {
    return "file";
  }

  if (activeTab === "changes" && changeTab) {
    return "changes";
  }

  return "session";
}
