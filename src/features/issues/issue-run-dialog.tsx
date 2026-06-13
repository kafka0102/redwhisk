import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  listAgentProfiles,
  type AgentProfileRecord,
} from "../settings/settings-commands";
import { toCommandError } from "../../shared/commands/command-error";
import {
  startAgentSession,
  type IssueRecord,
  type StartAgentSessionResult,
} from "./issue-commands";
import { buildRunPromptPreview } from "./run-prompt-builder";

interface IssueRunDialogProps {
  issue: Pick<IssueRecord, "id" | "title" | "description" | "attachments">;
  projectId: number;
  onClose: () => void;
  onStarted: (result: StartAgentSessionResult) => void | Promise<void>;
}

export function IssueRunDialog({
  issue,
  projectId,
  onClose,
  onStarted,
}: IssueRunDialogProps) {
  const [profiles, setProfiles] = useState<AgentProfileRecord[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [promptDraft, setPromptDraft] = useState("");
  const [hasEditedPrompt, setHasEditedPrompt] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

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
        const initialProfile = mergedProfiles[0] ?? null;
        setProfiles(mergedProfiles);
        setSelectedProfileId(initialProfile?.id ?? null);
        setHasEditedPrompt(false);
        setPromptDraft(
          initialProfile
            ? buildRunPromptPreview({
                issue,
                profile: initialProfile,
              }).finalPrompt
            : "",
        );

        if (mergedProfiles.length === 0) {
          setStatusMessage(
            "No agent profiles available. Configure an agent in Settings first.",
          );
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setStatusMessage(toCommandError(error).message);
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
  }, [issue, projectId]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const preview = useMemo(() => {
    if (!selectedProfile) {
      return null;
    }

    return buildRunPromptPreview({
      issue,
      profile: selectedProfile,
    });
  }, [issue, selectedProfile]);

  const isStartDisabled =
    isLoadingProfiles ||
    isStarting ||
    selectedProfile === null ||
    preview === null ||
    promptDraft.trim().length === 0;

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
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

  async function handleStart() {
    if (!selectedProfile) {
      return;
    }

    setIsStarting(true);
    setStatusMessage(null);

    try {
      const result = await startAgentSession({
        projectId,
        issueId: issue.id,
        agentProfileId: selectedProfile.id,
        promptSnapshot: promptDraft,
      });
      await onStarted(result);
    } catch (error) {
      const commandError = toCommandError(error);
      if (commandError.code === "AGENT_SESSION_ALREADY_EXISTS") {
        await onStarted({
          issueId: issue.id,
          sessionId: getExistingSessionId(commandError.details),
        });
        return;
      }

      setStatusMessage(commandError.message);
    } finally {
      setIsStarting(false);
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
      <div
        ref={dialogRef}
        aria-label="Run Dialog"
        aria-modal="true"
        className="issue-dialog issue-dialog--compact"
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="issue-dialog__header">
          <h3>Run Dialog</h3>
          <button
            ref={closeButtonRef}
            aria-label="Close run dialog"
            className="issue-dialog__close"
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="issue-dialog__body">
          <div className="issue-dialog__editor">
            <label className="settings-field">
              <span>Agent profile</span>
              <select
                aria-label="Agent profile"
                className="settings-input"
                disabled={
                  isLoadingProfiles || isStarting || profiles.length === 0
                }
                value={selectedProfileId ?? ""}
                onChange={(event) => {
                  const nextProfileId = Number(event.target.value);
                  const nextProfile =
                    profiles.find((profile) => profile.id === nextProfileId) ??
                    null;

                  setSelectedProfileId(nextProfileId);
                  if (!hasEditedPrompt) {
                    setPromptDraft(
                      nextProfile
                        ? buildRunPromptPreview({
                            issue,
                            profile: nextProfile,
                          }).finalPrompt
                        : "",
                    );
                  }
                }}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                    {profile.scope === "project" ? " (Project)" : " (Global)"}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span>Final prompt</span>
              <textarea
                aria-label="Final prompt"
                className="settings-textarea"
                rows={12}
                value={promptDraft}
                onChange={(event) => {
                  setPromptDraft(event.target.value);
                  setHasEditedPrompt(true);
                }}
              />
            </label>

            <details className="settings-panel">
              <summary>Prompt sources</summary>
              <div className="settings-list">
                {preview?.sources.map((source) => (
                  <div key={source.id} className="settings-list__item">
                    <div>
                      <h5>{source.label}</h5>
                      <p>{source.content}</p>
                    </div>
                  </div>
                )) ?? null}
              </div>
            </details>
          </div>

          <aside className="issue-dialog__side" aria-label="Run summary">
            <section className="issue-dialog__panel">
              <h4>Issue</h4>
              <p>#{issue.id}</p>
              <p>{issue.title}</p>
            </section>
            <section className="issue-dialog__panel">
              <h4>Profile scope</h4>
              <p>
                {selectedProfile
                  ? selectedProfile.scope === "project"
                    ? "Project"
                    : "Global"
                  : "No profile selected"}
              </p>
            </section>
          </aside>
        </div>
        <p
          className="issue-dialog__status"
          role="status"
          aria-label="Run status"
        >
          {statusMessage}
        </p>
        <div className="issue-dialog__footer">
          <Button
            className="issues-button"
            type="button"
            variant="outline"
            disabled={isStarting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="issues-button issues-button--primary"
            type="button"
            disabled={isStartDisabled}
            onClick={() => void handleStart()}
          >
            Start
          </Button>
        </div>
      </div>
    </div>
  );
}

function getExistingSessionId(
  details: Array<Record<string, unknown>> | undefined,
): number | null {
  const sessionDetail = details?.find(
    (detail) => detail["@type"] === "AgentSession",
  );
  const sessionId = sessionDetail?.sessionId;
  return typeof sessionId === "number" ? sessionId : null;
}

function getFocusableDialogElements(
  dialogElement: HTMLDivElement | null,
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
