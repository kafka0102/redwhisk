import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  listAgentProfiles,
  type AgentProfileRecord,
} from "../settings/settings-commands";
import { toCommandError } from "../../shared/commands/command-error";
import type { IssueRecord } from "./issue-commands";
import { buildRunPromptPreview } from "./run-prompt-builder";

interface IssueRunDialogProps {
  issue: Pick<IssueRecord, "id" | "title" | "description">;
  projectId: number;
  onClose: () => void;
}

export function IssueRunDialog({
  issue,
  projectId,
  onClose,
}: IssueRunDialogProps) {
  const [profiles, setProfiles] = useState<AgentProfileRecord[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
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
        setProfiles(mergedProfiles);
        setSelectedProfileId(mergedProfiles[0]?.id ?? null);

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
  }, [projectId]);

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
    isLoadingProfiles || selectedProfile === null || preview === null;

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
        className="issue-dialog"
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
                disabled={isLoadingProfiles || profiles.length === 0}
                value={selectedProfileId ?? ""}
                onChange={(event) =>
                  setSelectedProfileId(Number(event.target.value))
                }
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
              <span>Final prompt preview</span>
              <textarea
                aria-label="Final prompt preview"
                className="settings-textarea"
                readOnly
                rows={12}
                value={preview?.finalPrompt ?? ""}
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
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="issues-button issues-button--primary"
            type="button"
            disabled={isStartDisabled}
            onClick={() =>
              setStatusMessage(
                "Start will be connected in Story 2.2 / 2.3. This story only previews the final prompt.",
              )
            }
          >
            Start
          </Button>
        </div>
      </div>
    </div>
  );
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
