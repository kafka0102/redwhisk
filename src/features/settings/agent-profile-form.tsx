import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  detectCodexCommand,
  listAgentSkills,
  saveAgentProfile,
  testAgentCommand,
  validateAgentWorktreePath,
  type AgentSkillRecord,
  type AgentSkillsUpdatedEvent,
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
import {
  parseDefaultSkills,
  serializeDefaultSkills,
} from "./agent-profile-skills";

interface AgentProfileFormProps {
  mode: "create" | "edit";
  scope: AgentScope;
  projectId: number | null;
  projectPath?: string;
  profile?: AgentProfileRecord | null;
  onCancel: () => void;
  onSaved: (profile: AgentProfileRecord) => void;
}

export function AgentProfileForm({
  mode,
  scope,
  projectId,
  projectPath = "",
  profile,
  onCancel,
  onSaved,
}: AgentProfileFormProps) {
  const defaultWorktreePath = buildDefaultWorktreePath(projectPath);
  const [name, setName] = useState(() => profile?.name ?? "");
  const [agentType, setAgentType] = useState<AgentType>(
    () => profile?.agentType ?? "codex",
  );
  const [command, setCommand] = useState(() => profile?.command ?? "");
  const [worktreePath, setWorktreePath] = useState(
    () => profile?.worktreePath ?? defaultWorktreePath,
  );
  const [scopeValue, setScopeValue] = useState<AgentScope>(
    () => profile?.scope ?? scope,
  );
  const [modeValue] = useState(() => profile?.mode ?? "default");
  const [dangerous] = useState(() => profile?.dangerous ?? true);
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<string[]>(() =>
    parseDefaultSkills(profile?.defaultSkill ?? "").map(toMissingSkillKey),
  );
  const [promptTemplate] = useState(() => profile?.promptTemplate ?? "");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidatingWorktreePath, setIsValidatingWorktreePath] =
    useState(false);
  const [worktreePathError, setWorktreePathError] = useState<string | null>(
    null,
  );
  const [isDetecting, setIsDetecting] = useState(mode === "create" && !profile);
  const [skills, setSkills] = useState<AgentSkillRecord[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillLoadFailed, setSkillLoadFailed] = useState(false);
  const isMountedRef = useRef(true);
  const skillRequestSequenceRef = useRef(0);
  const worktreePathValidationSequenceRef = useRef(0);
  const toastTimeoutRef = useRef<number | null>(null);
  const didEditWorktreePathRef = useRef(false);

  const skillProjectId = scopeValue === "project" ? projectId : null;
  const trimmedWorktreePath = worktreePath.trim();
  const isDefaultWorktreePath =
    trimmedWorktreePath.length > 0 &&
    defaultWorktreePath.length > 0 &&
    trimmedWorktreePath === defaultWorktreePath;
  const shouldSkipWorktreePathValidation =
    trimmedWorktreePath.length === 0 ||
    defaultWorktreePath.length === 0 ||
    isDefaultWorktreePath;

  const loadSkills = useCallback(() => {
    const requestSequence = skillRequestSequenceRef.current + 1;
    skillRequestSequenceRef.current = requestSequence;
    setIsLoadingSkills(true);
    setSkillLoadFailed(false);

    return listAgentSkills({
      agentType,
      projectId: skillProjectId,
    })
      .then((response) => {
        if (!isCurrentSkillRequest()) return;
        setSkills(response.skills);
        setSkillLoadFailed(false);
      })
      .catch(() => {
        if (!isCurrentSkillRequest()) return;
        setSkills([]);
        setSkillLoadFailed(true);
      })
      .finally(() => {
        if (!isCurrentSkillRequest()) return;
        setIsLoadingSkills(false);
      });

    function isCurrentSkillRequest() {
      return (
        isMountedRef.current &&
        skillRequestSequenceRef.current === requestSequence
      );
    }
  }, [agentType, skillProjectId]);

  const isCurrentValidationRequest = useCallback((requestSequence: number) => {
    return (
      isMountedRef.current &&
      worktreePathValidationSequenceRef.current === requestSequence
    );
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      skillRequestSequenceRef.current += 1;
      worktreePathValidationSequenceRef.current += 1;
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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSkills();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadSkills]);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void listen<AgentSkillsUpdatedEvent>("agent-skills-updated", (event) => {
      if (!shouldReloadSkillsForEvent(event.payload, skillProjectId)) return;
      void loadSkills();
    }).then((cleanup) => {
      if (isDisposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [loadSkills, skillProjectId]);

  const visibleSkills = useMemo(
    () => skills.filter((skill) => skill.scope === scopeValue),
    [skills, scopeValue],
  );
  const visibleSkillNames = useMemo(
    () => new Set(visibleSkills.map((skill) => skill.name)),
    [visibleSkills],
  );
  const effectiveSelectedSkillKeys = useMemo(
    () =>
      selectedSkillKeys.map((key) => {
        if (!isMissingSkillKey(key)) {
          return key;
        }

        const matchingSkill = visibleSkills.find(
          (skill) => skill.name === fromMissingSkillKey(key),
        );
        return matchingSkill?.path ?? key;
      }),
    [selectedSkillKeys, visibleSkills],
  );
  const selectedSkillNames = useMemo(
    () =>
      dedupeStrings(
        effectiveSelectedSkillKeys
          .map((key) => resolveSkillNameFromKey(key, visibleSkills))
          .filter((skillName) => skillName.length > 0),
      ),
    [effectiveSelectedSkillKeys, visibleSkills],
  );
  const missingSkillNames = useMemo(() => {
    const names = selectedSkillKeys
      .filter((key) => isMissingSkillKey(key))
      .map(fromMissingSkillKey);
    return dedupeStrings(
      names.filter((skillName) => !visibleSkillNames.has(skillName)),
    );
  }, [selectedSkillKeys, visibleSkillNames]);
  const workflowSkillOptions = useMemo(() => {
    const missingOptions = missingSkillNames.map((skillName) => ({
      value: toMissingSkillKey(skillName),
      label: skillName,
      description: "Unavailable in current scope",
    }));
    const visibleOptions = visibleSkills.map((skill) => ({
      value: skill.path,
      label: skill.name,
      description: skill.path,
    }));

    return dedupeOptionsByValue([...missingOptions, ...visibleOptions]);
  }, [missingSkillNames, visibleSkills]);

  async function handleTestCommand() {
    setIsTesting(true);
    setStatusMessage(null);
    setToastMessage(null);

    try {
      const testedCommand = command.trim();
      const testedCommandName = toCommandName(testedCommand);
      await testAgentCommand({ command: testedCommand });
      showToast(`Command available: ${testedCommandName}`);
    } catch (error: unknown) {
      showToast(toCommandError(error).message);
    } finally {
      setIsTesting(false);
    }
  }

  async function validateCustomWorktreePath(): Promise<boolean> {
    if (shouldSkipWorktreePathValidation) {
      setWorktreePathError(null);
      setIsValidatingWorktreePath(false);
      worktreePathValidationSequenceRef.current += 1;
      return true;
    }

    const requestSequence = worktreePathValidationSequenceRef.current + 1;
    worktreePathValidationSequenceRef.current = requestSequence;
    setIsValidatingWorktreePath(true);
    setWorktreePathError(null);

    try {
      const result = await validateAgentWorktreePath({
        path: trimmedWorktreePath,
      });
      if (!isCurrentValidationRequest(requestSequence)) {
        return false;
      }

      if (!result.exists) {
        setWorktreePathError("Worktree path does not exist.");
        return false;
      }

      setWorktreePathError(null);
      return true;
    } catch (error: unknown) {
      if (!isCurrentValidationRequest(requestSequence)) {
        return false;
      }

      setWorktreePathError(toCommandError(error).message);
      return false;
    } finally {
      if (isCurrentValidationRequest(requestSequence)) {
        setIsValidatingWorktreePath(false);
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isValidWorktreePath = await validateCustomWorktreePath();
    if (!isValidWorktreePath) {
      return;
    }
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
        worktreePath: trimmedWorktreePath,
        scope: scopeValue,
        projectId: effectiveProjectId,
        mode: modeValue,
        dangerous,
        defaultSkill: serializeDefaultSkills(selectedSkillNames),
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
    isSaving ||
    isValidatingWorktreePath ||
    worktreePathError !== null ||
    name.trim().length === 0 ||
    command.trim().length === 0;

  const dialogTitle = mode === "create" ? "New agent" : "Edit Agent";

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
            aria-label="Close"
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
              Name
            </Label>
            <Input
              id="agent-profile-name"
              aria-label="Agent profile name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="agent-profile-type"
              className="text-xs text-muted-foreground"
            >
              Type
            </Label>
            <Select
              items={[
                { value: "codex", label: "Codex" },
                { value: "claude", label: "Claude Code" },
              ]}
              value={agentType}
              onValueChange={(value) => {
                skillRequestSequenceRef.current += 1;
                setAgentType(value as AgentType);
                setSelectedSkillKeys([]);
                setSkills([]);
                setSkillLoadFailed(false);
              }}
            >
              <SelectTrigger
                id="agent-profile-type"
                aria-label="Agent type"
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
              Command
            </Label>
            <div className="agent-dialog__command-row">
              <Input
                id="agent-profile-command"
                aria-label="Agent command"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
              />
              <button
                className="issues-button agent-dialog__test-button"
                type="button"
                disabled={isDetecting || isTesting || isSaving}
                onClick={handleTestCommand}
              >
                {isTesting ? "测试中..." : "测试"}
              </button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label
              htmlFor="agent-profile-worktree-path"
              className="text-xs text-muted-foreground"
            >
              Worktree path
            </Label>
            <Input
              id="agent-profile-worktree-path"
              aria-label="Worktree path"
              value={worktreePath}
              onBlur={() => {
                if (!didEditWorktreePathRef.current) {
                  return;
                }
                void validateCustomWorktreePath();
              }}
              onChange={(event) => {
                didEditWorktreePathRef.current = true;
                setWorktreePath(event.target.value);
                if (worktreePathError !== null) {
                  setWorktreePathError(null);
                }
              }}
            />
            {isDefaultWorktreePath ? (
              <span className="text-xs text-muted-foreground">
                默认路径允许当前不存在，运行时会按需创建。
              </span>
            ) : null}
            {isValidatingWorktreePath ? (
              <span className="text-xs text-muted-foreground">
                校验路径中...
              </span>
            ) : null}
            {worktreePathError ? (
              <span role="alert" className="text-xs text-destructive">
                {worktreePathError}
              </span>
            ) : null}
          </div>

          <SearchableSelect
            label="Scope"
            ariaLabel="Scope"
            value={scopeValue}
            options={[
              { value: "global", label: "Global" },
              { value: "project", label: "Project" },
            ]}
            onChange={(nextScope) => {
              skillRequestSequenceRef.current += 1;
              setScopeValue(nextScope as AgentScope);
              setSelectedSkillKeys([]);
              setSkills([]);
              setSkillLoadFailed(false);
            }}
          />

          <div className="agent-dialog__select-block">
            <SearchableMultiSelect
              label="Workflow Skills"
              ariaLabel="Workflow Skills"
              values={effectiveSelectedSkillKeys}
              options={workflowSkillOptions}
              onChange={setSelectedSkillKeys}
            />
            <div className="agent-dialog__skill-list">
              {isLoadingSkills ? (
                <p className="agent-dialog__skill-status">Loading skills...</p>
              ) : null}
              {!isLoadingSkills && visibleSkills.length === 0 ? (
                <p className="agent-dialog__skill-status">No skills</p>
              ) : null}
              {skillLoadFailed ? (
                <p className="agent-dialog__skill-status">Skill load failed</p>
              ) : null}
            </div>
          </div>
        </div>

        {statusMessage ? (
          <p
            className="issue-dialog__status"
            role="status"
            aria-label="Agent profile status"
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
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>

        {toastMessage ? (
          <div className="agent-dialog__toast" role="status" aria-live="polite">
            <span>{toastMessage}</span>
            <button
              aria-label="Close message"
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

function buildDefaultWorktreePath(projectPath: string): string {
  const trimmedProjectPath = projectPath.trim();
  if (trimmedProjectPath.length === 0) {
    return "";
  }
  return `${trimmedProjectPath}.worktrees`;
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
          className="settings-input settings-search-select__input"
          role="combobox"
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
            <p className="settings-search-select__empty">No matches</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SearchableMultiSelect({
  ariaLabel,
  label,
  onChange,
  options,
  values,
}: {
  ariaLabel: string;
  label: string;
  onChange: (values: string[]) => void;
  options: SearchableSelectOption[];
  values: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        `${option.label} ${option.description ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : options;
  const selectedOptions = values
    .map((value) => options.find((option) => option.value === value))
    .filter((option): option is SearchableSelectOption => option !== undefined);
  const selectedValuesLabel =
    selectedOptions.length > 0
      ? selectedOptions.map((option) => option.label).join(", ")
      : "";
  const displayValue = isOpen ? query : selectedValuesLabel;

  function toggleOption(option: SearchableSelectOption) {
    const nextValues = values.includes(option.value)
      ? values.filter((value) => value !== option.value)
      : [...values, option.value];
    onChange(nextValues);
    setQuery("");
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
          className="settings-input settings-search-select__input"
          role="combobox"
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
              setIsOpen(true);
              setActiveIndex((current) => Math.max(current - 1, 0));
            }

            if (event.key === "Enter" && isOpen) {
              event.preventDefault();
              const option = filteredOptions[activeIndex];
              if (option) {
                toggleOption(option);
              }
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setQuery("");
              setIsOpen(false);
            }
          }}
        />
      </label>
      {selectedOptions.length > 0 ? (
        <div
          className="settings-search-select__chips"
          aria-label={`${ariaLabel} selected`}
        >
          {selectedOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="settings-search-select__chip"
              onClick={() => toggleOption(option)}
            >
              <span>{option.label}</span>
              <span aria-hidden="true">&times;</span>
            </button>
          ))}
        </div>
      ) : null}
      {isOpen ? (
        <div
          className="settings-search-select__menu settings-search-select__menu--top"
          role="listbox"
          aria-multiselectable="true"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => {
              const isSelected = values.includes(option.value);

              return (
                <button
                  aria-selected={isSelected}
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
                  onClick={() => toggleOption(option)}
                >
                  <span className="settings-search-select__option-row">
                    <span className="settings-search-select__option-label">
                      {option.label}
                    </span>
                    <span className="settings-search-select__option-check">
                      {isSelected ? "✓" : ""}
                    </span>
                  </span>
                  {option.description ? (
                    <span className="settings-search-select__option-description">
                      {option.description}
                    </span>
                  ) : null}
                </button>
              );
            })
          ) : (
            <p className="settings-search-select__empty">No matches</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function shouldReloadSkillsForEvent(
  event: AgentSkillsUpdatedEvent,
  projectId: number | null,
): boolean {
  if (event.scope === "global") return true;
  return projectId !== null && event.projectId === projectId;
}

function toCommandName(commandPath: string): string {
  const trimmedCommand = commandPath.trim();
  if (trimmedCommand.length === 0) return "";
  const normalizedCommand = trimmedCommand.replace(/\\/g, "/");
  const commandParts = normalizedCommand.split("/").filter(Boolean);
  return commandParts[commandParts.length - 1] ?? trimmedCommand;
}

function dedupeOptionsByValue(
  options: SearchableSelectOption[],
): SearchableSelectOption[] {
  const seenValues = new Set<string>();
  return options.filter((option) => {
    if (seenValues.has(option.value)) {
      return false;
    }

    seenValues.add(option.value);
    return true;
  });
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function resolveSkillNameFromKey(
  key: string,
  visibleSkills: AgentSkillRecord[],
): string {
  if (isMissingSkillKey(key)) {
    return fromMissingSkillKey(key);
  }

  return visibleSkills.find((skill) => skill.path === key)?.name ?? "";
}

function toMissingSkillKey(skillName: string): string {
  return `missing:${skillName}`;
}

function fromMissingSkillKey(key: string): string {
  return key.replace(/^missing:/, "");
}

function isMissingSkillKey(key: string): boolean {
  return key.startsWith("missing:");
}
