import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [modeValue, setModeValue] = useState(
    () => profile?.mode ?? "full-auto",
  );
  const [dangerous, setDangerous] = useState(() => profile?.dangerous ?? true);
  const [defaultSkill, setDefaultSkill] = useState(
    () => profile?.defaultSkill ?? "",
  );
  const [promptTemplate, setPromptTemplate] = useState(
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

  const skillProjectId = scope === "project" ? projectId : null;

  const loadSkills = useCallback(() => {
    setIsLoadingSkills(true);
    setSkillLoadFailed(false);

    return listAgentSkills({
      agentType,
      projectId: skillProjectId,
    })
      .then((response) => {
        setSkills(response.skills);
        setSkillLoadFailed(false);
      })
      .catch(() => {
        setSkills([]);
        setSkillLoadFailed(true);
      })
      .finally(() => {
        setIsLoadingSkills(false);
      });
  }, [agentType, skillProjectId]);

  useEffect(() => {
    if (mode !== "create" || profile) return;

    let isMounted = true;

    void detectCodexCommand()
      .then((result) => {
        if (!isMounted) return;
        setCommand(result.command);
        setStatusMessage(`Detected: ${result.command}`);
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

  const projectSkills = useMemo(
    () => skills.filter((skill) => skill.scope === "project"),
    [skills],
  );
  const globalSkills = useMemo(
    () => skills.filter((skill) => skill.scope === "global"),
    [skills],
  );
  const skillNameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skills) {
      counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
    }
    return counts;
  }, [skills]);
  const isSelectedSkillMissing =
    defaultSkill.length > 0 &&
    !skills.some((skill) => skill.name === defaultSkill);

  async function handleTestCommand() {
    setIsTesting(true);
    setStatusMessage(null);

    try {
      const result = await testAgentCommand({ command });
      setCommand(result.command);
      setStatusMessage(`Command available: ${result.command}`);
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
      const savedProfile = await saveAgentProfile({
        id: profile?.id,
        name,
        agentType,
        command,
        scope,
        projectId,
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
    mode === "create"
      ? `Add ${scope === "project" ? "Project" : "Global"} Agent`
      : "Edit Agent";

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
            <span>Command</span>
            <input
              aria-label="Agent command"
              className="settings-input"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
            />
          </label>

          <div className="settings-form__actions-row">
            <button
              className="issues-button"
              type="button"
              disabled={isDetecting || isSaving}
              onClick={() => {
                setStatusMessage(null);
                setIsDetecting(true);
                void detectCodexCommand()
                  .then((result) => {
                    setCommand(result.command);
                    setStatusMessage(`Detected: ${result.command}`);
                  })
                  .catch((error: unknown) => {
                    setStatusMessage(toCommandError(error).message);
                  })
                  .finally(() => {
                    setIsDetecting(false);
                  });
              }}
            >
              {isDetecting ? "Detecting..." : "Detect"}
            </button>
            <button
              className="issues-button"
              type="button"
              disabled={isTesting || isSaving}
              onClick={handleTestCommand}
            >
              {isTesting ? "Testing..." : "Test"}
            </button>
          </div>

          <label className="settings-field">
            <span>Agent Type</span>
            <select
              aria-label="Agent type"
              className="settings-input"
              value={agentType}
              onChange={(event) => {
                setAgentType(event.target.value as AgentType);
                setDefaultSkill("");
              }}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
          </label>

          <label className="settings-field">
            <span>Skill</span>
            <select
              aria-label="Default skill"
              className="settings-input"
              value={defaultSkill}
              onChange={(event) => setDefaultSkill(event.target.value)}
            >
              <option value="">—</option>
              {isSelectedSkillMissing ? (
                <option value={defaultSkill}>{defaultSkill}</option>
              ) : null}
              {projectSkills.length > 0 ? (
                <optgroup label="Project">
                  {projectSkills.map((skill) => (
                    <option key={skill.path} value={skill.name}>
                      {formatSkillOption(skill, skillNameCounts)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {globalSkills.length > 0 ? (
                <optgroup label="Global">
                  {globalSkills.map((skill) => (
                    <option key={skill.path} value={skill.name}>
                      {formatSkillOption(skill, skillNameCounts)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {isLoadingSkills ? (
                <option disabled value="__loading">
                  Loading skills...
                </option>
              ) : null}
              {!isLoadingSkills && skills.length === 0 ? (
                <option disabled value="__empty">
                  No skills
                </option>
              ) : null}
              {skillLoadFailed ? (
                <option disabled value="__failed">
                  Skill load failed
                </option>
              ) : null}
            </select>
          </label>

          <label className="settings-field">
            <span>使用模式</span>
            <select
              aria-label="Mode"
              className="settings-input"
              value={modeValue}
              onChange={(event) => setModeValue(event.target.value)}
            >
              <option value="full-auto">Full Auto</option>
            </select>
          </label>

          <label className="settings-checkbox">
            <input
              aria-label="Dangerous"
              checked={dangerous}
              type="checkbox"
              onChange={(event) => setDangerous(event.target.checked)}
            />
            <span>启用 Dangerous 参数</span>
          </label>

          <label className="settings-field">
            <span>Prompt template</span>
            <textarea
              aria-label="Prompt template"
              className="settings-textarea"
              rows={4}
              value={promptTemplate}
              onChange={(event) => setPromptTemplate(event.target.value)}
            />
          </label>
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

function formatSkillOption(
  skill: AgentSkillRecord,
  nameCounts: Map<string, number>,
): string {
  if ((nameCounts.get(skill.name) ?? 0) <= 1) {
    return skill.name;
  }
  return `${skill.name} (${skill.path})`;
}
