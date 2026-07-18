import { GitBranch, Globe, Plus, Terminal, X } from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui";
import { SessionFileViewer } from "./session-file-viewer";
import { DiffViewer } from "../../../shared/workspace/diff-viewer";
import { useI18n } from "../../../shared/i18n/i18n";
import type { AgentType } from "../agent-session-commands";
import { getAgentLogoSrc } from "../agent-visuals";
import type {
  SessionWorkspaceChangeTab,
  SessionWorkspaceFileTab,
  SessionWorkspaceTabKind,
  SessionWorkspaceToolTabKind,
} from "./session-workspace-types";

export interface SessionWorkspaceToolTab {
  id: SessionWorkspaceToolTabKind;
  content: ReactNode;
  kind: "terminal" | "browser";
  label: string;
}

interface SessionWorkspaceTabsProps {
  activeTab: SessionWorkspaceTabKind;
  changeTab: SessionWorkspaceChangeTab | null;
  fileTab: SessionWorkspaceFileTab | null;
  sessionAgentType: AgentType;
  sessionContent: ReactNode;
  toolTabs: SessionWorkspaceToolTab[];
  onCloseTab: (tab: Exclude<SessionWorkspaceTabKind, "session">) => void;
  onCreateBrowserTab: () => void;
  onCreateTerminalTab: () => void;
  onSelectTab: (tab: SessionWorkspaceTabKind) => void;
}

export function SessionWorkspaceTabs({
  activeTab,
  changeTab,
  fileTab,
  sessionAgentType,
  sessionContent,
  toolTabs,
  onCloseTab,
  onCreateBrowserTab,
  onCreateTerminalTab,
  onSelectTab,
}: SessionWorkspaceTabsProps) {
  const { messages } = useI18n();
  const selectedTab = getSelectedTab(activeTab, fileTab, changeTab, toolTabs);

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
          <img
            alt=""
            aria-hidden="true"
            className="session-workspace-tabs__agent-icon"
            src={getAgentLogoSrc(sessionAgentType)}
          />
          {messages.agentsFeature.sessionTab}
        </button>
        {toolTabs.map((tab) => (
          <ClosableWorkspaceTab
            key={tab.id}
            closeLabel={messages.agentsFeature.closeTab(tab.label)}
            icon={
              tab.kind === "terminal" ? (
                <Terminal aria-hidden="true" size={14} strokeWidth={1.8} />
              ) : (
                <Globe aria-hidden="true" size={14} strokeWidth={1.8} />
              )
            }
            label={tab.label}
            selected={selectedTab === tab.id}
            tab={tab.id}
            onCloseTab={onCloseTab}
            onSelectTab={onSelectTab}
          />
        ))}
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
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={messages.agentsFeature.addSessionTool}
            className="session-workspace-tabs__add"
          >
            <Plus aria-hidden="true" size={14} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="session-workspace-tabs__menu"
          >
            <DropdownMenuItem onClick={onCreateTerminalTab}>
              <Terminal aria-hidden="true" size={14} strokeWidth={1.8} />
              {messages.agentsFeature.terminalTool}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateBrowserTab}>
              <Globe aria-hidden="true" size={14} strokeWidth={1.8} />
              {messages.agentsFeature.browserTool}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="session-workspace-tabs__content" role="tabpanel">
        {/* 常驻渲染所有 tab 内容，用 hidden 属性切换显隐。
            避免条件渲染导致切 tab 时 AgentSessionView / xterm / iframe 卸载重挂载，
            这是切 tab 主线程卡顿的根因（违反 agent-development-rules.md L153/L225
            「不得卸载结构化消息流」）。 */}
        {sessionContent ? (
          <div
            className="session-workspace-tabs__pane"
            hidden={selectedTab !== "session"}
          >
            {sessionContent}
          </div>
        ) : null}
        {toolTabs.map((tab) => (
          <div
            key={tab.id}
            className="session-workspace-tabs__pane"
            hidden={selectedTab !== tab.id}
          >
            {tab.content}
          </div>
        ))}
        {fileTab ? (
          <div
            className="session-workspace-tabs__pane"
            hidden={selectedTab !== "file"}
          >
            <SessionFileViewer tab={fileTab} />
          </div>
        ) : null}
        {changeTab ? (
          <div
            className="session-workspace-tabs__pane"
            hidden={selectedTab !== "changes"}
          >
            <DiffViewer tab={changeTab} />
          </div>
        ) : null}
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
    <span
      className={`session-workspace-tabs__closable-tab${
        selected ? " session-workspace-tabs__closable-tab--selected" : ""
      }`}
    >
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
  toolTabs: SessionWorkspaceToolTab[],
): SessionWorkspaceTabKind {
  if (activeTab === "file" && fileTab) {
    return "file";
  }

  if (activeTab === "changes" && changeTab) {
    return "changes";
  }

  if (toolTabs.some((tab) => tab.id === activeTab)) {
    return activeTab;
  }

  return "session";
}
