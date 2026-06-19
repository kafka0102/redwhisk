import { X } from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import type { ProjectTerminalCardState } from "./project-terminals-activity-state";
import { updateProjectTerminalConfig } from "./project-terminal-commands";

interface ProjectTerminalEditDialogProps {
  onClose: () => void;
  onSaved: (terminal: ProjectTerminalCardState) => void;
  projectId: number;
  terminal: ProjectTerminalCardState;
}

export function ProjectTerminalEditDialog({
  onClose,
  onSaved,
  projectId,
  terminal,
}: ProjectTerminalEditDialogProps) {
  const { messages } = useI18n();
  const [name, setName] = useState(terminal.name);
  const [workingDir, setWorkingDir] = useState(terminal.workingDir);
  const [launchCommand, setLaunchCommand] = useState(terminal.launchCommand);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = useMemo(
    () =>
      name !== terminal.name ||
      workingDir !== terminal.workingDir ||
      launchCommand !== terminal.launchCommand,
    [
      launchCommand,
      name,
      terminal.launchCommand,
      terminal.name,
      terminal.workingDir,
      workingDir,
    ],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    setStatusMessage(null);
    setIsSaving(true);

    try {
      const result = await updateProjectTerminalConfig({
        projectId,
        configId: terminal.configId,
        name,
        workingDir,
        launchCommand,
      });
      onSaved({
        configId: result.terminal.configId,
        sessionId: result.terminal.sessionId,
        name: result.terminal.name,
        workingDir: result.terminal.workingDir,
        launchCommand: result.terminal.launchCommand,
      });
    } catch (error: unknown) {
      setStatusMessage(toCommandError(error).message);
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        aria-label={messages.settings.editTerminal(terminal.name)}
        aria-modal="true"
        className="issue-dialog issue-dialog--compact terminal-edit-dialog"
        role="dialog"
        onKeyDown={handleKeyDown}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <div className="issue-dialog__header">
          <h3>{messages.settings.editTerminal(terminal.name)}</h3>
          <button
            aria-label={messages.settings.closeTerminalDialog}
            className="issue-dialog__close"
            type="button"
            onClick={onClose}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="issue-dialog__body issue-dialog__body--single terminal-edit-dialog__body">
          <div className="issue-dialog__editor">
            <div className="grid gap-1.5">
              <Label
                htmlFor="terminal-name"
                className="text-xs text-muted-foreground"
              >
                {messages.settings.name}
              </Label>
              <Input
                id="terminal-name"
                aria-label={messages.settings.name}
                disabled={isSaving}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor="terminal-path"
                className="text-xs text-muted-foreground"
              >
                {messages.settings.terminalPath}
              </Label>
              <Input
                id="terminal-path"
                aria-label={messages.settings.terminalPath}
                disabled={isSaving}
                value={workingDir}
                onChange={(event) => setWorkingDir(event.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor="terminal-command"
                className="text-xs text-muted-foreground"
              >
                {messages.settings.command}
              </Label>
              <Input
                id="terminal-command"
                aria-label={messages.settings.command}
                disabled={isSaving}
                value={launchCommand}
                onChange={(event) => setLaunchCommand(event.target.value)}
              />
            </div>
          </div>
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
          <Button
            disabled={isSaving}
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button disabled={isSaving || !isDirty} type="submit">
            {isSaving ? messages.settings.saving : messages.settings.save}
          </Button>
        </div>
      </form>
    </div>
  );
}
