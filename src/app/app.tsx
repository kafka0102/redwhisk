import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { AppShell } from "./app-shell";
import { resolveAppSurface } from "./app-surface";
import { Toaster } from "../components/ui/sonner";
import "./app.css";
import { ProjectDetailsForm } from "../features/project/project-details-form";
import { ProjectHome } from "../features/project/project-home";
import {
  detectWorktreeSetupCommand,
  initialWorktreeSetupCommand,
} from "../features/project/worktree-setup-command";
import { I18nProvider, useI18n } from "../shared/i18n/i18n";
import i18next, { getDefaultLocale } from "../shared/i18n/i18n-instance";
import {
  createProject,
  initializeLocalData,
  listProjects,
  openProject,
  openProjectWindow,
  validateProjectRepoPath,
  type CreateProjectInput,
  type ProjectWorktreeLocation,
  type ProjectRecord,
  type ProjectListItem,
} from "../features/project/project-commands";
import type { CodeWorkspaceRoot } from "../shared/workspace/workspace-commands";
import { SessionMonitorSurface } from "../features/agents/session-notifications/session-monitor-surface";
import {
  OPEN_AGENT_SESSION_EVENT,
  type OpenAgentSessionEventPayload,
} from "../features/agents/session-notifications/session-monitor-commands";
import { getCommandErrorMessage } from "../shared/commands/command-error";
import { subscribeTauriEvent } from "../shared/tauri-event/use-tauri-event";
import { installKeepWindowFullscreenOnEscape } from "./keep-window-fullscreen-on-escape";

export interface ProjectSummary {
  id: number;
  name: string;
  path: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
  recentOpenedAt: string;
  status: "available" | "missing";
  hasOpenWindow: boolean;
  codeWorkspaces?: CodeWorkspaceRoot[];
}

interface CreateProjectDraft {
  name: string;
  openInNewWindow: boolean;
  repoPath: string;
  suggestedName: string;
  worktreeLocation: ProjectWorktreeLocation;
  worktreeSetupCommand: string;
}

export function App() {
  const appSurface = resolveAppSurface(window.location.search);

  useEffect(() => installKeepWindowFullscreenOnEscape(), []);

  if (appSurface.type === "session-monitor") {
    return (
      <SessionMonitorSurface ownerWindowLabel={appSurface.ownerWindowLabel} />
    );
  }

  return <ProjectApp />;
}

