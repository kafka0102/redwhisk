import { Check, Pencil, Plus, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toCommandError } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";
import type { ProjectTerminalShortcutCommandRecord } from "./project-terminal-commands";

const SHORTCUT_COMMAND_MAX_COUNT = 10;

interface TerminalShortcutCommandsDialogProps {
  commands: ProjectTerminalShortcutCommandRecord[];
  onClose: () => void;
  onSave: (input: {
    id?: number;
    command: string;
    sortOrder: number;
  }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

interface DraftRow {
  id?: number;
  command: string;
  sortOrder: number;
}

export function TerminalShortcutCommandsDialog({
  commands,
  onClose,
  onSave,
  onDelete,
}: TerminalShortcutCommandsDialogProps) {
  const { messages } = useI18n();
  const [editingDraft, setEditingDraft] = useState<DraftRow | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(
    null,
  );
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const editingRowKey = editingDraft
    ? `draft-${editingDraft.id ?? "new"}`
    : null;

  useEffect(() => {
    if (editingRowKey && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingRowKey]);

  function startAddCommand() {
    if (commands.length >= SHORTCUT_COMMAND_MAX_COUNT) {
      return;
    }
    setEditingDraft({
      command: "",
      sortOrder: commands.length,
    });
    setStatusMessage(null);
  }

  function startEditCommand(command: ProjectTerminalShortcutCommandRecord) {
    setEditingDraft({
      id: command.id,
      command: command.command,
      sortOrder: command.sortOrder,
    });
    setStatusMessage(null);
  }

  function cancelEditing() {
    setEditingDraft(null);
    setStatusMessage(null);
  }

  async function handleSubmitDraft(event: FormEvent) {
    event.preventDefault();
    if (!editingDraft || pendingAction) {
      return;
    }

    const trimmed = editingDraft.command.trim();
    if (!trimmed) {
      setStatusMessage(
        messages.agentsFeature.shortcutCommandsCommandPlaceholder,
      );
      return;
    }

    setPendingAction("save");
    try {
      await onSave({
        id: editingDraft.id,
        command: trimmed,
        sortOrder: editingDraft.sortOrder,
      });
      setEditingDraft(null);
      setStatusMessage(null);
    } catch (error: unknown) {
      setStatusMessage(toCommandError(error).message);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete(id: number) {
    if (pendingAction) {
      return;
    }
    setPendingAction("delete");
    try {
      await onDelete(id);
      if (editingDraft?.id === id) {
        setEditingDraft(null);
      }
      setStatusMessage(null);
    } catch (error: unknown) {
      setStatusMessage(toCommandError(error).message);
    } finally {
      setPendingAction(null);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (editingDraft) {
        cancelEditing();
      } else {
        onClose();
      }
    }
  }

  const hasReachedLimit = commands.length >= SHORTCUT_COMMAND_MAX_COUNT;
  const isAddingNewRow = editingDraft && editingDraft.id === undefined;

  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-label={messages.agentsFeature.shortcutCommandsDialogTitle}
        aria-modal="true"
        className="issue-dialog terminal-shortcut-commands-dialog"
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="issue-dialog__header terminal-shortcut-commands-dialog__header">
          <h3>{messages.agentsFeature.shortcutCommandsDialogTitle}</h3>
          <Button
            disabled={hasReachedLimit || pendingAction !== null}
            size="sm"
            type="button"
            variant="outline"
            onClick={startAddCommand}
          >
            <Plus aria-hidden="true" size={14} strokeWidth={2} />
            <span>{messages.agentsFeature.shortcutCommandsAdd}</span>
          </Button>
        </div>

        <div className="issue-dialog__body issue-dialog__body--single terminal-shortcut-commands-dialog__body">
          <ul className="terminal-shortcut-commands-dialog__list">
            {commands.map((command) => {
              const isEditingRow = editingDraft?.id === command.id;
              if (isEditingRow && editingDraft) {
                return (
                  <ShortcutCommandEditRow
                    key={command.id}
                    draft={editingDraft}
                    inputRef={editInputRef}
                    isSaving={pendingAction === "save"}
                    onDraftChange={(next) => setEditingDraft(next)}
                    onCancel={cancelEditing}
                    onSubmit={handleSubmitDraft}
                  />
                );
              }

              return (
                <li
                  key={command.id}
                  className="terminal-shortcut-commands-dialog__row"
                >
                  <span className="terminal-shortcut-commands-dialog__command">
                    {command.command}
                  </span>
                  <div className="terminal-shortcut-commands-dialog__actions">
                    <button
                      aria-label={messages.agentsFeature.shortcutCommandsEdit}
                      className="terminal-shortcut-commands-dialog__icon"
                      disabled={pendingAction !== null}
                      type="button"
                      onClick={() => startEditCommand(command)}
                    >
                      <Pencil size={13} strokeWidth={2} />
                    </button>
                    <button
                      aria-label={messages.agentsFeature.shortcutCommandsDelete}
                      className="terminal-shortcut-commands-dialog__icon"
                      disabled={pendingAction !== null}
                      type="button"
                      onClick={() => {
                        void handleDelete(command.id);
                      }}
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  </div>
                </li>
              );
            })}
            {isAddingNewRow && editingDraft ? (
              <ShortcutCommandEditRow
                key="new-row"
                draft={editingDraft}
                inputRef={editInputRef}
                isSaving={pendingAction === "save"}
                onDraftChange={(next) => setEditingDraft(next)}
                onCancel={cancelEditing}
                onSubmit={handleSubmitDraft}
              />
            ) : null}
            {commands.length === 0 && !isAddingNewRow ? (
              <li className="terminal-shortcut-commands-dialog__empty">
                {messages.agentsFeature.shortcutCommandsEmpty}
              </li>
            ) : null}
          </ul>
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
            disabled={pendingAction !== null}
            type="button"
            variant="outline"
            onClick={onClose}
          >
            {messages.agentsFeature.shortcutCommandsCancel}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ShortcutCommandEditRowProps {
  draft: DraftRow;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isSaving: boolean;
  onDraftChange: (next: DraftRow) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}

function ShortcutCommandEditRow({
  draft,
  inputRef,
  isSaving,
  onDraftChange,
  onCancel,
  onSubmit,
}: ShortcutCommandEditRowProps) {
  const { messages } = useI18n();
  return (
    <li className="terminal-shortcut-commands-dialog__row terminal-shortcut-commands-dialog__row--editing">
      <form
        className="terminal-shortcut-commands-dialog__edit-form"
        onSubmit={onSubmit}
      >
        <Input
          ref={inputRef}
          aria-label={messages.agentsFeature.shortcutCommandsCommandPlaceholder}
          autoCapitalize="none"
          disabled={isSaving}
          placeholder={
            messages.agentsFeature.shortcutCommandsCommandPlaceholder
          }
          value={draft.command}
          onChange={(event) =>
            onDraftChange({ ...draft, command: event.target.value })
          }
        />
        <div className="terminal-shortcut-commands-dialog__actions">
          <button
            aria-label={messages.agentsFeature.shortcutCommandsSave}
            className="terminal-shortcut-commands-dialog__icon"
            disabled={isSaving}
            type="submit"
          >
            <Check size={14} strokeWidth={2} />
          </button>
          <button
            aria-label={messages.agentsFeature.shortcutCommandsCancel}
            className="terminal-shortcut-commands-dialog__icon"
            disabled={isSaving}
            type="button"
            onClick={onCancel}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </form>
    </li>
  );
}
