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
  const [promptTemplate] = useState(
    () => profile?.promptTemplate ?? "",
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(() =>
    mode === "create" && !profile ? "Detecting codex command..." : null,
  );
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
        setStatusMessage(`Detected: ${commandName}`);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setStatusMessage(toCommandError(error).message);
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
  const isSelectedSkillMissing =
    defaultSkill.length > 0 &&
    !visibleSkills.some((skill) => skill.name === defaultSkill);

  async function handleTestCommand() {
    setIsTesting(true);
    setStatusMessage(null);

    try {
      const result = await testAgentCommand({ command });
      const commandName = toCommandName(result.command);
      setCommand(commandName);
      setStatusMessage(`Command available: ${commandName}`);
    } catch (error: unknown) {
      setStatusMessage(toCommandError(error).message);
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  const dialogTitle =
    mode === "create" ? "New agent" : "Edit Agent";

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

          <fieldset className="agent-dialog__fieldset">
            <legend>Scope</legend>
            <div className="agent-dialog__segmented-options">
              <label className="agent-dialog__radio-option">
                <input
                  checked={scopeValue === "global"}
                  name="agent-scope"
                  type="radio"
                  value="global"
                  onChange={() => {
                    setScopeValue("global");
                    setDefaultSkill("");
                    setSkills([]);
                    setSkillLoadFailed(false);
                  }}
                />
                <span>Global</span>
              </label>
              <label className="agent-dialog__radio-option">
                <input
                  checked={scopeValue === "project"}
                  name="agent-scope"
                  type="radio"
                  value="project"
                  onChange={() => {
                    setScopeValue("project");
                    setDefaultSkill("");
                    setSkills([]);
                    setSkillLoadFailed(false);
                  }}
                />
                <span>Project</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="agent-dialog__fieldset">
            <legend>Workflow Skill</legend>
            <div className="agent-dialog__skill-list">
              <label className="agent-dialog__skill-option">
                <input
                  checked={defaultSkill === ""}
                  name="default-skill"
                  type="radio"
                  value=""
                  onChange={() => setDefaultSkill("")}
                />
                <span className="agent-dialog__skill-name">None</span>
              </label>
              {isSelectedSkillMissing ? (
                <label className="agent-dialog__skill-option">
                  <input
                    checked
                    name="default-skill"
                    type="radio"
                    value={defaultSkill}
                    onChange={() => setDefaultSkill(defaultSkill)}
                  />
                  <span className="agent-dialog__skill-name">
                    {defaultSkill}
                  </span>
                </label>
              ) : null}
              {visibleSkills.map((skill) => (
                <label
                  className="agent-dialog__skill-option"
                  key={skill.path}
                >
                  <input
                    aria-label={`${skill.name} ${skill.path}`}
                    checked={defaultSkill === skill.name}
                    name="default-skill"
                    type="radio"
                    value={skill.name}
                    onChange={() => setDefaultSkill(skill.name)}
                  />
                  <span className="agent-dialog__skill-copy">
                    <span className="agent-dialog__skill-name">
                      {skill.name}
                    </span>
                    <span className="agent-dialog__skill-path">
                      {skill.path}
                    </span>
                  </span>
                </label>
              ))}
              {isLoadingSkills ? (
                <p className="agent-dialog__skill-status">Loading skills...</p>
              ) : null}
              {!isLoadingSkills && visibleSkills.length === 0 ? (
                <p className="agent-dialog__skill-status">No skills</p>
              ) : null}
              {skillLoadFailed ? (
                <p className="agent-dialog__skill-status">
                  Skill load failed
                </p>
              ) : null}
            </div>
          </fieldset>
        </div>

        <p
          className="issue-dialog__status"
          role="status"
          aria-label="Agent profile status"
        >
          {statusMessage}
        </p>

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
      </form>
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
