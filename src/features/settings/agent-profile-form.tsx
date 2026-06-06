import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import {
  detectCodexCommand,
  saveAgentProfile,
  testAgentCommand,
  type AgentProfileRecord,
  type AgentScope,
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
        agentType: "codex",
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
            <span>Skill</span>
            <select
              aria-label="Default skill"
              className="settings-input"
              value={defaultSkill}
              onChange={(event) => setDefaultSkill(event.target.value)}
            >
              <option value="">—</option>
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