function ProjectApp() {
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(
    null,
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [createProjectDraft, setCreateProjectDraft] =
    useState<CreateProjectDraft | null>(null);
  const [localDataError, setLocalDataError] = useState<string | null>(null);
  const [projectCreationError, setProjectCreationError] = useState<
    string | null
  >(null);
  const [projectOpenError, setProjectOpenError] = useState<string | null>(null);
  const [openAgentSessionRequest, setOpenAgentSessionRequest] = useState<{
    projectId: number;
    requestId: number;
    sessionId: number;
  } | null>(null);

  // ProjectApp 渲染 I18nProvider，自身位于 provider 之外；用 getFixedT 绑定 app 的
  // 当前 locale（首启 zh / 持久化值），保证启动状态文案与目录选择标题与界面语言一致。
  // getFixedT 每次调用都会返回新的函数引用，必须用 useMemo 固定，否则下方初始化 effect
  // 的依赖每次渲染都变，会与 setProjects 触发的重渲染形成闭环：旧 closure 在 openProject
  // (真实 Tauri IPC，毫秒级) resolve 前被清理，setSelectedProject 被跳过，新窗口永远停在
  // ProjectHome（项目列表）而打不开项目工作台。
  const translate = useMemo(() => i18next.getFixedT(getDefaultLocale()), []);

  useEffect(() => {
    let isMounted = true;

    async function initializeApp() {
      try {
        await initializeLocalData();
      } catch (error: unknown) {
        if (isMounted) {
          setLocalDataError(getCommandErrorMessage(error, translate));
        }

        return;
      }

      // 项目列表与 openProject 并行：新窗口 ?projectId= 路径不应被 listProjects 串行拖住，
      // 以便尽快结束「正在打开项目…」并进入默认 Issues 工作台。
      const listProjectsTask = listProjects()
        .then((response) => {
          if (isMounted) {
            setProjects(response.projects.map(toProjectSummary));
          }
        })
        .catch((error: unknown) => {
          if (isMounted) {
            setLocalDataError(getCommandErrorMessage(error, translate));
          }
        });

      try {
        const project = await openInitialProjectFromUrl();
        if (isMounted && project) {
          const projectSummary = toProjectSummary(project);
          setProjects((currentProjects) =>
            mergeProject(currentProjects, projectSummary),
          );
          setSelectedProject(projectSummary);
        }
      } catch (error: unknown) {
        if (isMounted) {
          setProjectOpenError(getCommandErrorMessage(error, translate));
        }
      }

      await listProjectsTask;
    }

    void initializeApp();

    return () => {
      isMounted = false;
    };
  }, [translate]);

  useEffect(() => {
    let isDisposed = false;
    let requestId = 0;

    async function openProjectForAgentSession(
      payload: OpenAgentSessionEventPayload,
      nextRequestId: number,
    ) {
      setProjectOpenError(null);

      try {
        if (selectedProject?.id !== payload.projectId) {
          const openedProject = await openProject({
            projectId: payload.projectId,
          });
          const projectSummary = toProjectSummary(openedProject);

          if (isDisposed) {
            return;
          }

          setProjects((currentProjects) =>
            mergeProject(currentProjects, projectSummary),
          );
          setSelectedProject(projectSummary);
        }

        if (!isDisposed) {
          setOpenAgentSessionRequest({
            projectId: payload.projectId,
            requestId: nextRequestId,
            sessionId: payload.sessionId,
          });
        }
      } catch (error: unknown) {
        if (!isDisposed) {
          setProjectOpenError(getCommandErrorMessage(error, translate));
        }
      }
    }

    const unsubscribe = subscribeTauriEvent<OpenAgentSessionEventPayload>(
      OPEN_AGENT_SESSION_EVENT,
      (payload) => {
        requestId += 1;
        void openProjectForAgentSession(payload, requestId);
      },
    );

    return () => {
      isDisposed = true;
      unsubscribe();
    };
  }, [selectedProject?.id, translate]);

  const startCreateProject = useCallback(
    async (openInNewWindow: boolean) => {
      if (isCreatingProject) {
        return;
      }

      setProjectCreationError(null);
      setProjectOpenError(null);
      setIsCreatingProject(true);

      try {
        const selectedPath = await open({
          directory: true,
          multiple: false,
          title: translate("projectHome.selectGitRepository"),
        });

        if (typeof selectedPath !== "string") {
          return;
        }

        const validatedProject = await validateProjectRepoPath({
          repoPath: selectedPath,
        });
        setCreateProjectDraft({
          name: validatedProject.suggestedName,
          openInNewWindow,
          repoPath: validatedProject.repoPath,
          suggestedName: validatedProject.suggestedName,
          worktreeLocation: "repo_sibling",
          worktreeSetupCommand: initialWorktreeSetupCommand(
            "",
            validatedProject.repoPath,
          ),
        });
      } catch (error) {
        setProjectCreationError(getCommandErrorMessage(error, translate));
      } finally {
        setIsCreatingProject(false);
      }
    },
    [translate, isCreatingProject, setCreateProjectDraft],
  );

  function handleCreateProject() {
    void startCreateProject(false);
  }

  function handleCreateProjectFromSwitcher() {
    void startCreateProject(true);
  }

  async function handleOpenInCurrentWindow(project: ProjectSummary) {
    setProjectCreationError(null);
    setProjectOpenError(null);

    try {
      const openedProject = await openProject({ projectId: project.id });
      const projectSummary = toProjectSummary(openedProject);
      setProjects((currentProjects) =>
        mergeProject(currentProjects, projectSummary),
      );
      setSelectedProject(projectSummary);
    } catch (error) {
      setProjectOpenError(getCommandErrorMessage(error, translate));
    }
  }

  async function handleProjectOpen(project: ProjectSummary) {
    setProjectCreationError(null);
    setProjectOpenError(null);

    try {
      if (project.hasOpenWindow) {
        await openProjectWindow({ projectId: project.id });
        return;
      }

      const openedProject = await openProject({ projectId: project.id });
      const projectSummary = toProjectSummary(openedProject);
      setProjects((currentProjects) =>
        mergeProject(currentProjects, projectSummary),
      );
      setSelectedProject(projectSummary);
    } catch (error) {
      setProjectOpenError(getCommandErrorMessage(error, translate));
    }
  }

  const refreshProjects = useCallback(async () => {
    const response = await listProjects();
    setProjects(response.projects.map(toProjectSummary));
  }, []);

  const handleProjectUpdated = useCallback((project: ProjectSummary) => {
    setSelectedProject((currentProject) =>
      currentProject?.id === project.id ? project : currentProject,
    );
    setProjects((currentProjects) => mergeProject(currentProjects, project));
  }, []);

  const handleCreateProjectConfirmed = useCallback(
    async (input: CreateProjectInput) => {
      const project = await createProject(input);
      const projectSummary = toProjectSummary(project);
      setProjects((currentProjects) =>
        mergeProject(currentProjects, projectSummary),
      );

      if (createProjectDraft?.openInNewWindow) {
        await openProjectWindow({ projectId: project.id });
      } else {
        setSelectedProject(projectSummary);
      }

      setCreateProjectDraft(null);
    },
    [createProjectDraft],
  );

  const isOpeningUrlProject = new URLSearchParams(window.location.search).has(
    "projectId",
  );
  // 新窗口以 ?projectId=X 启动时，selectedProject 初始为 null，首帧会渲染 ProjectHome
  // （项目列表），openProject IPC resolve 后才切到 AppShell——用户看到“项目列表一闪而过
  // 再出现目标项目窗口”。这段加载窗口内改渲染轻量加载占位，避免项目列表页被绘出。
  const isUrlProjectLoading =
    isOpeningUrlProject &&
    !selectedProject &&
    !projectOpenError &&
    !localDataError;

  if (isUrlProjectLoading) {
    return (
      <I18nProvider initialLocale={getDefaultLocale()}>
        <main className="project-opening">
          <header
            className="project-opening__window-header"
            data-tauri-drag-region
          />
          <p className="project-opening__status" role="status">
            {translate("app.openingProject")}
          </p>
        </main>
      </I18nProvider>
    );
  }

  if (!selectedProject) {
    const statusMessages = [
      {
        label: translate("app.localDataStatus"),
        message: localDataError,
      },
      {
        label: translate("app.projectCreationStatus"),
        message: projectCreationError,
      },
      {
        label: translate("app.openProjectStatus"),
        message: projectOpenError,
      },
    ].filter(
      (status): status is { label: string; message: string } =>
        status.message !== null,
    );

    return (
      <I18nProvider initialLocale={getDefaultLocale()}>
        {statusMessages.length > 0 ? (
          <div className="local-data-status-stack">
            {statusMessages.map((status) => (
              <div
                className="local-data-status"
                key={status.label}
                role="status"
                aria-label={status.label}
              >
                {status.message}
              </div>
            ))}
          </div>
        ) : null}
        <ProjectHome
          isCreatingProject={isCreatingProject}
          projects={projects}
          onCreateProject={handleCreateProject}
          onProjectOpen={handleProjectOpen}
          onOpenInCurrentWindow={handleOpenInCurrentWindow}
          onProjectsRefresh={refreshProjects}
        />
        {createProjectDraft ? (
          <CreateProjectDialog
            key={createProjectDraft.repoPath}
            initialDraft={createProjectDraft}
            onClose={() => setCreateProjectDraft(null)}
            onCreate={handleCreateProjectConfirmed}
          />
        ) : null}
      </I18nProvider>
    );
  }

  return (
    <I18nProvider initialLocale={getDefaultLocale()}>
      <>
        <AppShell
          onOpenInCurrentWindow={handleOpenInCurrentWindow}
          onCreateProject={handleCreateProjectFromSwitcher}
          onProjectUpdated={handleProjectUpdated}
          project={selectedProject}
          projects={projects}
          onProjectsRefresh={refreshProjects}
          openAgentSessionRequest={openAgentSessionRequest}
        />
        <Toaster />
        {createProjectDraft ? (
          <CreateProjectDialog
            key={createProjectDraft.repoPath}
            initialDraft={createProjectDraft}
            onClose={() => setCreateProjectDraft(null)}
            onCreate={handleCreateProjectConfirmed}
          />
        ) : null}
      </>
    </I18nProvider>
  );
}

function toProjectSummary(
  project: ProjectRecord | ProjectListItem,
): ProjectSummary {
  // ProjectListItem（Omit 了 codeWorkspaces）不带该字段；只有完整 ProjectRecord 才有。
  const codeWorkspaces =
    "codeWorkspaces" in project ? (project.codeWorkspaces ?? []) : [];
  return {
    id: project.id,
    name: project.name,
    path: project.repoPath,
    worktreeLocation: project.worktreeLocation,
    worktreeSetupCommand: project.worktreeSetupCommand,
    recentOpenedAt: `Opened ${formatLocalTimestamp(project.lastOpenedAt)}`,
    status: "pathStatus" in project ? project.pathStatus : "available",
    hasOpenWindow:
      "hasOpenWindow" in project ? Boolean(project.hasOpenWindow) : false,
    codeWorkspaces,
  };
}

function formatLocalTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toLocaleString();
}

