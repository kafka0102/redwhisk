import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  getProjectGitBranches,
  startAgentSession,
  type IssueRecord,
  type ProjectGitBranchListResult,
  type StartAgentSessionResult,
  type WorkspaceMode,
} from "./issue-commands";
import {
  listAgentProfiles,
  type AgentProfileRecord,
} from "../settings/settings-commands";
import type { ProjectCompletionPolicy } from "../project/project-commands";
import {
  listAgentSessions,
  type AgentSessionListItem,
} from "../agents/agent-session-commands";
import { toCommandError } from "../../shared/commands/command-error";
import { buildRunPromptPreview } from "./run-prompt-builder";
import { parseDefaultSkills } from "../settings/agent-profile-skills";

const NO_WORKFLOW_SKILL_VALUE = "__none__";
const RECENT_WORKFLOW_SKILL_STORAGE_KEY =
  "redwhisk.issue-run.recent-workflow-skill";
const RECENT_WORKSPACE_SELECTION_STORAGE_KEY =
  "redwhisk.issue-run.recent-workspace-selection";

interface IssueRunDialogProps {
  issue: Pick<IssueRecord, "id" | "title" | "description" | "attachments">;
  projectCompletionPolicy: ProjectCompletionPolicy;
  projectId: number;
  onClose: () => void;
  onStarted: (result: StartAgentSessionResult) => void | Promise<void>;
}

interface RecentWorkspaceSelection {
  workspaceMode: WorkspaceMode;
  targetBranch: string | null;
}

