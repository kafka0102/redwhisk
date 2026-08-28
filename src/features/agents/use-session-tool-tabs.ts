import { useState } from "react";

import {
  closeProjectTerminal,
  createTemporaryProjectTerminal,
} from "../terminals/project-terminal-commands";
import {
  createDefaultSessionInlineTerminalPanelState,
  type SessionInlineTerminalPanelState,
} from "./session-workspace/session-inline-terminal-panel-state";
import type { SessionWorkspaceToolTabKind } from "./session-workspace/session-workspace-types";
import type { useSessionWorkspaceCache } from "./session-workspace/use-session-workspace-cache";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import type { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";

type Messages = ReturnType<typeof useI18n>["messages"];
type Translate = ReturnType<typeof useI18n>["t"];
type WorkspaceCache = ReturnType<typeof useSessionWorkspaceCache>;

const MAX_SESSION_TERMINAL_TABS = 10;

export interface SessionBrowserToolTab {
  id: number;
}

let terminalPanelStateBySessionIdStore: Record<
  number,
  SessionInlineTerminalPanelState
> = {};
let browserTabsBySessionIdStore: Record<number, SessionBrowserToolTab[]> = {};
let nextBrowserTabId = 1;

/**
 * 清空全部 session tool tab 状态。仅供测试隔离使用：module-level 单例会跨用例残留。
 */
export function clearSessionToolTabsCacheForTest(): void {
  terminalPanelStateBySessionIdStore = {};
  browserTabsBySessionIdStore = {};
  nextBrowserTabId = 1;
}

type CloseableWorkspaceTab = Exclude<
  SessionWorkspaceToolTabKind | "file" | "changes",
  "session"
>;

function isTerminalToolTab(
  tab: CloseableWorkspaceTab,
): tab is `terminal:${number}` {
  return tab.startsWith("terminal:");
}

function isBrowserToolTab(
  tab: CloseableWorkspaceTab,
): tab is `browser:${number}` {
  return tab.startsWith("browser:");
}

interface UseSessionToolTabsOptions {
  projectId: number;
  messages: Messages;
  t: Translate;
  workspaceCache: WorkspaceCache;
}

/**
 * agents-activity 的 inline terminal / browser tool tabs 状态机：
 * 每个 session 维护一组 terminal 面板状态与 browser 标签页，负责创建 / 关闭 /
 * 选中，并把选中态同步给 workspaceCache。terminal / browser 的 React 元素由
 * 容器的 sessionWorkspaces memo 持有（保证池化不卸载），本 hook 只管数据。
 * tab 列表存在 module-level，切走 Activity 再回来时仍能恢复。
 */
export function useSessionToolTabs({
  projectId,
  messages,
  t,
  workspaceCache,
}: UseSessionToolTabsOptions) {
  const [terminalPanelStateBySessionId, setTerminalPanelStateBySessionId] =
    useState<Record<number, SessionInlineTerminalPanelState>>(
      () => terminalPanelStateBySessionIdStore,
    );
  const [browserTabsBySessionId, setBrowserTabsBySessionId] = useState<
    Record<number, SessionBrowserToolTab[]>
  >(() => browserTabsBySessionIdStore);

  function setTerminalPanelState(
    sessionId: number,
    updater: (
      currentState: SessionInlineTerminalPanelState,
    ) => SessionInlineTerminalPanelState | null,
  ) {
    setTerminalPanelStateBySessionId((currentStateBySessionId) => {
      const currentState =
        currentStateBySessionId[sessionId] ??
        createDefaultSessionInlineTerminalPanelState();
      const nextState = updater(currentState);
      if (nextState === null) {
        const { [sessionId]: _removedState, ...remainingStateBySessionId } =
          currentStateBySessionId;
        terminalPanelStateBySessionIdStore = remainingStateBySessionId;
        return remainingStateBySessionId;
      }

      const nextStateBySessionId = {
        ...currentStateBySessionId,
        [sessionId]: nextState,
      };
      terminalPanelStateBySessionIdStore = nextStateBySessionId;
      return nextStateBySessionId;
    });
  }

  async function createInlineTerminal(agentSessionId: number) {
    const currentState = terminalPanelStateBySessionId[agentSessionId];
    if (currentState?.isCreating) {
      return;
    }

    if ((currentState?.terminals.length ?? 0) >= MAX_SESSION_TERMINAL_TABS) {
      toast.error(messages.agentsFeature.sessionTerminalLimit);
      return;
    }

    setTerminalPanelState(agentSessionId, (panelState) => ({
      ...panelState,
      errorMessage: null,
      isCreating: true,
    }));

    try {
      const terminal = await createTemporaryProjectTerminal({
        projectId,
        agentSessionId,
      });
      setTerminalPanelState(agentSessionId, (panelState) => ({
        ...panelState,
        activeTerminalSessionId: terminal.sessionId,
        errorMessage: null,
        isCreating: false,
        isMaximized: false,
        terminals: [
          ...panelState.terminals,
          {
            terminalSessionId: terminal.sessionId,
            name: terminal.name,
            workingDir: terminal.workingDir,
            launchCommand: terminal.launchCommand,
          },
        ],
      }));
      workspaceCache.selectWorkspaceTabForSession(
        agentSessionId,
        `terminal:${terminal.sessionId}`,
      );
    } catch (error) {
      toast.error(getCommandErrorMessage(error, t));
      setTerminalPanelState(agentSessionId, (panelState) => ({
        ...panelState,
        errorMessage: getCommandErrorMessage(error, t),
        isCreating: false,
      }));
    }
  }

  function handleOpenTerminalPanelForSession(sessionId: number) {
    void createInlineTerminal(sessionId);
  }

  function handleCreateBrowserTabForSession(sessionId: number) {
    const browserTab: SessionBrowserToolTab = {
      id: nextBrowserTabId,
    };
    nextBrowserTabId += 1;
    setBrowserTabsBySessionId((currentTabsBySessionId) => {
      const nextTabsBySessionId = {
        ...currentTabsBySessionId,
        [sessionId]: [...(currentTabsBySessionId[sessionId] ?? []), browserTab],
      };
      browserTabsBySessionIdStore = nextTabsBySessionId;
      return nextTabsBySessionId;
    });
    workspaceCache.selectWorkspaceTabForSession(
      sessionId,
      `browser:${browserTab.id}`,
    );
  }

  async function handleCloseInlineTerminal(
    agentSessionId: number,
    terminalSessionId: number,
  ) {
    setTerminalPanelState(agentSessionId, (panelState) => ({
      ...panelState,
      closingTerminalSessionIds: [
        ...panelState.closingTerminalSessionIds,
        terminalSessionId,
      ],
      errorMessage: null,
    }));

    try {
      await closeProjectTerminal({ projectId, sessionId: terminalSessionId });
      setTerminalPanelState(agentSessionId, (panelState) => {
        const remainingTerminals = panelState.terminals.filter(
          (terminal) => terminal.terminalSessionId !== terminalSessionId,
        );
        if (remainingTerminals.length === 0) {
          return null;
        }

        const activeTerminalSessionId =
          panelState.activeTerminalSessionId === terminalSessionId
            ? remainingTerminals[0].terminalSessionId
            : panelState.activeTerminalSessionId;

        return {
          ...panelState,
          activeTerminalSessionId,
          closingTerminalSessionIds:
            panelState.closingTerminalSessionIds.filter(
              (closingTerminalSessionId) =>
                closingTerminalSessionId !== terminalSessionId,
            ),
          terminals: remainingTerminals,
        };
      });
    } catch (error) {
      setTerminalPanelState(agentSessionId, (panelState) => ({
        ...panelState,
        closingTerminalSessionIds: panelState.closingTerminalSessionIds.filter(
          (closingTerminalSessionId) =>
            closingTerminalSessionId !== terminalSessionId,
        ),
        errorMessage: getCommandErrorMessage(error, t),
      }));
    }
  }

  function handleCloseWorkspaceTab(
    sessionId: number,
    tab: CloseableWorkspaceTab,
  ) {
    if (isTerminalToolTab(tab)) {
      void handleCloseInlineTerminal(
        sessionId,
        Number(tab.slice("terminal:".length)),
      );
      return;
    }

    if (isBrowserToolTab(tab)) {
      const browserTabId = Number(tab.slice("browser:".length));

      setBrowserTabsBySessionId((currentTabsBySessionId) => {
        const remainingTabs = (currentTabsBySessionId[sessionId] ?? []).filter(
          (browserTab) => browserTab.id !== browserTabId,
        );
        if (remainingTabs.length === 0) {
          const { [sessionId]: _removed, ...remaining } =
            currentTabsBySessionId;
          browserTabsBySessionIdStore = remaining;
          return remaining;
        }

        const nextTabsBySessionId = {
          ...currentTabsBySessionId,
          [sessionId]: remainingTabs,
        };
        browserTabsBySessionIdStore = nextTabsBySessionId;
        return nextTabsBySessionId;
      });
      const tabState = workspaceCache.getWorkspaceTabState(sessionId);
      if (tabState.activeWorkspaceTab === tab) {
        workspaceCache.selectWorkspaceTabForSession(sessionId, "session");
      }
      return;
    }

    workspaceCache.closeWorkspaceTabForSession(sessionId, tab);
  }

  /** 删除 session 时清掉它名下的 terminal / browser 标签页状态。 */
  function clearToolTabsForSession(sessionId: number) {
    setTerminalPanelStateBySessionId(
      ({ [sessionId]: _removedState, ...remainingState }) => {
        terminalPanelStateBySessionIdStore = remainingState;
        return remainingState;
      },
    );
    setBrowserTabsBySessionId(
      ({ [sessionId]: _removedState, ...remainingState }) => {
        browserTabsBySessionIdStore = remainingState;
        return remainingState;
      },
    );
  }

  return {
    terminalPanelStateBySessionId,
    browserTabsBySessionId,
    handleOpenTerminalPanelForSession,
    handleCreateBrowserTabForSession,
    handleCloseWorkspaceTab,
    clearToolTabsForSession,
  };
}
