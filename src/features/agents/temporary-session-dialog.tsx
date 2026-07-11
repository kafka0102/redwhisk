import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import {
  sendAgentMessage,
  startStructuredAgentSession,
  type StartStructuredAgentSessionResult,
} from "./agent-session-commands";
import {
  listAgentProfiles,
  type AgentProfileRecord,
} from "../settings/settings-commands";
import { getCommandErrorMessage } from "../../shared/commands/command-error";
import { useI18n } from "../../shared/i18n/i18n";

interface TemporarySessionDialogProps {
  projectId: number;
  onClose: () => void;
  onStarted: (
    result: StartStructuredAgentSessionResult,
  ) => Promise<void> | void;
}

export function TemporarySessionDialog({
  projectId,
  onClose,
  onStarted,
}: TemporarySessionDialogProps) {
  const { messages, t } = useI18n();
  const [profiles, setProfiles] = useState<AgentProfileRecord[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [title, setTitle] = useState(
    messages.agentsFeature.temporarySessionDefaultTitle,
  );
  const [promptDraft, setPromptDraft] = useState(
    messages.agentsFeature.temporarySessionDefaultPrompt,
  );
  const [isStarting, setIsStarting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProfiles() {
      setIsLoadingProfiles(true);
      setStatusMessage(null);

      try {
        const [projectResponse, globalResponse] = await Promise.all([
          listAgentProfiles({ scope: "project", projectId }),
          listAgentProfiles({ scope: "global", projectId: null }),
        ]);

        if (!isMounted) {
          return;
        }

        const mergedProfiles = [
          ...projectResponse.profiles,
          ...globalResponse.profiles,
        ];
        setProfiles(mergedProfiles);
        setSelectedProfileId(mergedProfiles[0]?.id ?? null);

        if (mergedProfiles.length === 0) {
          setStatusMessage(messages.agentsFeature.noProfilesForAgentType);
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setStatusMessage(getCommandErrorMessage(error, t));
      } finally {
        if (isMounted) {
          setIsLoadingProfiles(false);
        }
      }
    }

    void loadProfiles();

    return () => {
      isMounted = false;
    };
  }, [messages.agentsFeature.noProfilesForAgentType, projectId, t]);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const isStartDisabled =
    isLoadingProfiles ||
    isStarting ||
    selectedProfile == null ||
    title.trim().length === 0 ||
    promptDraft.trim().length === 0;

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = getFocusableDialogElements(dialogRef.current);
    if (focusableElements.length === 0) {
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isStartDisabled || selectedProfile == null) {
      return;
    }

    setIsStarting(true);
    setStatusMessage(null);
    let didStart = false;

    try {
      const result = await startStructuredAgentSession({
        projectId,
        title: title.trim(),
        agentType: selectedProfile.agentType,
        agentProfileId: selectedProfile.id,
      });
      // 结构化路径启动后单独发首条消息（StartStructuredAgentSessionInput 不带 prompt）。
      const trimmedPrompt = promptDraft.trim();
      if (trimmedPrompt) {
        await sendAgentMessage({
          projectId,
          sessionId: result.sessionId,
          message: trimmedPrompt,
          attachments: [],
        });
      }
      await onStarted(result);
      didStart = true;
    } catch (error) {
      setStatusMessage(getCommandErrorMessage(error, t));
    }

    if (didStart) {
      onClose();
      return;
    }

    setIsStarting(false);
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
        ref={dialogRef}
        aria-label={messages.agentsFeature.sessionDialog}
        aria-modal="true"
        className="issue-dialog"
        role="dialog"
        onKeyDown={handleKeyDown}
        onSubmit={handleSubmit}
      >
        <div className="issue-dialog__header">
          <h3>{messages.agentsFeature.sessionDialog}</h3>
          <button
            ref={closeButtonRef}
            aria-label={messages.settings.close}
            className="issue-dialog__close"
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>

        <div className="issue-dialog__body">
          <div className="issue-dialog__editor">
            <div className="grid gap-1.5">
              <Label
                htmlFor="temporary-session-title"
                className="text-xs text-muted-foreground"
              >
                {messages.agentsFeature.titleField}
              </Label>
              <Input
                ref={titleInputRef}
                id="temporary-session-title"
                aria-label={messages.agentsFeature.titleField}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor="temporary-session-profile"
                className="text-xs text-muted-foreground"
              >
                {messages.issues.agentProfile}
              </Label>
              <Select
                items={profiles.map((profile) => ({
                  value: profile.id,
                  label: `${profile.name}${profile.scope === "project" ? " (Project)" : " (Global)"}`,
                }))}
                value={selectedProfileId}
                onValueChange={(value) => {
                  setSelectedProfileId(
                    value == null ? null : (value as number),
                  );
                }}
              >
                <SelectTrigger
                  id="temporary-session-profile"
                  aria-label={messages.issues.agentProfile}
                  className="w-full"
                  disabled={isLoadingProfiles || profiles.length === 0}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                      {profile.scope === "project" ? " (Project)" : " (Global)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor="temporary-session-prompt"
                className="text-xs text-muted-foreground"
              >
                {messages.agentsFeature.promptField}
              </Label>
              <Textarea
                id="temporary-session-prompt"
                aria-label={messages.agentsFeature.promptField}
                rows={10}
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
              />
            </div>
          </div>
        </div>

        <p
          className="issue-dialog__status"
          role="status"
          aria-label={messages.agentsFeature.sessionDialogStatus}
        >
          {statusMessage}
        </p>

        <div className="issue-dialog__footer issue-dialog__footer--end">
          <button
            className="issues-button issues-button--primary"
            type="submit"
            disabled={isStartDisabled}
          >
            {isStarting
              ? messages.agentsFeature.starting
              : messages.agentsFeature.start}
          </button>
        </div>
      </form>
    </div>
  );
}

function getFocusableDialogElements(
  dialogElement: HTMLFormElement | null,
): HTMLElement[] {
  if (!dialogElement) {
    return [];
  }

  return Array.from(
    dialogElement.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.tabIndex >= 0);
}
