import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import {
  detectCodexCommand,
  saveAgentProfile,
  testAgentCommand,
  type AgentDisplayMode,
  type AgentProfileRecord,
  type AgentScope,
  type AgentType,
} from "./settings-commands";
import {
  getDisplayModeDefaults,
  resolveDisplayModeOnAgentTypeChange,
} from "./agent-display-mode";
import { SearchableSelect } from "./searchable-select";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useI18n } from "../../shared/i18n/i18n";
import { toast } from "../../shared/toast";

// ADR-0020：表单可选 agentType 固定为 codex/claude/opencode/grok 四项。
// claude_code 是前端 UI 别名（agent-visuals 视作 Claude），不在新建表单暴露。
const AGENT_TYPE_OPTIONS: ReadonlyArray<{ value: AgentType; label: string }> = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "grok", label: "Grok" },
];

// ADR-0020 决策 10：name 上限 20 字符（label 是 15，别混淆）。
const AGENT_NAME_MAX_LENGTH = 20;

interface AgentProfileFormProps {
  mode: "create" | "edit";
  scope: AgentScope;
  projectId: number | null;
  profile?: AgentProfileRecord | null;
  onCancel: () => void;
  onSaved: (profile: AgentProfileRecord) => void;
}

export function AgentProfileForm({
  mode,
  scope,
  projectId,
  profile,
  onCancel,
  onSaved,
}: AgentProfileFormProps) {
  const { messages, t } = useI18n();
  const [name, setName] = useState(() => profile?.name ?? "");
  const [agentType, setAgentType] = useState<AgentType>(
    () => profile?.agentType ?? "codex",
  );
  const [command, setCommand] = useState(() => profile?.command ?? "");
  const [scopeValue, setScopeValue] = useState<AgentScope>(
    () => profile?.scope ?? scope,
  );
  const [modeValue] = useState(() => profile?.mode ?? "full-access");
  const [dangerous] = useState(() => profile?.dangerous ?? true);
  const [promptTemplate] = useState(() => profile?.promptTemplate ?? "");
  // ADR-0020：displayMode/enabled。回填优先 profile，其次按 agentType 默认。
  const [displayMode, setDisplayMode] = useState<AgentDisplayMode>(() => {
    if (profile?.displayMode) return profile.displayMode;
    return getDisplayModeDefaults(profile?.agentType ?? "codex").defaultMode;
  });
  const [enabled, setEnabled] = useState<boolean>(
    () => profile?.enabled ?? true,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetecting, setIsDetecting] = useState(mode === "create" && !profile);

  useEffect(() => {
    if (mode !== "create" || profile) return;

    let isMounted = true;

    void detectCodexCommand()
      .then((result) => {
        if (!isMounted) return;
        const commandName = toCommandName(result.command);
        setCommand(commandName);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        toast.error(getCommandErrorMessage(error, t));
      })
      .finally(() => {
        if (isMounted) setIsDetecting(false);
      });

    return () => {
      isMounted = false;
    };
  }, [mode, profile, t]);

  useEffect(() => {
    if (!profile) return;

    const profileCommand = profile.command.trim();
    if (profileCommand.length === 0 || !/[\\/]/.test(profileCommand)) {
      return;
    }

    const commandName = toCommandName(profileCommand);
    if (commandName === profileCommand) {
      return;
    }

    let isMounted = true;
    void testAgentCommand({ command: commandName })
      .then(() => {
        if (!isMounted) return;
        setCommand(commandName);
      })
      .catch(() => {
        if (!isMounted) return;
      });

    return () => {
      isMounted = false;
    };
  }, [profile]);

  function handleAgentTypeChange(nextAgentType: AgentType) {
    setAgentType(nextAgentType);
    // 切 agentType 时同步调整 displayMode（grok 强制 tui；codex/claude/opencode 可保留 tui）。
    setDisplayMode((current) =>
      resolveDisplayModeOnAgentTypeChange(nextAgentType, current),
    );
  }

  async function handleTestCommand() {
    setIsTesting(true);
    setStatusMessage(null);

    try {
      const testedCommand = command.trim();
      const testedCommandName = toCommandName(testedCommand);
      await testAgentCommand({ command: testedCommand });
      toast.success(messages.settings.commandAvailable(testedCommandName));
    } catch (error: unknown) {
      toast.error(getCommandErrorMessage(error, t));
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // isNameTooLong 已在 isSubmitDisabled 中拦截，但 submit 仍可能被键盘 Enter
    // 触发；这里再保护一次以匹配表单契约。
    if (trimmedName.length > AGENT_NAME_MAX_LENGTH) {
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const effectiveProjectId = scopeValue === "project" ? projectId : null;
      const savedProfile = await saveAgentProfile({
        id: profile?.id,
        name,
        agentType,
        command,
        scope: scopeValue,
        projectId: effectiveProjectId,
        mode: modeValue,
        dangerous,
        defaultSkill: "",
        promptTemplate,
        displayMode,
        enabled,
      });
      onSaved(savedProfile);
    } catch (error: unknown) {
      setStatusMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsSaving(false);
    }
  }

  const trimmedName = name.trim();
  const trimmedCommand = command.trim();
  const isNameTooLong = trimmedName.length > AGENT_NAME_MAX_LENGTH;
  const nameError = isNameTooLong ? messages.settings.agentNameTooLong : null;
  const isSubmitDisabled =
    isSaving ||
    trimmedName.length === 0 ||
    trimmedCommand.length === 0 ||
    isNameTooLong;

  const dialogTitle =
    mode === "create"
      ? messages.settings.newAgent
      : messages.settings.editAgent;

  const displayModeDefaults = getDisplayModeDefaults(agentType);
  const displayModeOptions: ReadonlyArray<{
    value: AgentDisplayMode;
    label: string;
  }> = [
    { value: "json", label: messages.settings.displayModeJson },
    { value: "tui", label: messages.settings.displayModeTui },
  ];

  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <form
        className="issue-dialog issue-dialog--compact"
        aria-label={dialogTitle}
        aria-modal="true"
        role="dialog"
        onSubmit={handleSubmit}
      >
        <div className="issue-dialog__header">
          <h3>{dialogTitle}</h3>
          <button
            aria-label={messages.settings.close}
            className="issue-dialog__close"
            type="button"
            onClick={onCancel}
          >
            &times;
          </button>
        </div>

        <div className="agent-dialog__body">
          <div className="grid gap-1.5">
            <Label
              htmlFor="agent-profile-name"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.name}
            </Label>
            <Input
              id="agent-profile-name"
              aria-label={messages.settings.agentProfileName}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            {nameError ? (
              <span role="alert" className="text-xs text-destructive">
                {nameError}
              </span>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="agent-profile-type"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.type}
            </Label>
            <Select
              items={AGENT_TYPE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={agentType}
              onValueChange={(value) => {
                handleAgentTypeChange(value as AgentType);
              }}
            >
              <SelectTrigger
                id="agent-profile-type"
                aria-label={messages.settings.agentTypeLabel}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="agent-profile-command"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.command}
            </Label>
            <div className="agent-dialog__command-row">
              <Input
                id="agent-profile-command"
                aria-label={messages.settings.agentCommand}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
              />
              <button
                className="issues-button agent-dialog__test-button"
                type="button"
                disabled={isDetecting || isTesting || isSaving}
                onClick={handleTestCommand}
              >
                {isTesting
                  ? messages.settings.commandTesting
                  : messages.settings.commandTest}
              </button>
            </div>
          </div>

          {displayModeDefaults.canSwitch ? (
            <div className="grid gap-1.5">
              <Label
                htmlFor="agent-profile-display-mode"
                className="text-xs text-muted-foreground"
              >
                {messages.settings.displayMode}
              </Label>
              <Select
                items={displayModeOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={displayMode}
                onValueChange={(value) => {
                  setDisplayMode(value as AgentDisplayMode);
                }}
              >
                <SelectTrigger
                  id="agent-profile-display-mode"
                  aria-label={messages.settings.displayMode}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {displayModeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label
                htmlFor="agent-profile-display-mode-locked"
                className="text-xs text-muted-foreground"
              >
                {messages.settings.displayMode}
              </Label>
              <Input
                id="agent-profile-display-mode-locked"
                aria-label={messages.settings.displayMode}
                readOnly
                value={messages.settings.displayModeTuiLocked}
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label
              htmlFor="agent-profile-enabled"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.enabled}
            </Label>
            <Select
              items={[
                { value: "true", label: messages.settings.enabledYes },
                { value: "false", label: messages.settings.enabledNo },
              ]}
              value={enabled ? "true" : "false"}
              onValueChange={(value) => {
                setEnabled(value === "true");
              }}
            >
              <SelectTrigger
                id="agent-profile-enabled"
                aria-label={messages.settings.enabled}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">
                  {messages.settings.enabledYes}
                </SelectItem>
                <SelectItem value="false">
                  {messages.settings.enabledNo}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <SearchableSelect
            label={messages.settings.scope}
            ariaLabel={messages.settings.scope}
            value={scopeValue}
            options={[
              { value: "global", label: messages.settings.globalScope },
              { value: "project", label: messages.settings.projectScope },
            ]}
            onChange={(nextScope) => {
              setScopeValue(nextScope as AgentScope);
            }}
          />
        </div>

        {statusMessage ? (
          <p
            className="issue-dialog__status"
            role="status"
            aria-label={messages.settings.status}
          >
            {statusMessage}
          </p>
        ) : null}

        <div className="issue-dialog__footer issue-dialog__footer--end">
          <button
            className="issues-button issues-button--primary"
            type="submit"
            disabled={isSubmitDisabled}
          >
            {isSaving ? messages.settings.saving : messages.settings.save}
          </button>
        </div>
      </form>
    </div>
  );
}

function toCommandName(commandPath: string): string {
  const trimmedCommand = commandPath.trim();
  if (trimmedCommand.length === 0) return "";
  const normalizedCommand = trimmedCommand.replace(/\\/g, "/");
  const commandParts = normalizedCommand.split("/").filter(Boolean);
  return commandParts[commandParts.length - 1] ?? trimmedCommand;
}
