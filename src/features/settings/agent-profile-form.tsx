import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  detectCodexCommand,
  saveAgentProfile,
  testAgentCommand,
  type AgentProfileRecord,
  type AgentScope,
  type AgentType,
} from "./settings-commands";
import { toCommandError } from "../../shared/commands/command-error";
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
  const { messages } = useI18n();
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetecting, setIsDetecting] = useState(mode === "create" && !profile);
  const toastTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 5000);
  }, []);

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
        showToast(toCommandError(error).message);
      })
      .finally(() => {
        if (isMounted) setIsDetecting(false);
      });

    return () => {
      isMounted = false;
    };
  }, [mode, profile, showToast]);

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

  async function handleTestCommand() {
    setIsTesting(true);
    setStatusMessage(null);
    setToastMessage(null);

    try {
      const testedCommand = command.trim();
      const testedCommandName = toCommandName(testedCommand);
      await testAgentCommand({ command: testedCommand });
      showToast(messages.settings.commandAvailable(testedCommandName));
    } catch (error: unknown) {
      showToast(toCommandError(error).message);
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatusMessage(null);
    setToastMessage(null);

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
      });
      onSaved(savedProfile);
    } catch (error: unknown) {
      setStatusMessage(toCommandError(error).message);
    } finally {
      setIsSaving(false);
    }
  }

  const isSubmitDisabled =
    isSaving || name.trim().length === 0 || command.trim().length === 0;

  const dialogTitle =
    mode === "create"
      ? messages.settings.newAgent
      : messages.settings.editAgent;

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
        className="issue-dialog"
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
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="agent-profile-type"
              className="text-xs text-muted-foreground"
            >
              {messages.settings.type}
            </Label>
            <Select
              items={[
                { value: "codex", label: "Codex" },
                { value: "claude", label: "Claude Code" },
              ]}
              value={agentType}
              onValueChange={(value) => {
                setAgentType(value as AgentType);
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
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="claude">Claude Code</SelectItem>
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

        {toastMessage ? (
          <div className="agent-dialog__toast" role="status" aria-live="polite">
            <span>{toastMessage}</span>
            <button
              aria-label={messages.settings.closeMessage}
              className="agent-dialog__toast-close"
              type="button"
              onClick={() => {
                if (toastTimeoutRef.current !== null) {
                  window.clearTimeout(toastTimeoutRef.current);
                  toastTimeoutRef.current = null;
                }
                setToastMessage(null);
              }}
            >
              &times;
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}

interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
}

function SearchableSelect({
  ariaLabel,
  label,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  label: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  value: string;
}) {
  const { messages } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value);
  const displayValue = isOpen ? query : (selectedOption?.label ?? "");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        option.label.toLowerCase().includes(normalizedQuery),
      )
    : options;

  function commitOption(option: SearchableSelectOption) {
    onChange(option.value);
    setQuery("");
    setIsOpen(false);
  }

  return (
    <div
      className="settings-search-select"
      ref={rootRef}
      onBlur={(event) => {
        if (rootRef.current?.contains(event.relatedTarget as Node | null)) {
          return;
        }

        setQuery("");
        setIsOpen(false);
      }}
    >
      <label className="settings-field">
        <span>{label}</span>
        <input
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-label={ariaLabel}
          autoCapitalize="none"
          className="settings-input settings-search-select__input"
          role="combobox"
          spellCheck={false}
          value={displayValue}
          onClick={() => {
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => {
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) =>
                Math.min(current + 1, filteredOptions.length - 1),
              );
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            }

            if (event.key === "Enter" && isOpen) {
              event.preventDefault();
              const option = filteredOptions[activeIndex];
              if (option) commitOption(option);
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setQuery("");
              setIsOpen(false);
            }
          }}
        />
      </label>
      {isOpen ? (
        <div className="settings-search-select__menu" role="listbox">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <button
                aria-selected={option.value === value}
                aria-label={
                  option.description
                    ? `${option.label} ${option.description}`
                    : option.label
                }
                className="settings-search-select__option"
                key={option.value}
                role="option"
                tabIndex={-1}
                type="button"
                data-active={index === activeIndex ? "true" : "false"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitOption(option)}
              >
                <span className="settings-search-select__option-label">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="settings-search-select__option-description">
                    {option.description}
                  </span>
                ) : null}
              </button>
            ))
          ) : (
            <p className="settings-search-select__empty">
              {messages.settings.noMatches}
            </p>
          )}
        </div>
      ) : null}
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
