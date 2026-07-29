import { Settings, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import { formatHomePathForDisplay } from "../../shared/paths/home-path";
import {
  deleteProjectTerminalShortcutCommand,
  listProjectTerminalShortcutCommands,
  readProjectTerminalCwd,
  saveProjectTerminalShortcutCommand,
  writeProjectTerminal,
  type ProjectTerminalShortcutCommandRecord,
} from "./project-terminal-commands";
import { TerminalShortcutCommandsDialog } from "./terminal-shortcut-commands-dialog";

const TERMINAL_CWD_POLL_MS = 2_000;

interface ProjectTerminalStatusBarProps {
  projectId: number;
  sessionId: number;
  /** 插入常用命令后，菜单关闭时把焦点还给终端（含滚到底部）。 */
  focusTerminal?: () => void;
}

export function ProjectTerminalStatusBar({
  projectId,
  sessionId,
  focusTerminal,
}: ProjectTerminalStatusBarProps) {
  const { messages, t } = useI18n();
  const [commands, setCommands] = useState<
    ProjectTerminalShortcutCommandRecord[]
  >([]);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [currentCwd, setCurrentCwd] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  // 选择常用命令后，菜单关闭时把焦点还给终端，而不是默认回到触发按钮。
  const shouldFocusTerminalOnCloseRef = useRef(false);

  const refreshCommands = useCallback(async () => {
    setCommandError(null);
    try {
      const result = await listProjectTerminalShortcutCommands({ projectId });
      if (!isMountedRef.current) {
        return;
      }
      setCommands(result.commands);
    } catch (error: unknown) {
      if (isMountedRef.current) {
        setCommandError(getCommandErrorMessage(error, t));
      }
    }
  }, [projectId, t]);

  // 初次加载常用命令列表。
  useEffect(() => {
    isMountedRef.current = true;
    const timeoutId = window.setTimeout(() => {
      void refreshCommands();
    }, 0);
    return () => {
      isMountedRef.current = false;
      window.clearTimeout(timeoutId);
    };
  }, [refreshCommands]);

  // 轮询当前终端工作目录。
  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    async function pollCwd() {
      try {
        const result = await readProjectTerminalCwd({ projectId, sessionId });
        if (cancelled) {
          return;
        }
        setCurrentCwd(result.cwd);
      } catch {
        // cwd 查询失败时保持上次显示，避免底部路径闪烁。
      }
    }

    void pollCwd();
    const timer = window.setInterval(() => {
      void pollCwd();
    }, TERMINAL_CWD_POLL_MS);

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [projectId, sessionId]);

  async function handleRunCommand(command: string) {
    try {
      await writeProjectTerminal({ projectId, sessionId, data: command });
    } catch (error: unknown) {
      setCommandError(getCommandErrorMessage(error, t));
    }
  }

  function handleManageClick() {
    setManageDialogOpen(true);
  }

  async function handleSaveCommand(input: {
    id?: number;
    command: string;
    sortOrder: number;
  }) {
    await saveProjectTerminalShortcutCommand({
      id: input.id,
      projectId,
      command: input.command,
      sortOrder: input.sortOrder,
    });
    await refreshCommands();
  }

  async function handleDeleteCommand(id: number) {
    await deleteProjectTerminalShortcutCommand({ id });
    await refreshCommands();
  }

  const displayPath = currentCwd ? formatHomePathForDisplay(currentCwd) : "";

  return (
    <div
      className="project-terminal-status-bar"
      aria-label={messages.agentsFeature.terminalStatusBar}
      role="toolbar"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={messages.agentsFeature.shortcutCommands}
          className="project-terminal-status-bar__shortcut-trigger"
        >
          <TerminalSquare aria-hidden="true" size={13} strokeWidth={1.8} />
          <span>{messages.agentsFeature.shortcutCommands}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="project-terminal-status-bar__menu"
          finalFocus={() => {
            if (!shouldFocusTerminalOnCloseRef.current) {
              return true;
            }
            shouldFocusTerminalOnCloseRef.current = false;
            if (!focusTerminal) {
              return true;
            }
            focusTerminal();
            // 已自行聚焦终端，阻止菜单默认把焦点还回触发按钮。
            return false;
          }}
        >
          <DropdownMenuItem onClick={handleManageClick}>
            <Settings aria-hidden="true" size={13} strokeWidth={1.8} />
            {messages.agentsFeature.shortcutCommandsManage}
          </DropdownMenuItem>
          {commands.length > 0 ? (
            <>
              {commands.map((command) => (
                <DropdownMenuItem
                  key={command.id}
                  onClick={() => {
                    shouldFocusTerminalOnCloseRef.current = true;
                    void handleRunCommand(command.command);
                  }}
                >
                  <span className="project-terminal-status-bar__menu-command">
                    {command.command}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          ) : (
            <DropdownMenuItem disabled>
              {messages.agentsFeature.shortcutCommandsEmpty}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <span
        className="project-terminal-status-bar__path"
        aria-label={messages.agentsFeature.terminalCurrentPath}
        title={displayPath}
      >
        {displayPath || messages.agentsFeature.shortcutCommandsEmpty}
      </span>

      {commandError ? (
        <span
          className="project-terminal-status-bar__error"
          role="status"
          aria-label={messages.settings.status}
        >
          {commandError}
        </span>
      ) : null}

      {manageDialogOpen ? (
        <TerminalShortcutCommandsDialog
          commands={commands}
          onClose={() => {
            setManageDialogOpen(false);
          }}
          onSave={handleSaveCommand}
          onDelete={handleDeleteCommand}
        />
      ) : null}
    </div>
  );
}
