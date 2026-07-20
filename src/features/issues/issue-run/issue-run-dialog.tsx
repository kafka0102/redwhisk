import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getIssueWorktreeStatus,
  getProjectGitBranches,
  startAgentSession,
  type IssueRecord,
  type ProjectGitBranchListResult,
  type StartAgentSessionResult,
  type WorkspaceMode,
} from "../issue-commands";
import {
  filterLaunchVisibleAgentProfiles,
  resolveAgentProfileLaunchEligibility,
} from "../../agents/agent-launch-eligibility";
import {
  listAgentProfiles,
  listSavedAgentSkills,
  type AgentProfileRecord,
  type SavedAgentSkillRecord,
} from "../../settings/settings-commands";
import {
  listAgentSessions,
  type AgentSessionListItem,
  type WorkspaceMode as SessionWorkspaceMode,
} from "../../agents/agent-session-commands";
import {
  getCommandErrorMessage,
  toCommandError,
  type CommandError,
} from "../../../shared/commands/command-error";
import { useI18n } from "../../../shared/i18n/i18n";
import { buildRunPromptPreview } from "./run-prompt-builder";

const NO_WORKFLOW_SKILL_VALUE = "__none__";

interface IssueRunDialogProps {
  issue: Pick<
    IssueRecord,
    "id" | "number" | "title" | "description" | "attachments" | "labels"
  >;
  projectId: number;
  worktreeSetupCommand?: string;
  /**
   * 为 true 时隐藏 Run Dialog 的 overlay 与表单，但保留组件挂载以维持内部表单状态。
   * 用于在父组件显示阻塞式 LoadingDialog 期间，避免两个 overlay 共存冲突。
   */
  hidden?: boolean;
  onClose: () => void;
  /**
   * 用户点击"开始运行"、通过前端预检查后立即触发，父组件据此显示阻塞式 loading
   * 并隐藏 Run Dialog。启动请求尚未发出。
   */
  onStartAttempt?: () => void;
  /**
   * 启动失败时触发（已隐藏的 Run Dialog 将据此重新显示，保留表单状态供重试）。
   */
  onStartError?: (error: CommandError) => void;
  onStarted: (result: StartAgentSessionResult) => void | Promise<void>;
}