export function IssueRunDialog({
  issue,
  projectCompletionPolicy,
  projectId,
  onClose,
  onStarted,
}: IssueRunDialogProps) {
  const [profiles, setProfiles] = useState<AgentProfileRecord[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [selectedWorkflowSkill, setSelectedWorkflowSkill] = useState<
    string | null
  >(null);
  const [completionPolicy, setCompletionPolicy] =
    useState<ProjectCompletionPolicy>("manual");
  const [workspaceMode, setWorkspaceMode] =
    useState<WorkspaceMode>("current_branch");
  const [targetBranch, setTargetBranch] = useState("");
  const [branchState, setBranchState] = useState<ProjectGitBranchListResult>({
    currentBranch: "",
    localBranches: [],
  });
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [hasLoadedRunContext, setHasLoadedRunContext] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileSelectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadRunDialogContext() {
      setIsLoadingProfiles(true);
      setIsLoadingBranches(true);
      setStatusMessage(null);

      try {
        const [
          projectProfilesResponse,
          globalProfilesResponse,
          sessionsResponse,
          branchesResponse,
        ] = await Promise.all([
          listAgentProfiles({ scope: "project", projectId }),
          listAgentProfiles({ scope: "global", projectId: null }),
          listAgentSessions(projectId),
          getProjectGitBranches({ projectId }),
        ]);

        if (!isMounted) {
          return;
        }

        const mergedProfiles = [
          ...projectProfilesResponse.profiles,
          ...globalProfilesResponse.profiles,
        ];
        const initialProfile = resolveInitialProfile({
          profiles: mergedProfiles,
          projectProfiles: projectProfilesResponse.profiles,
          globalProfiles: globalProfilesResponse.profiles,
          sessions: sessionsResponse.sessions,
        });
        const recentWorkspaceSelection = readRecentWorkspaceSelection(projectId);
        const resolvedTargetBranch = resolveInitialTargetBranch({
          currentBranch: branchesResponse.currentBranch,
          localBranches: branchesResponse.localBranches,
          recentTargetBranch: recentWorkspaceSelection?.targetBranch ?? null,
        });

        setProfiles(mergedProfiles);
        setSelectedProfileId(initialProfile?.id ?? null);
        setSelectedWorkflowSkill(
          initialProfile
            ? resolveInitialWorkflowSkill({
                profile: initialProfile,
                projectId,
              })
            : null,
        );
        setCompletionPolicy(projectCompletionPolicy);
        setWorkspaceMode(
          recentWorkspaceSelection?.workspaceMode ?? "current_branch",
        );
        setTargetBranch(resolvedTargetBranch);
        setBranchState(branchesResponse);
        setHasLoadedRunContext(true);

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
          setIsLoadingBranches(false);
        }
      }
    }

    void loadRunDialogContext();

    return () => {
      isMounted = false;
    };
  }, [issue, projectCompletionPolicy, projectId]);

  useEffect(() => {
    if (isLoadingProfiles || profiles.length === 0) {
      return;
    }

    profileSelectRef.current?.focus();
  }, [isLoadingProfiles, profiles.length]);

  useEffect(() => {
    if (!hasLoadedRunContext) {
      return;
    }

    saveRecentWorkspaceSelection(projectId, {
      workspaceMode,
      targetBranch: targetBranch.trim().length > 0 ? targetBranch : null,
    });
  }, [hasLoadedRunContext, projectId, targetBranch, workspaceMode]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const workflowSkillOptions = useMemo(() => {
    if (!selectedProfile) {
      return [];
    }

    return parseDefaultSkills(selectedProfile.defaultSkill);
  }, [selectedProfile]);
  const shouldShowWorkflowSkill =
    selectedProfile !== null && workflowSkillOptions.length > 0;
  const defaultWorkflowSkill = workflowSkillOptions[0] ?? null;
  const effectiveWorkflowSkill =
    selectedWorkflowSkill === null
      ? defaultWorkflowSkill
      : selectedWorkflowSkill.length === 0
        ? ""
        : selectedWorkflowSkill;
  const workflowSkillValue =
    effectiveWorkflowSkill === null
      ? NO_WORKFLOW_SKILL_VALUE
      : effectiveWorkflowSkill.length === 0
        ? NO_WORKFLOW_SKILL_VALUE
        : effectiveWorkflowSkill;

  const preview = useMemo(() => {
    if (!selectedProfile) {
      return null;
    }

    return buildRunPromptPreview({
      issue,
      profile: selectedProfile,
      selectedWorkflowSkill: effectiveWorkflowSkill,
    });
  }, [effectiveWorkflowSkill, issue, selectedProfile]);
  const promptDraft = preview?.finalPrompt ?? "";
  const effectiveTargetBranch =
    workspaceMode === "current_branch"
      ? branchState.currentBranch
      : targetBranch.trim();

  const isStartDisabled =
    isLoadingProfiles ||
    isLoadingBranches ||
    isStarting ||
    selectedProfile === null ||
    preview === null ||
    promptDraft.trim().length === 0 ||
    effectiveTargetBranch.length === 0;

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
        completionPolicyOverride: completionPolicy,
        workspaceMode,
        targetBranch: effectiveTargetBranch,
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
        aria-label={`Run Issue #${issue.id}`}
        aria-modal="true"
        className="issue-dialog issue-dialog--compact"
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="issue-dialog__header">
          <h3>Run Issue #{issue.id}</h3>
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
          <div className="issue-dialog__editor issue-dialog__editor--full">
            <label className="settings-field">
              <span>Agent profile</span>
              <select
                ref={profileSelectRef}
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
                  setSelectedWorkflowSkill(
                    nextProfile
                      ? resolveInitialWorkflowSkill({
                          profile: nextProfile,
                          projectId,
                        })
                      : null,
                  );
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

            {shouldShowWorkflowSkill ? (
              <label className="settings-field">
                <span>Workflow skill</span>
                <select
                  aria-label="Workflow skill"
                  className="settings-input"
                  disabled={isLoadingProfiles || isStarting}
                  value={workflowSkillValue}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    const nextWorkflowSkill =
                      nextValue === NO_WORKFLOW_SKILL_VALUE ? "" : nextValue;
                    setSelectedWorkflowSkill(nextWorkflowSkill);
                    if (selectedProfile) {
                      saveRecentWorkflowSkill({
                        projectId,
                        profileId: selectedProfile.id,
                        workflowSkill: nextWorkflowSkill,
                      });
                    }
                  }}
                >
                  <option value={NO_WORKFLOW_SKILL_VALUE}>None</option>
                  {workflowSkillOptions.map((skill) => (
                    <option key={skill} value={skill}>
                      {skill}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="settings-field">
              <span>Commit strategy</span>
              <select
                aria-label="Commit strategy"
                className="settings-input"
                disabled={isLoadingBranches || isStarting}
                value={completionPolicy}
                onChange={(event) =>
                  setCompletionPolicy(
                    event.target.value as ProjectCompletionPolicy,
                  )
                }
              >
                <option value="manual">Manual</option>
                <option value="agent_auto_commit">Agent auto commit</option>
              </select>
            </label>

            <div className="settings-field">
              <span>Development mode</span>
              <div className="agent-dialog__command-row">
                <select
                  aria-label="Development mode"
                  className="settings-input"
                  disabled={isLoadingBranches || isStarting}
                  value={workspaceMode}
                  onChange={(event) => {
                    setWorkspaceMode(event.target.value as WorkspaceMode);
                  }}
                >
                  <option value="current_branch">Current branch</option>
                  <option value="worktree">Worktree</option>
                </select>
                <select
                  aria-label="Target branch"
                  className="settings-input"
                  disabled={
                    isLoadingBranches ||
                    isStarting ||
                    workspaceMode === "current_branch"
                  }
                  value={effectiveTargetBranch}
                  onChange={(event) => setTargetBranch(event.target.value)}
                >
                  {branchState.localBranches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="settings-field">
              <span>Final prompt</span>
              <textarea
                aria-label="Final prompt"
                className="settings-textarea"
                readOnly
                rows={12}
                value={promptDraft}
              />
            </label>
          </div>
        </div>
        <p
          className="issue-dialog__status"
          role="status"
          aria-label="Run status"
        >
          {statusMessage}
        </p>
        <div className="issue-dialog__footer issue-dialog__footer--end">
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

function resolveInitialWorkflowSkill({
  profile,
  projectId,
}: {
  profile: Pick<AgentProfileRecord, "defaultSkill" | "id">;
  projectId: number;
}): string | null {
  const configuredSkills = parseDefaultSkills(profile.defaultSkill);
  if (configuredSkills.length === 0) {
    return null;
  }

  const recentWorkflowSkill = readRecentWorkflowSkill({
    projectId,
    profileId: profile.id,
  });
  if (recentWorkflowSkill === null) {
    return configuredSkills[0] ?? null;
  }

  if (recentWorkflowSkill.length === 0) {
    return "";
  }

  return configuredSkills.includes(recentWorkflowSkill)
    ? recentWorkflowSkill
    : null;
}

function readRecentWorkflowSkill({
  profileId,
  projectId,
}: {
  profileId: number;
  projectId: number;
}): string | null {
  try {
    const rawValue = window.localStorage.getItem(
      RECENT_WORKFLOW_SKILL_STORAGE_KEY,
    );
    if (!rawValue) {
      return null;
    }

    const records = JSON.parse(rawValue) as Record<string, string | null>;
    const key = workflowSkillStorageKey(projectId, profileId);
    return typeof records[key] === "string" || records[key] === null
      ? records[key]
      : null;
  } catch {
    return null;
  }
}

function saveRecentWorkflowSkill({
  profileId,
  projectId,
  workflowSkill,
}: {
  profileId: number;
  projectId: number;
  workflowSkill: string | null;
}) {
  try {
    const rawValue = window.localStorage.getItem(
      RECENT_WORKFLOW_SKILL_STORAGE_KEY,
    );
    const records =
      rawValue === null
        ? {}
        : (JSON.parse(rawValue) as Record<string, string | null>);
    records[workflowSkillStorageKey(projectId, profileId)] = workflowSkill;
    window.localStorage.setItem(
      RECENT_WORKFLOW_SKILL_STORAGE_KEY,
      JSON.stringify(records),
    );
  } catch {
    // Ignore local storage failures and fall back to default ordering.
  }
}

function workflowSkillStorageKey(projectId: number, profileId: number): string {
  return `${projectId}:${profileId}`;
}

function readRecentWorkspaceSelection(
  projectId: number,
): RecentWorkspaceSelection | null {
  try {
    const rawValue = window.localStorage.getItem(
      RECENT_WORKSPACE_SELECTION_STORAGE_KEY,
    );
    if (!rawValue) {
      return null;
    }

    const records = JSON.parse(rawValue) as Record<
      string,
      RecentWorkspaceSelection | null
    >;
    const record = records[String(projectId)];
    if (
      record == null ||
      (record.workspaceMode !== "current_branch" &&
        record.workspaceMode !== "worktree")
    ) {
      return null;
    }

    return {
      workspaceMode: record.workspaceMode,
      targetBranch:
        typeof record.targetBranch === "string" ? record.targetBranch : null,
    };
  } catch {
    return null;
  }
}

function saveRecentWorkspaceSelection(
  projectId: number,
  selection: RecentWorkspaceSelection,
) {
  try {
    const rawValue = window.localStorage.getItem(
      RECENT_WORKSPACE_SELECTION_STORAGE_KEY,
    );
    const records =
      rawValue === null
        ? {}
        : (JSON.parse(rawValue) as Record<
            string,
            RecentWorkspaceSelection | null
          >);
    records[String(projectId)] = selection;
    window.localStorage.setItem(
      RECENT_WORKSPACE_SELECTION_STORAGE_KEY,
      JSON.stringify(records),
    );
  } catch {
    // Ignore local storage failures and fall back to in-memory defaults.
  }
}

function resolveInitialTargetBranch({
  currentBranch,
  localBranches,
  recentTargetBranch,
}: {
  currentBranch: string;
  localBranches: string[];
  recentTargetBranch: string | null;
}): string {
  if (
    recentTargetBranch &&
    localBranches.includes(recentTargetBranch.trim()) &&
    recentTargetBranch.trim().length > 0
  ) {
    return recentTargetBranch.trim();
  }

  if (currentBranch.trim().length > 0) {
    return currentBranch;
  }

  return localBranches[0] ?? "";
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

function resolveInitialProfile({
  profiles,
  projectProfiles,
  globalProfiles,
  sessions,
}: {
  profiles: AgentProfileRecord[];
  projectProfiles: AgentProfileRecord[];
  globalProfiles: AgentProfileRecord[];
  sessions: AgentSessionListItem[];
}): AgentProfileRecord | null {
  const latestIssueSession = sessions
    .filter(
      (session) =>
        session.issueId !== null && typeof session.agentProfileId === "number",
    )
    .sort(compareSessionsByMostRecent)[0];
  const historicalProfile = latestIssueSession
    ? profiles.find(
        (profile) => profile.id === latestIssueSession.agentProfileId,
      )
    : null;

  return (
    historicalProfile ??
    projectProfiles[projectProfiles.length - 1] ??
    globalProfiles[globalProfiles.length - 1] ??
    null
  );
}

function compareSessionsByMostRecent(
  left: AgentSessionListItem,
  right: AgentSessionListItem,
): number {
  return (
    sessionSortTime(right) - sessionSortTime(left) ||
    right.sessionId - left.sessionId
  );
}

function sessionSortTime(session: AgentSessionListItem): number {
  return session.closedAt ?? session.lastActiveAt ?? session.startedAt;
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
