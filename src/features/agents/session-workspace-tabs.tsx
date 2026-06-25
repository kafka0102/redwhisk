import { GitBranch, X } from "lucide-react";
import type { ReactNode } from "react";

import { SessionDiffViewer } from "./session-diff-viewer";
import { SessionFileViewer } from "./session-file-viewer";
import { useI18n } from "../../shared/i18n/i18n";
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
  const { messages } = useI18n();
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
          {messages.agentsFeature.sessionTab}
        </button>
        {fileTab ? (
          <ClosableWorkspaceTab
            closeLabel={messages.agentsFeature.closeTab(fileTab.fileName)}
            label={fileTab.fileName}
            selected={selectedTab === "file"}
            tab="file"
            onCloseTab={onCloseTab}
            onSelectTab={onSelectTab}
          />
        ) : null}
        {changeTab ? (
          <ClosableWorkspaceTab
            closeLabel={messages.agentsFeature.closeTab(changeTab.fileName)}
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
          <SessionFileViewer tab={fileTab} />
        ) : selectedTab === "changes" && changeTab ? (
          <SessionDiffViewer tab={changeTab} />
        ) : (
          sessionContent
        )}
      </div>
    </div>
  );
}

interface ClosableWorkspaceTabProps {
  closeLabel: string;
  icon?: ReactNode;
  label: string;
  selected: boolean;
  tab: Exclude<SessionWorkspaceTabKind, "session">;
  onCloseTab: (tab: Exclude<SessionWorkspaceTabKind, "session">) => void;
  onSelectTab: (tab: SessionWorkspaceTabKind) => void;
}

function ClosableWorkspaceTab({
  closeLabel,
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
        aria-label={closeLabel}
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