function mergeProject(
  currentProjects: ProjectSummary[],
  nextProject: ProjectSummary,
): ProjectSummary[] {
  const remainingProjects = currentProjects.filter(
    (project) => project.id !== nextProject.id,
  );

  return [nextProject, ...remainingProjects];
}

function openInitialProjectFromUrl(): Promise<ProjectRecord | null> {
  const projectIdParam = new URLSearchParams(window.location.search).get(
    "projectId",
  );

  if (!projectIdParam) {
    return Promise.resolve(null);
  }

  const projectId = Number(projectIdParam);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return Promise.reject({
      code: "PROJECT_NOT_FOUND",
      message: i18next.getFixedT(getDefaultLocale())("app.projectNotFound"),
    });
  }

  return openProject({ projectId });
}

interface CreateProjectDialogProps {
  initialDraft: CreateProjectDraft;
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => Promise<void>;
}

function CreateProjectDialog({
  initialDraft,
  onClose,
  onCreate,
}: CreateProjectDialogProps) {
  const { messages, t } = useI18n();
  const [projectNameValue, setProjectNameValue] = useState(initialDraft.name);
  const [projectPathValue, setProjectPathValue] = useState(
    initialDraft.repoPath,
  );
  const [worktreeLocationValue, setWorktreeLocationValue] =
    useState<ProjectWorktreeLocation>(initialDraft.worktreeLocation);
  const [worktreeSetupCommandValue, setWorktreeSetupCommandValue] = useState(
    initialDraft.worktreeSetupCommand,
  );
  const [suggestedName, setSuggestedName] = useState(
    initialDraft.suggestedName,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChoosingRepoPath, setIsChoosingRepoPath] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmedProjectName = projectNameValue.trim();
  const trimmedProjectPath = projectPathValue.trim();
  const isSubmitDisabled =
    isSubmitting ||
    isChoosingRepoPath ||
    trimmedProjectName.length === 0 ||
    trimmedProjectPath.length === 0;

  async function handleChooseRepoPath() {
    setErrorMessage(null);
    setIsChoosingRepoPath(true);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: messages.createProject.selectGitRepository,
      });

      if (typeof selectedPath !== "string") {
        return;
      }

      const validatedProject = await validateProjectRepoPath({
        repoPath: selectedPath,
      });
      const shouldReplaceName =
        trimmedProjectName.length === 0 || trimmedProjectName === suggestedName;
      const currentDetectedCommand =
        detectWorktreeSetupCommand(projectPathValue);
      const nextDetectedCommand = detectWorktreeSetupCommand(
        validatedProject.repoPath,
      );

      setProjectPathValue(validatedProject.repoPath);
      setSuggestedName(validatedProject.suggestedName);
      if (shouldReplaceName) {
        setProjectNameValue(validatedProject.suggestedName);
      }
      if (
        worktreeSetupCommandValue.trim().length === 0 ||
        worktreeSetupCommandValue === currentDetectedCommand
      ) {
        setWorktreeSetupCommandValue(nextDetectedCommand ?? "");
      }
    } catch (error: unknown) {
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsChoosingRepoPath(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await onCreate({
        name: trimmedProjectName,
        repoPath: trimmedProjectPath,
        worktreeLocation: worktreeLocationValue,
        worktreeSetupCommand: worktreeSetupCommandValue.trim(),
      });
    } catch (error: unknown) {
      setErrorMessage(getCommandErrorMessage(error, t));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="issue-dialog-overlay" role="presentation">
      <div
        className="issue-dialog issue-dialog--compact"
        role="dialog"
        aria-label={messages.createProject.dialogTitle}
      >
        <div className="issue-dialog__header">
          <h3>{messages.createProject.dialogTitle}</h3>
        </div>
        <div className="issue-dialog__body issue-dialog__body--single">
          <ProjectDetailsForm
            ariaStatusLabel={messages.createProject.status}
            cancelLabel={messages.settings.cancel}
            chooseFolderLabel={messages.projectHome.chooseFolder}
            className="settings-card settings-general-card project-details-card"
            errorMessage={errorMessage}
            isChoosingRepoPath={isChoosingRepoPath}
            isSubmitting={isSubmitting}
            onCancel={onClose}
            onChooseRepoPath={handleChooseRepoPath}
            onNameChange={setProjectNameValue}
            onSubmit={handleSubmit}
            onWorktreeLocationChange={setWorktreeLocationValue}
            onWorktreeSetupCommandChange={setWorktreeSetupCommandValue}
            projectName={projectNameValue}
            projectNameLabel={messages.settings.projectName}
            repoPath={projectPathValue}
            repoPathLabel={messages.settings.repositoryPath}
            submitDisabled={isSubmitDisabled}
            submitLabel={messages.createProject.create}
            submittingLabel={messages.createProject.creating}
            worktreeLocation={worktreeLocationValue}
            worktreeLocationLabel={messages.settings.worktreePath}
            worktreeSetupCommand={worktreeSetupCommandValue}
            worktreeSetupCommandLabel={
              messages.settings.worktreeSetupAfterCreation
            }
            worktreeSetupCommandPlaceholder={
              messages.createProject.worktreeSetupPlaceholder
            }
          />
        </div>
      </div>
    </div>
  );
}