export function IssueRunDialog({
  issue,
  projectId,
  worktreeSetupCommand = "",
  hidden = false,
  onClose,
  onStartAttempt,
  onStartError,
  onStarted,
}: IssueRunDialogProps) {
  const { messages, t } = useI18n();
  const [profiles, setProfiles] = useState<AgentProfileRecord[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [selectedWorkflowSkill, setSelectedWorkflowSkill] = useState<
    string | null
  >(null);
  const [savedSkills, setSavedSkills] = useState<SavedAgentSkillRecord[]>([]);
  const [workspaceMode, setWorkspaceMode] =
    useState<WorkspaceMode>("current_branch");
  const [targetBranch, setTargetBranch] = useState("");
  const [branchState, setBranchState] = useState<ProjectGitBranchListResult>({
    currentBranch: "",
    localBranches: [],
  });
  const [isLoadingBranches, setIsLoadingBranches] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileSelectRef = useRef<HTMLButtonElement | null>(null);
  const isStartingRef = useRef(false);

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
          projectSavedSkillsResponse,
          globalSavedSkillsResponse,
        ] = await Promise.all([
          listAgentProfiles({ scope: "project", projectId }),
          listAgentProfiles({ scope: "global", projectId: null }),
          listAgentSessions(projectId),
          getProjectGitBranches({ projectId }),
          listSavedAgentSkills({ scope: "project", projectId }),
          listSavedAgentSkills({ scope: "global", projectId: null }),
        ]);

        if (!isMounted) {
          return;
        }

        const mergedProfiles = filterLaunchVisibleAgentProfiles([
          ...projectProfilesResponse.profiles,
          ...globalProfilesResponse.profiles,
        ]);
        const mergedSavedSkills = [
          ...projectSavedSkillsResponse.skills,
          ...globalSavedSkillsResponse.skills,
        ];
        // ADR-0020 决策 4/5：enabled=false 隐藏；opencode/grok 显示但置灰不可选。
        // 默认选中需从「可选」子集中挑，避免 initial profile 落到 opencode/grok
        // 不可选项上。resolveInitialProfile 的入参也用 selectable 子集。
        const selectableProjectProfiles =
          projectProfilesResponse.profiles.filter(
            (profile) =>
              resolveAgentProfileLaunchEligibility(profile).selectable,
          );
        const selectableGlobalProfiles = globalProfilesResponse.profiles.filter(
          (profile) => resolveAgentProfileLaunchEligibility(profile).selectable,
        );
        const initialProfile = resolveInitialProfile({
          profiles: [...selectableProjectProfiles, ...selectableGlobalProfiles],
          projectProfiles: selectableProjectProfiles,
          globalProfiles: selectableGlobalProfiles,
          sessions: sessionsResponse.sessions,
        });
        const initialWorkspaceMode = resolveInitialWorkspaceMode({
          currentBranch: branchesResponse.currentBranch,
          recentWorkspaceMode: resolveMostRecentIssueWorkspaceMode(
            sessionsResponse.sessions,
          ),
        });
        const resolvedTargetBranch = resolveInitialTargetBranch({
          currentBranch: branchesResponse.currentBranch,
          localBranches: branchesResponse.localBranches,
        });

        setProfiles(mergedProfiles);
        setSavedSkills(mergedSavedSkills);
        setSelectedProfileId(initialProfile?.id ?? null);
        setSelectedWorkflowSkill(
          initialProfile
            ? resolveInitialWorkflowSkill({
                issue,
                options: mergedSavedSkills.filter((skill) =>
                  skill.skillPaths.some(
                    (p) => p.agentType === initialProfile.agentType,
                  ),
                ),
              })
            : null,
        );
        setWorkspaceMode(initialWorkspaceMode);
        setTargetBranch(resolvedTargetBranch);
        setBranchState(branchesResponse);

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
          setIsLoadingBranches(false);
        }
      }
    }

    void loadRunDialogContext();

    return () => {
      isMounted = false;
    };
  }, [issue, messages.agentsFeature.noProfilesForAgentType, projectId, t]);

  useEffect(() => {
    if (isLoadingProfiles || profiles.length === 0) {
      return;
    }

    profileSelectRef.current?.focus();
  }, [isLoadingProfiles, profiles.length]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const workflowSkillOptions = useMemo(() => {
    if (!selectedProfile) {
      return [];
    }
    const seen = new Set<string>();
    return savedSkills
      .filter((skill) =>
        skill.skillPaths.some((p) => p.agentType === selectedProfile.agentType),
      )
      .filter((skill) => {
        if (seen.has(skill.name)) return false;
        seen.add(skill.name);
        return true;
      });
  }, [savedSkills, selectedProfile]);
  const effectiveWorkflowSkill =
    selectedWorkflowSkill === null
      ? null
      : selectedWorkflowSkill.length === 0
        ? ""
        : selectedWorkflowSkill;
  const workflowSkillValue =
    effectiveWorkflowSkill === null || effectiveWorkflowSkill.length === 0
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
  const effectiveSetupCommand = worktreeSetupCommand.trim();

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
      if (isStarting) {
        return;
      }
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
    if (isStartingRef.current || isStartDisabled || !selectedProfile) {
      return;
    }

    isStartingRef.current = true;
    setIsStarting(true);
    setStatusMessage(null);
    // 通知父组件进入阻塞式 loading 并隐藏 Run Dialog，避免 Run Dialog overlay
    // 与父组件 LoadingDialog 的 Radix overlay 同时挂载造成冲突（见 4df1948）。
    onStartAttempt?.();

    try {
      // 前端预检查：worktree 模式下若已存在同名 worktree，直接禁止运行；
      // 后端 prepare_issue_session_launch 亦有 IssueWorktreeOccupied 兜底。
      if (workspaceMode === "worktree") {
        const worktreeStatus = await getIssueWorktreeStatus({
          projectId,
          issueId: issue.id,
        });
        if (worktreeStatus.exists) {
          setStatusMessage(messages.issues.worktreeOccupiedMessage);
          onStartError?.(
            toCommandError(new Error(messages.issues.worktreeOccupiedMessage)),
          );
          return;
        }
      }

      const result = await startAgentSession({
        projectId,
        issueId: issue.id,
        agentProfileId: selectedProfile.id,
        promptSnapshot: promptDraft,
        workspaceMode,
        targetBranch: effectiveTargetBranch,
        worktreeSetupCommand: effectiveSetupCommand,
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

      setStatusMessage(getCommandErrorMessage(error, t));
      onStartError?.(commandError);
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
    }
  }

  // 父组件进入阻塞式 loading 时隐藏 Run Dialog（不卸载，保留内部表单状态）。
  // 这样 Run Dialog 的自定义 overlay 与父组件 LoadingDialog 的 Radix overlay
  // 不会同时挂载，避免历史冲突（见 4df1948）。
  if (hidden) {
    return null;
  }

  return (
    <div
      className="issue-dialog-overlay"
      onMouseDown={(event) => {
        if (!isStarting && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        aria-label={messages.issues.runIssue(issue.number)}
        aria-modal="true"
        className="issue-dialog issue-dialog--compact"
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="issue-dialog__header">
          <h3>{messages.issues.runIssue(issue.number)}</h3>
          <button
            ref={closeButtonRef}
            aria-label={messages.issues.runDialogClose}
            className="issue-dialog__close"
            disabled={isStarting}
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>
        <div className="issue-dialog__body">
          <div className="issue-dialog__editor issue-dialog__editor--full">
            <div className="grid gap-1.5">
              <Label
                htmlFor="run-agent-profile"
                className="text-xs text-muted-foreground"
              >
                {messages.issues.agentProfile}
              </Label>
              <Select
                items={profiles.map((profile) => {
                  const eligibility =
                    resolveAgentProfileLaunchEligibility(profile);
                  return {
                    value: profile.id,
                    label: `${profile.name}${profile.scope === "project" ? " (Project)" : " (Global)"}${
                      eligibility.selectable
                        ? ""
                        : ` ${messages.agentsFeature.unsupportedLaunch}`
                    }`,
                  };
                })}
                value={selectedProfileId}
                onValueChange={(value) => {
                  const nextProfileId = value as number;
                  const nextProfile =
                    profiles.find((profile) => profile.id === nextProfileId) ??
                    null;

                  setSelectedProfileId(nextProfileId);
                  setSelectedWorkflowSkill(
                    nextProfile
                      ? resolveInitialWorkflowSkill({
                          issue,
                          options: savedSkills.filter((skill) =>
                            skill.skillPaths.some(
                              (p) => p.agentType === nextProfile.agentType,
                            ),
                          ),
                        })
                      : null,
                  );
                }}
              >
                <SelectTrigger
                  ref={profileSelectRef}
                  id="run-agent-profile"
                  aria-label={messages.issues.agentProfile}
                  className="w-full"
                  disabled={
                    isLoadingProfiles || isStarting || profiles.length === 0
                  }
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => {
                    const eligibility =
                      resolveAgentProfileLaunchEligibility(profile);
                    return (
                      <SelectItem
                        key={profile.id}
                        disabled={!eligibility.selectable}
                        value={profile.id}
                      >
                        {profile.name}
                        {profile.scope === "project"
                          ? " (Project)"
                          : " (Global)"}
                        {!eligibility.selectable
                          ? ` ${messages.agentsFeature.unsupportedLaunch}`
                          : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor="run-workflow-skill"
                className="text-xs text-muted-foreground"
              >
                {messages.issues.workflowSkill}
              </Label>
              <Select
                items={[
                  {
                    value: NO_WORKFLOW_SKILL_VALUE,
                    label: messages.settings.none,
                  },
                  ...workflowSkillOptions.map((skill) => ({
                    value: skill.name,
                    label: skill.name,
                  })),
                ]}
                value={workflowSkillValue}
                onValueChange={(nextValue) => {
                  const nextWorkflowSkill =
                    nextValue === NO_WORKFLOW_SKILL_VALUE ? "" : nextValue;
                  setSelectedWorkflowSkill(nextWorkflowSkill);
                }}
              >
                <SelectTrigger
                  id="run-workflow-skill"
                  aria-label={messages.issues.workflowSkill}
                  className="w-full"
                  disabled={isLoadingProfiles || isStarting}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_WORKFLOW_SKILL_VALUE}>
                    {messages.settings.none}
                  </SelectItem>
                  {workflowSkillOptions.map((skill) => (
                    <SelectItem key={skill.name} value={skill.name}>
                      {skill.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor="run-development-mode"
                className="text-xs text-muted-foreground"
              >
                {messages.issues.developmentMode}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  items={[
                    {
                      value: "current_branch",
                      label: messages.issues.currentBranch,
                    },
                    { value: "worktree", label: messages.issues.worktree },
                  ]}
                  value={workspaceMode}
                  onValueChange={(value) => {
                    setWorkspaceMode(value as WorkspaceMode);
                  }}
                >
                  <SelectTrigger
                    id="run-development-mode"
                    aria-label={messages.issues.developmentMode}
                    className="w-full"
                    disabled={isLoadingBranches || isStarting}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current_branch">
                      {messages.issues.currentBranch}
                    </SelectItem>
                    <SelectItem value="worktree">
                      {messages.issues.worktree}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  items={branchState.localBranches.map((branch) => ({
                    value: branch,
                    label: branch,
                  }))}
                  value={effectiveTargetBranch}
                  onValueChange={(value) => setTargetBranch(value as string)}
                >
                  <SelectTrigger
                    aria-label={messages.issues.targetBranch}
                    className="w-full"
                    disabled={
                      isLoadingBranches ||
                      isStarting ||
                      workspaceMode === "current_branch"
                    }
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branchState.localBranches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label
                htmlFor="run-final-prompt"
                className="text-xs text-muted-foreground"
              >
                {messages.issues.finalPrompt}
              </Label>
              <Textarea
                id="run-final-prompt"
                aria-label={messages.issues.finalPrompt}
                className="h-56 min-h-0 resize-none overflow-y-auto field-sizing-fixed font-mono text-xs leading-relaxed md:text-xs"
                readOnly
                rows={12}
                value={promptDraft}
              />
            </div>
          </div>
        </div>
        <p
          className="issue-dialog__status"
          role="status"
          aria-label={messages.issues.runStatus}
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
            {messages.issues.start}
          </Button>
        </div>
      </div>
    </div>
  );
}

function resolveInitialWorkflowSkill({
  issue,
  options,
}: {
  issue: Pick<IssueRecord, "labels">;
  options: SavedAgentSkillRecord[];
}): string | null {
  const optionNames = new Set(options.map((skill) => skill.name));
  for (const label of issue.labels ?? []) {
    const name = (label.workflowSkill ?? "").trim();
    if (name.length > 0 && optionNames.has(name)) {
      return name;
    }
  }
  return null;
}

function resolveInitialWorkspaceMode({
  currentBranch,
  recentWorkspaceMode,
}: {
  currentBranch: string;
  recentWorkspaceMode: SessionWorkspaceMode | null;
}): WorkspaceMode {
  if (isMainlineBranch(currentBranch)) {
    return "worktree";
  }

  return recentWorkspaceMode === "worktree" ? "worktree" : "current_branch";
}

function resolveMostRecentIssueWorkspaceMode(
  sessions: AgentSessionListItem[],
): SessionWorkspaceMode | null {
  const latestIssueSession = sessions
    .filter((session) => session.issueId !== null)
    .sort(compareSessionsByMostRecent)[0];

  return latestIssueSession?.workspaceMode ?? null;
}

function isMainlineBranch(branch: string): boolean {
  const normalizedBranch = branch.trim();
  return normalizedBranch === "main" || normalizedBranch === "master";
}

function resolveInitialTargetBranch({
  currentBranch,
  localBranches,
}: {
  currentBranch: string;
  localBranches: string[];
}): string {
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
