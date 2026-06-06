import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  detectCodexCommand,
  saveAgentProfile,
  testAgentCommand,
  type AgentProfileRecord,
} from "./settings-commands";
import { toCommandError } from "../../shared/commands/command-error";

interface AgentProfileFormProps {
  mode: "create" | "edit";
  profile?: AgentProfileRecord | null;
  onCancel: () => void;
  onSaved: (profile: AgentProfileRecord) => void;
}

export function AgentProfileForm({
  mode,
  profile,
  onCancel,
  onSaved,
}: AgentProfileFormProps) {
  const [name, setName] = useState(() => profile?.name ?? "Codex");
  const [command, setCommand] = useState(() => profile?.command ?? "");
  const [defaultArgsText, setDefaultArgsText] = useState(
    () => profile?.defaultArgs.join("\n") ?? "",
  );
  const [defaultSkill, setDefaultSkill] = useState(
    () => profile?.defaultSkill ?? "",
  );
  const [promptTemplate, setPromptTemplate] = useState(
    () => profile?.promptTemplate ?? "",
  );
  const [enabled, setEnabled] = useState(() => profile?.enabled ?? false);
  const [statusMessage, setStatusMessage] = useState<string | null>(() =>
    mode === "create" && !profile ? "Detecting codex command..." : null,
  );
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetecting, setIsDetecting] = useState(mode === "create" && !profile);

  useEffect(() => {
    if (mode !== "create" || profile) {
      return;
    }

    let isMounted = true;

    void detectCodexCommand()
      .then((result) => {
        if (!isMounted) {
          return;
        }

        setCommand(result.command);
        setStatusMessage(`Detected codex command: ${result.command}`);
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setStatusMessage(toCommandError(error).message);
      })
      .finally(() => {
        if (isMounted) {
          setIsDetecting(false);
        }
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
      setStatusMessage(`Command is available: ${result.command}`);
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
        defaultArgs: toArgsArray(defaultArgsText),
        defaultSkill,
        promptTemplate,
        enabled,
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

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="settings-form__header">
        <div>
          <h4>
            {mode === "create" ? "New Codex Profile" : "Edit Agent Profile"}
          </h4>
          <p>
            Global profile settings apply across projects unless a project
            override replaces them.
          </p>
        </div>
      </div>

      <label className="settings-field">
        <span>Name</span>
        <Input
          aria-label="Agent profile name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="settings-field">
        <span>Command</span>
        <Input
          aria-label="Agent command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />
      </label>

      <div className="settings-form__actions-row">
        <Button
          className="issues-button"
          type="button"
          variant="outline"
          disabled={isDetecting || isSaving}
          onClick={() => {
            setStatusMessage(null);
            setIsDetecting(true);
            void detectCodexCommand()
              .then((result) => {
                setCommand(result.command);
                setStatusMessage(`Detected codex command: ${result.command}`);
              })
              .catch((error: unknown) => {
                setStatusMessage(toCommandError(error).message);
              })
              .finally(() => {
                setIsDetecting(false);
              });
          }}
        >
          {isDetecting ? "Detecting..." : "Detect codex"}
        </Button>
        <Button
          className="issues-button"
          type="button"
          variant="outline"
          disabled={isTesting || isSaving}
          onClick={handleTestCommand}
        >
          {isTesting ? "Testing..." : "Test command"}
        </Button>
      </div>

      <label className="settings-field">
        <span>Default args</span>
        <textarea
          aria-label="Default args"
          className="settings-textarea"
          rows={4}
          value={defaultArgsText}
          onChange={(event) => setDefaultArgsText(event.target.value)}
        />
      </label>

      <label className="settings-field">
        <span>Default skill</span>
        <Input
          aria-label="Default skill"
          value={defaultSkill}
          onChange={(event) => setDefaultSkill(event.target.value)}
        />
      </label>

      <label className="settings-field">
        <span>Prompt template</span>
        <textarea
          aria-label="Prompt template"
          className="settings-textarea"
          rows={6}
          value={promptTemplate}
          onChange={(event) => setPromptTemplate(event.target.value)}
        />
      </label>

      <label className="settings-checkbox">
        <input
          aria-label="Enabled"
          checked={enabled}
          type="checkbox"
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>Enabled</span>
      </label>

      <p
        className="settings-status"
        role="status"
        aria-label="Global profile status"
      >
        {statusMessage}
      </p>

      <div className="settings-form__actions-row settings-form__actions-row--footer">
        <Button
          className="issues-button"
          type="button"
          variant="outline"
          disabled={isSaving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          className="issues-button issues-button--primary"
          type="submit"
          disabled={isSubmitDisabled}
        >
          {isSaving ? "Saving..." : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

function toArgsArray(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
