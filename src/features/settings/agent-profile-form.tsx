import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  detectCodexCommand,
  listAgentSkills,
  saveAgentProfile,
  testAgentCommand,
  type AgentSkillRecord,
  type AgentSkillsUpdatedEvent,
  type AgentProfileRecord,
  type AgentScope,
  type AgentType,
} from "./settings-commands";
import { toCommandError } from "../../shared/commands/command-error";

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
  const [name, setName] = useState(() => profile?.name ?? "");
  const [agentType, setAgentType] = useState<AgentType>(
    () => profile?.agentType ?? "codex",
  );
  const [command, setCommand] = useState(() => profile?.command ?? "");
  const [scopeValue, setScopeValue] = useState<AgentScope>(
    () => profile?.scope ?? scope,
  );
  const [modeValue] = useState(() => profile?.mode ?? "default");
  const [dangerous] = useState(() => profile?.dangerous ?? true);
  const [defaultSkill, setDefaultSkill] = useState(
    () => profile?.defaultSkill ?? "",
  );
  const [selectedSkillPath, setSelectedSkillPath] = useState("");
  const [promptTemplate] = useState(() => profile?.promptTemplate ?? "");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetecting, setIsDetecting] = useState(mode === "create" && !profile);
  const [skills, setSkills] = useState<AgentSkillRecord[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillLoadFailed, setSkillLoadFailed] = useState(false);
  const isMountedRef = useRef(true);
  const skillRequestSequenceRef = useRef(0);

  const skillProjectId = scopeValue === "project" ? projectId : null;

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

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      skillRequestSequenceRef.current += 1;
    };
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
        setToastMessage(toCommandError(error).message);
      })
      .finally(() => {
        if (isMounted) setIsDetecting(false);
      });

    return () => {
      isMounted = false;
    };
  }, [mode, profile]);

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
  const resolvedSelectedSkillPath = useMemo(() => {
    if (defaultSkill.length === 0) return "";

    if (
      selectedSkillPath.length > 0 &&
      visibleSkills.some(
        (skill) =>
          skill.path === selectedSkillPath && skill.name === defaultSkill,
      )
    ) {
      return selectedSkillPath;
    }

    const matchingSkill = visibleSkills.find(
      (skill) => skill.name === defaultSkill,
    );
    return matchingSkill?.path ?? "";
  }, [defaultSkill, selectedSkillPath, visibleSkills]);

  const isSelectedSkillMissing =
    defaultSkill.length > 0 && resolvedSelectedSkillPath.length === 0;

  const workflowSkillOptions = useMemo(() => {
    const options: SearchableSelectOption[] = [{ value: "", label: "None" }];

    if (isSelectedSkillMissing) {
      options.push({
        value: `missing:${defaultSkill}`,
        label: defaultSkill,
      });
    }

    visibleSkills.forEach((skill) => {
      options.push({
        value: skill.path,
        label: skill.name,
        description: skill.path,
      });
    });

    return options;
  }, [defaultSkill, isSelectedSkillMissing, visibleSkills]);

  const workflowSkillValue = isSelectedSkillMissing
    ? `missing:${defaultSkill}`
    : resolvedSelectedSkillPath;

  async function handleTestCommand() {
    setIsTesting(true);
    setStatusMessage(null);
    setToastMessage(null);

    try {
      await testAgentCommand({ command });
      setToastMessage(`Command available: ${command}`);
    } catch (error: unknown) {
      setToastMessage(toCommandError(error).message);
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
        defaultSkill,
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
          <label className="settings-field">
            <span>Name</span>
            <input
              aria-label="Agent profile name"
              className="settings-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="settings-field">
            <span>Type</span>
            <select
              aria-label="Agent type"
              className="settings-input"
              value={agentType}
              onChange={(event) => {
                skillRequestSequenceRef.current += 1;
                setAgentType(event.target.value as AgentType);
                setDefaultSkill("");
                setSelectedSkillPath("");
                setSkills([]);
                setSkillLoadFailed(false);
              }}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </label>

          <label className="settings-field">
            <span>Command</span>
            <div className="agent-dialog__command-row">
              <input
                aria-label="Agent command"
                className="settings-input"
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
          </label>

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
              setDefaultSkill("");
              setSelectedSkillPath("");
              setSkills([]);
              setSkillLoadFailed(false);
            }}
          />

          <div className="agent-dialog__select-block">
            <SearchableSelect
              label="Workflow Skill"
              ariaLabel="Workflow Skill"
              value={workflowSkillValue}
              options={workflowSkillOptions}
              onChange={(nextSkillPath) => {
                if (nextSkillPath === "") {
                  setDefaultSkill("");
                  setSelectedSkillPath("");
                  return;
                }

                const selectedSkill = visibleSkills.find(
                  (skill) => skill.path === nextSkillPath,
                );
                if (!selectedSkill) {
                  setSelectedSkillPath("");
                  return;
                }

                setDefaultSkill(selectedSkill.name);
                setSelectedSkillPath(selectedSkill.path);
              }}
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

        <div className="issue-dialog__footer">
          <button
            className="issues-button"
            type="button"
            disabled={isSaving}
            onClick={onCancel}
          >
            Cancel
          </button>
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
            {toastMessage}
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
