import { render, screen, within } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";
import {
  createIssue,
  listIssues,
  updateIssue,
  type IssueRecord,
} from "../features/issues/issue-commands";
import {
  getUserProfile,
  listProjectLabels,
} from "../features/settings/settings-commands";
import {
  createProject,
  initializeLocalData,
  listProjects,
  openProject,
  openProjectWindow,
  validateProjectRepoPath,
  type ProjectListResponse,
  type ProjectRecord,
} from "../features/project/project-commands";
import { resetIssuePageStateCacheForTests } from "../features/issues/issues-activity-cache";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const mockAppWindow = {
  label: "main",
  isMaximized: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => mockAppWindow),
}));

const tauriEventMocks = vi.hoisted(() => ({
  listeners: [] as Array<{
    eventName: string;
    callback: (event: {
      payload: { projectId: number; sessionId: number };
    }) => void;
  }>,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (
      eventName: string,
      callback: (event: {
        payload: { projectId: number; sessionId: number };
      }) => void,
    ) => {
      tauriEventMocks.listeners.push({ eventName, callback });
      return Promise.resolve(tauriEventMocks.unlisten);
    },
  ),
}));

vi.mock("../features/project/project-commands", () => ({
  createProject: vi.fn(),
  initializeLocalData: vi.fn(),
  listProjects: vi.fn(),
  openProject: vi.fn(),
  openProjectWindow: vi.fn(),
  validateProjectRepoPath: vi.fn(),
}));

vi.mock(
  "../features/agents/session-notifications/session-monitor-commands",
  () => ({
    closeSessionMonitorWindow: vi.fn(),
    OPEN_AGENT_SESSION_EVENT: "open-agent-session",
    openMonitoredAgentSession: vi.fn(),
    openSessionMonitorWindow: vi.fn().mockResolvedValue({
      windowLabel: "session-monitor-main",
    }),
  }),
);

vi.mock("../features/issues/issue-commands", () => ({
  createIssue: vi.fn(),
  listIssues: vi.fn(),
  updateIssue: vi.fn(),
}));

vi.mock("../features/settings/settings-commands", () => ({
  getUserProfile: vi.fn(),
  listProjectLabels: vi.fn(),
}));

vi.mock("../features/issues/issue-description-editor", () => ({
  IssueDescriptionEditor: ({
    ariaLabel,
    onChange,
    placeholder,
    value,
  }: {
    ariaLabel: string;
    onChange: (value: string) => void;
    placeholder: string;
    value: string;
  }) => (
    <div>
      <textarea
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  ),
}));

vi.mock("../features/agents/agents-activity", () => ({
  AgentsActivity: ({
    activeSessionId,
  }: {
    activeSessionId?: number | null;
  }) => <div>agents activity {activeSessionId}</div>,
}));

const { open } = await import("@tauri-apps/plugin-dialog");
const { getCurrentWindow } = await import("@tauri-apps/api/window");
const { openSessionMonitorWindow } =
  await import("../features/agents/session-notifications/session-monitor-commands");
const openDialogMock = vi.mocked(open);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);
const openSessionMonitorWindowMock = vi.mocked(openSessionMonitorWindow);
const createIssueMock = vi.mocked(createIssue);
const listIssuesMock = vi.mocked(listIssues);
const listProjectLabelsMock = vi.mocked(listProjectLabels);
const getUserProfileMock = vi.mocked(getUserProfile);
const updateIssueMock = vi.mocked(updateIssue);
const createProjectMock = vi.mocked(createProject);
const initializeLocalDataMock = vi.mocked(initializeLocalData);
const listProjectsMock = vi.mocked(listProjects);
const openProjectMock = vi.mocked(openProject);
const openProjectWindowMock = vi.mocked(openProjectWindow);
const validateProjectRepoPathMock = vi.mocked(validateProjectRepoPath);

describe("App project entry", () => {
  let currentProjectList: ProjectListResponse;
  let currentIssues: IssueRecord[];

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    // 用例断言中文文案；统一以 zh 作为测试 locale，默认/未存储行为由专门用例覆盖。
    window.localStorage.setItem("redwhisk.locale", "zh");
    tauriEventMocks.listeners.length = 0;
    tauriEventMocks.unlisten.mockReset();
    resetIssuePageStateCacheForTests();
    openDialogMock.mockReset();
    createProjectMock.mockReset();
    initializeLocalDataMock.mockReset();
    listProjectsMock.mockReset();
    openProjectMock.mockReset();
    openProjectWindowMock.mockReset();
    validateProjectRepoPathMock.mockReset();
    createIssueMock.mockReset();
    listIssuesMock.mockReset();
    listProjectLabelsMock.mockReset();
    getUserProfileMock.mockReset();
    updateIssueMock.mockReset();
    getCurrentWindowMock.mockClear();
    openSessionMonitorWindowMock.mockReset();
    openSessionMonitorWindowMock.mockResolvedValue({
      windowLabel: "session-monitor",
    });
    mockAppWindow.isMaximized.mockReset();
    mockAppWindow.maximize.mockReset();
    mockAppWindow.unmaximize.mockReset();
    mockAppWindow.isMaximized.mockResolvedValue(false);
    mockAppWindow.maximize.mockResolvedValue(undefined);
    mockAppWindow.unmaximize.mockResolvedValue(undefined);
    initializeLocalDataMock.mockResolvedValue({
      databaseExists: true,
      currentVersion: "0001_core",
      appliedVersions: [],
    });
    currentProjectList = {
      projects: [
        {
          id: 1,
          name: "RedWhisk",
          repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
          createdAt: 1_780_581_600_000,
          lastOpenedAt: 1_780_624_800_000,
          pathStatus: "available",
        },
        {
          id: 2,
          name: "Local Agents Lab",
          repoPath: "/Users/kafka0102/workspace/local-agents",
          createdAt: 1_780_578_000_000,
          lastOpenedAt: 1_780_621_200_000,
          pathStatus: "missing",
        },
      ],
    };
    listProjectsMock.mockImplementation(async () => currentProjectList);
    currentIssues = [];
    listProjectLabelsMock.mockResolvedValue({ labels: [] });
    getUserProfileMock.mockResolvedValue({ id: 1, name: "", avatarPath: null });
    listIssuesMock.mockImplementation(async ({ projectId }) => {
      expect(projectId).toBe(1);
      return { issues: currentIssues };
    });
    createIssueMock.mockImplementation(
      async ({ projectId, title, description }) => {
        const createdIssue = {
          id: 10,
          number: 10,
          projectId,
          title,
          description,
          status: "backlog" as const,
          createdAt: 1_780_632_000_000,
          updatedAt: 1_780_632_000_000,
          statusChangedAt: 1_780_632_000_000,
        };
        currentIssues = [createdIssue, ...currentIssues];
        return createdIssue;
      },
    );
    updateIssueMock.mockImplementation(
      async ({ projectId, issueId, title, description }) => {
        const updatedIssue = {
          id: issueId,
          number: issueId,
          projectId,
          title,
          description,
          status: "backlog" as const,
          createdAt: 1_780_632_000_000,
          updatedAt: 1_780_635_600_000,
          statusChangedAt: 1_780_635_600_000,
        };
        currentIssues = currentIssues.map((issue) =>
          issue.id === issueId ? updatedIssue : issue,
        );
        return updatedIssue;
      },
    );
    openProjectMock.mockImplementation(async ({ projectId }) => {
      const project = currentProjectList.projects.find(
        (item) => item.id === projectId,
      );

      if (!project || project.pathStatus === "missing") {
        throw {
          code: "PROJECT_REPO_PATH_UNAVAILABLE",
          message: "Project 路径不存在或不可访问。",
        };
      }

      return {
        id: project.id,
        name: project.name,
        repoPath: project.repoPath,
        createdAt: project.createdAt,
        lastOpenedAt: 1_780_628_400_000,
      };
    });
    openProjectWindowMock.mockResolvedValue({
      projectId: 3,
      windowLabel: "project-3",
    });
    validateProjectRepoPathMock.mockImplementation(async ({ repoPath }) => ({
      repoPath,
      suggestedName: repoPath.split("/").pop() ?? "repo",
    }));
  });

  it("initializes local data on app start", async () => {
    render(<App />);

    expect(initializeLocalDataMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("searchbox", { name: "搜索项目" }),
    ).toBeInTheDocument();
  });

  it("does not open the global desktop session monitor on app start", async () => {
    window.localStorage.setItem("redwhisk.sessionMonitor.enabled", "true");

    render(<App />);

    await waitFor(() => expect(initializeLocalDataMock).toHaveBeenCalled());
    expect(openSessionMonitorWindowMock).not.toHaveBeenCalled();
  });

  it("opens to Project Home without the 活动栏", async () => {
    render(<App />);

    expect(
      await screen.findByRole("searchbox", { name: "搜索项目" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新建项目" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Projects" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Local Git repositories available/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "活动栏" }),
    ).not.toBeInTheDocument();

    const projectList = screen.getByRole("list", { name: "本地项目" });
    const projectRows = within(projectList).getAllByRole("listitem");
    expect(projectRows).toHaveLength(2);
    expect(
      within(projectRows[0]).getByRole("button", {
        name: "打开项目 RedWhisk",
      }),
    ).toBeInTheDocument();
  });

  it("filters projects locally by project name and clears the search", async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开项目 Local Agents Lab" }),
    ).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "搜索项目" }), "red");

    expect(
      screen.getByRole("button", { name: "打开项目 RedWhisk" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开项目 Local Agents Lab" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空搜索" }));

    expect(
      screen.getByRole("button", { name: "打开项目 RedWhisk" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开项目 Local Agents Lab" }),
    ).toBeInTheDocument();
  });

  it("shortens project paths under the user home directory", async () => {
    render(<App />);

    expect(
      await screen.findByText("~/workspace/kafka/redwhisk"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("/Users/kafka0102/workspace/kafka/redwhisk"),
    ).not.toBeInTheDocument();
  });

  it("marks the Project Home window header as draggable and toggles maximize on double-click", async () => {
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("searchbox", { name: "搜索项目" });
    const header = document.querySelector(".project-home__window-header");

    expect(header).toHaveAttribute("data-tauri-drag-region");
    getCurrentWindowMock.mockClear();

    await user.dblClick(header!);

    await waitFor(() => expect(getCurrentWindowMock).toHaveBeenCalledTimes(1));
    expect(mockAppWindow.isMaximized).toHaveBeenCalledTimes(1);
    expect(mockAppWindow.maximize).toHaveBeenCalledTimes(1);
    expect(mockAppWindow.unmaximize).not.toHaveBeenCalled();
  });

  it("restores the Project Home window from its draggable header", async () => {
    mockAppWindow.isMaximized.mockResolvedValue(true);
    const user = userEvent.setup();

    render(<App />);

    await screen.findByRole("searchbox", { name: "搜索项目" });
    const header = document.querySelector(".project-home__window-header");

    expect(header).toHaveAttribute("data-tauri-drag-region");
    getCurrentWindowMock.mockClear();

    await user.dblClick(header!);

    await waitFor(() => expect(getCurrentWindowMock).toHaveBeenCalledTimes(1));
    expect(mockAppWindow.isMaximized).toHaveBeenCalledTimes(1);
    expect(mockAppWindow.unmaximize).toHaveBeenCalledTimes(1);
    expect(mockAppWindow.maximize).not.toHaveBeenCalled();
  });

  it("opens directly to a project workbench when the window URL carries a project id", async () => {
    window.history.replaceState(null, "", "/?projectId=1");

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "当前项目 RedWhisk" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Projects" }),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: "当前项目 RedWhisk" })
        .closest(".workbench__header")?.parentElement,
    ).toHaveClass("workbench");
    expect(
      screen
        .getByRole("button", { name: "当前项目 RedWhisk" })
        .closest(".workbench__header"),
    ).toHaveAttribute("data-tauri-drag-region");
    await waitFor(() =>
      expect(listIssuesMock).toHaveBeenCalledWith({
        projectId: 1,
        perStatusLimit: 20,
      }),
    );
  });

  it("opens the project workbench in a new window even when openProject IPC is slow", async () => {
    // 回归：getFixedT 每次渲染返回新引用曾导致初始化 effect 反复重跑，setProjects 触发的
    // 重渲染在 openProject resolve 前清理了旧 closure，setSelectedProject 被跳过，新窗口
    // 永远停在 ProjectHome。真实 Tauri IPC 是毫秒级，这里用 50ms 延迟复现该时序。
    window.history.replaceState(null, "", "/?projectId=1");
    openProjectMock.mockImplementation(async ({ projectId }) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const project = currentProjectList.projects.find(
        (item) => item.id === projectId,
      );
      if (!project || project.pathStatus === "missing") {
        throw {
          code: "PROJECT_REPO_PATH_UNAVAILABLE",
          message: "Project 路径不存在或不可访问。",
        };
      }
      return {
        id: project.id,
        name: project.name,
        repoPath: project.repoPath,
        createdAt: project.createdAt,
        lastOpenedAt: 1_780_628_400_000,
      };
    });

    render(<App />);

    expect(
      await screen.findByRole(
        "button",
        { name: "当前项目 RedWhisk" },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it("does not flash the project list page while opening a project window by projectId", async () => {
    // 回归：新窗口以 ?projectId=X 启动时 selectedProject 初始为 null，首帧会渲染
    // ProjectHome（项目列表），openProject IPC resolve 后才切到 AppShell，
    // 用户看到“项目列表一闪而过再出现目标项目窗口”。用 pending 的 openProject
    // 把加载窗口拉长到可观测，断言加载期间项目列表页（“搜索项目”搜索框）不出现。
    window.history.replaceState(null, "", "/?projectId=1");

    let resolveOpenProject: (project: ProjectRecord) => void = () => {};
    openProjectMock.mockImplementation(
      () =>
        new Promise<ProjectRecord>((resolve) => {
          resolveOpenProject = resolve;
        }),
    );

    render(<App />);

    expect(
      screen.queryByRole("searchbox", { name: "搜索项目" }),
    ).not.toBeInTheDocument();

    // 等 openProject 真正被调用，确保 resolveOpenProject 已接到真实 resolve
    await waitFor(() => expect(openProjectMock).toHaveBeenCalled());

    resolveOpenProject({
      id: 1,
      name: "RedWhisk",
      repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_628_400_000,
    });

    expect(
      await screen.findByRole("button", { name: "当前项目 RedWhisk" }),
    ).toBeInTheDocument();
  });

  it("opens a monitored session from the desktop monitor while on Project Home", async () => {
    render(<App />);

    await waitFor(() => {
      expect(tauriEventMocks.listeners).toHaveLength(1);
    });

    tauriEventMocks.listeners[0].callback({
      payload: { projectId: 1, sessionId: 77 },
    });

    expect(openProjectMock).toHaveBeenCalledWith({ projectId: 1 });
    expect(await screen.findByText("agents activity 77")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "智能体" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("maximizes the current window when double-clicking empty header space", async () => {
    window.history.replaceState(null, "", "/?projectId=1");
    const user = userEvent.setup();

    render(<App />);

    const switcher = await screen.findByRole("button", {
      name: "当前项目 RedWhisk",
    });
    const header = switcher.closest(".workbench__header");

    expect(header).not.toBeNull();
    getCurrentWindowMock.mockClear();

    await user.dblClick(header!);

    await waitFor(() => expect(getCurrentWindowMock).toHaveBeenCalledTimes(1));
    expect(mockAppWindow.isMaximized).toHaveBeenCalledTimes(1);
    expect(mockAppWindow.maximize).toHaveBeenCalledTimes(1);
    expect(mockAppWindow.unmaximize).not.toHaveBeenCalled();
  });

  it("restores the current window when double-clicking a maximized header", async () => {
    window.history.replaceState(null, "", "/?projectId=1");
    mockAppWindow.isMaximized.mockResolvedValue(true);
    const user = userEvent.setup();

    render(<App />);

    const switcher = await screen.findByRole("button", {
      name: "当前项目 RedWhisk",
    });
    const header = switcher.closest(".workbench__header");

    expect(header).not.toBeNull();
    getCurrentWindowMock.mockClear();

    await user.dblClick(header!);

    await waitFor(() => expect(getCurrentWindowMock).toHaveBeenCalledTimes(1));
    expect(mockAppWindow.isMaximized).toHaveBeenCalledTimes(1);
    expect(mockAppWindow.unmaximize).toHaveBeenCalledTimes(1);
    expect(mockAppWindow.maximize).not.toHaveBeenCalled();
  });

  it("does not maximize the window when clicking the project switcher trigger", async () => {
    window.history.replaceState(null, "", "/?projectId=1");
    const user = userEvent.setup();

    render(<App />);

    const switcher = await screen.findByRole("button", {
      name: "当前项目 RedWhisk",
    });
    getCurrentWindowMock.mockClear();

    await user.click(switcher);

    expect(mockAppWindow.isMaximized).not.toHaveBeenCalled();
    expect(mockAppWindow.maximize).not.toHaveBeenCalled();
    expect(screen.getByRole("menu", { name: "项目切换器" })).toBeVisible();
  });

  it("uses Chinese as the default UI language when no preference is stored", async () => {
    window.history.replaceState(null, "", "/?projectId=1");
    window.localStorage.removeItem("redwhisk.locale");

    render(<App />);

    expect(
      await screen.findByRole("navigation", { name: "活动栏" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issues" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "智能体" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "终端" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "项目设置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "全局设置" }),
    ).toBeInTheDocument();
  });

  it("shows URL project open failures as project open errors", async () => {
    window.history.replaceState(null, "", "/?projectId=2");

    render(<App />);

    expect(
      await screen.findByRole("status", { name: "打开项目状态" }),
    ).toHaveTextContent("Project 路径不存在或不可访问。");
    expect(
      screen.queryByRole("status", { name: "本地数据状态" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "活动栏" }),
    ).not.toBeInTheDocument();
  });

  it("opens the Project workbench with Issues selected by default", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    );

    expect(openProjectMock).toHaveBeenCalledWith({ projectId: 1 });
    const activityBar = screen.getByRole("navigation", {
      name: "活动栏",
    });
    const activityButtons = within(activityBar).getAllByRole("button");

    expect(
      activityButtons.map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Issues",
      "智能体",
      "代码",
      "变更",
      "终端",
      "项目设置",
      "全局设置",
    ]);
    expect(
      within(activityBar).getByRole("button", { name: "Issues" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(activityBar).getByRole("button", { name: "项目设置" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(activityBar).getByRole("button", { name: "全局设置" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "当前项目 RedWhisk" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("PROJECT")).not.toBeInTheDocument();
    expect(
      screen.getByRole("main").querySelector(".eyebrow"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).queryByText("RedWhisk"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(listIssuesMock).toHaveBeenCalledWith({
        projectId: 1,
        perStatusLimit: 20,
      }),
    );
  });

  it("opens global settings from the bottom activity bar icon without resetting project activities", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?projectId=1");

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Issues" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "智能体" }));
    await user.click(screen.getByRole("button", { name: "全局设置" }));

    expect(
      screen.getByRole("heading", { name: "个人资料" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全局设置" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "项目设置" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // 全局设置打开时，之前选中的活动按钮（智能体）应变为未选中态
    expect(screen.getByRole("button", { name: "智能体" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Issues" }));
    expect(screen.getByRole("button", { name: "Issues" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("creates a minimal issue with title and description only", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    );
    await user.click(await screen.findByRole("button", { name: "新建 Issue" }));
    expect(screen.getByPlaceholderText("Issue 标题")).toBeInTheDocument();
    expect(screen.getByLabelText("描述")).toBeInTheDocument();
    expect(screen.getByLabelText("添加标签")).toBeInTheDocument();
    await user.type(screen.getByLabelText("标题"), "draft local issue");
    await user.type(screen.getByLabelText("描述"), "small task shape");
    await user.click(screen.getByRole("button", { name: "创建 Issue" }));

    expect(createIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      title: "draft local issue",
      description: "small task shape",
      attachments: [],
      labelIds: [],
    });
    expect(
      await screen.findByRole("button", { name: "draft local issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("dialog", { name: "新建 Issue" }),
    ).not.toBeInTheDocument();
  });

  it("edits an issue by updating only title and description", async () => {
    const user = userEvent.setup();
    currentIssues = [
      {
        id: 20,
        number: 20,
        projectId: 1,
        title: "Existing issue",
        description: "Existing description",
        status: "backlog",
        createdAt: 1_780_632_000_000,
        updatedAt: 1_780_632_000_000,
        statusChangedAt: 1_780_632_000_000,
      },
    ];
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "Updated issue");
    await user.clear(screen.getByLabelText("描述"));
    await user.type(screen.getByLabelText("描述"), "Updated description");
    expect(screen.getByLabelText("添加标签")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(updateIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 20,
      title: "Updated issue",
      description: "Updated description",
      attachments: [],
      labelIds: [],
    });
    expect(
      screen.queryByRole("dialog", { name: "Issue 详情" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Updated issue" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the project toolbar and an empty list when there are no saved projects", async () => {
    currentProjectList = { projects: [] };

    render(<App />);

    expect(
      await screen.findByRole("searchbox", { name: "搜索项目" }),
    ).toHaveAttribute("placeholder", "搜索项目");
    expect(
      screen.getByRole("button", { name: "新建项目" }),
    ).toBeInTheDocument();
    const projectList = screen.getByRole("list", { name: "本地项目" });
    expect(within(projectList).queryAllByRole("listitem")).toHaveLength(0);
    expect(
      screen.queryByRole("heading", { name: "Projects" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("RedWhisk")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Local Git repositories available/i),
    ).not.toBeInTheDocument();
  });

  it("shows missing project path errors without opening the 活动栏", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "打开项目 Local Agents Lab",
      }),
    );

    expect(openProjectMock).toHaveBeenCalledWith({
      projectId: 2,
    });
    expect(
      await screen.findByRole("status", { name: "打开项目状态" }),
    ).toHaveTextContent("Project 路径不存在或不可访问。");
    expect(
      screen.queryByRole("navigation", { name: "活动栏" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("路径不可用")).toBeInTheDocument();
  });

  it("creates a project from the toolbar and opens Issues", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/Users/kafka0102/workspace/new-repo");
    createProjectMock.mockResolvedValue({
      id: 3,
      name: "new-repo",
      repoPath: "/Users/kafka0102/workspace/new-repo",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_581_600_000,
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "新建项目" }));

    expect(openDialogMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "选择 Git 仓库",
    });
    expect(validateProjectRepoPathMock).toHaveBeenCalledWith({
      repoPath: "/Users/kafka0102/workspace/new-repo",
    });
    expect(
      await screen.findByRole("dialog", { name: "新建项目" }),
    ).toBeInTheDocument();
    const projectDialog = screen.getByRole("dialog", { name: "新建项目" });
    expect(within(projectDialog).getByLabelText("项目名称")).toHaveValue(
      "new-repo",
    );
    expect(within(projectDialog).getByLabelText("仓库路径")).toHaveValue(
      "/Users/kafka0102/workspace/new-repo",
    );
    expect(
      within(projectDialog).getByLabelText("工作树路径"),
    ).toHaveTextContent("~/workspace/new-repo.worktrees");
    expect(
      within(projectDialog).getByLabelText("创建工作树后的初始化命令"),
    ).toHaveValue("");
    expect(
      within(projectDialog).getByLabelText("创建工作树后的初始化命令"),
    ).toHaveAttribute("placeholder", "请输入创建工作树后的初始化命令");
    await user.click(
      within(projectDialog).getByRole("button", { name: "创建项目" }),
    );
    expect(createProjectMock).toHaveBeenCalledWith({
      name: "new-repo",
      repoPath: "/Users/kafka0102/workspace/new-repo",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
    });
    expect(
      await screen.findByRole("heading", { name: "Issues" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "当前项目 new-repo" }),
    ).toBeInTheDocument();
  });

  it("shows project creation failure without opening the 活动栏", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/Users/kafka0102/workspace/plain-dir");
    validateProjectRepoPathMock.mockRejectedValue({
      code: "PROJECT_REPO_NOT_GIT_REPOSITORY",
      message: "所选目录不是 Git Repository。",
      details: [
        {
          "@type": "RepoPath",
          path: "/Users/kafka0102/workspace/plain-dir",
        },
      ],
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "新建项目" }));

    expect(
      await screen.findByRole("status", { name: "创建项目状态" }),
    ).toHaveTextContent("所选目录不是 Git Repository。");
    expect(
      screen.queryByRole("dialog", { name: "新建项目" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "活动栏" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "搜索项目" }),
    ).toBeInTheDocument();
  });

  it("shows dialog failures without opening the 活动栏", async () => {
    const user = userEvent.setup();
    openDialogMock.mockRejectedValue(new Error("dialog unavailable"));

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "新建项目" }));

    expect(
      await screen.findByRole("status", { name: "创建项目状态" }),
    ).toHaveTextContent("dialog unavailable");
    expect(createProjectMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("navigation", { name: "活动栏" }),
    ).not.toBeInTheDocument();
  });

  it("disables create while the directory dialog is pending", async () => {
    const user = userEvent.setup();
    let resolveDialog: (path: string | null) => void = () => {};
    openDialogMock.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveDialog = resolve;
        }),
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "新建项目" }));
    await user.click(screen.getByRole("button", { name: "创建项目中" }));

    expect(openDialogMock).toHaveBeenCalledTimes(1);

    resolveDialog(null);
    expect(
      await screen.findByRole("button", { name: "新建项目" }),
    ).toBeEnabled();
  });

  it("keeps project creation failures inside the confirmation dialog", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/Users/kafka0102/workspace/new-repo");
    createProjectMock.mockRejectedValue({
      code: "PROJECT_PERSISTENCE_FAILED",
      message: "Project 保存失败。",
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "新建项目" }));
    const projectDialog = await screen.findByRole("dialog", {
      name: "新建项目",
    });
    await user.click(
      within(projectDialog).getByRole("button", { name: "创建项目" }),
    );

    expect(
      await screen.findByRole("status", { name: "创建项目状态" }),
    ).toHaveTextContent("Project 保存失败。");
    expect(
      screen.getByRole("dialog", { name: "新建项目" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "活动栏" }),
    ).not.toBeInTheDocument();
  });

  it("shows a local data initialization failure without hiding Project Home", async () => {
    initializeLocalDataMock.mockRejectedValue({
      code: "LOCAL_DATA_INITIALIZATION_FAILED",
      message: "本地数据初始化失败。",
    });

    render(<App />);

    expect(
      await screen.findByRole("status", { name: "本地数据状态" }),
    ).toHaveTextContent("本地数据初始化失败。");
    expect(
      screen.getByRole("searchbox", { name: "搜索项目" }),
    ).toBeInTheDocument();
  });

  it("opens the project switcher with saved projects and marks the current project", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    );
    await user.click(screen.getByRole("button", { name: "当前项目 RedWhisk" }));

    const switcher = screen.getByRole("menu", { name: "项目切换器" });
    expect(
      within(switcher).getByRole("menuitem", { name: /RedWhisk/ }),
    ).toHaveTextContent("/Users/kafka0102/workspace/kafka/redwhisk");
    expect(within(switcher).getByLabelText("当前项目")).toBeInTheDocument();
    expect(
      within(switcher).getByRole("menuitem", { name: /Local Agents Lab/ }),
    ).toHaveTextContent("路径不可用");
  });

  it("selects another project from the switcher by opening a new window only", async () => {
    const user = userEvent.setup();
    currentProjectList = {
      projects: [
        {
          id: 1,
          name: "RedWhisk",
          repoPath: "/Users/kafka0102/workspace/kafka/redwhisk",
          createdAt: 1_780_581_600_000,
          lastOpenedAt: 1_780_624_800_000,
          pathStatus: "available",
        },
        {
          id: 3,
          name: "Other Project",
          repoPath: "/Users/kafka0102/workspace/other-project",
          createdAt: 1_780_578_000_000,
          lastOpenedAt: 1_780_621_200_000,
          pathStatus: "available",
        },
      ],
    };
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    );
    await user.click(screen.getByRole("button", { name: "当前项目 RedWhisk" }));
    await user.click(screen.getByRole("menuitem", { name: /Other Project/ }));

    expect(openProjectWindowMock).toHaveBeenCalledWith({
      projectId: 3,
    });
    expect(
      screen.getByRole("button", { name: "当前项目 RedWhisk" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menu", { name: "项目切换器" }),
    ).not.toBeInTheDocument();
  });

  it("creates a project from the switcher and opens it in a new window", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/Users/kafka0102/workspace/new-repo");
    createProjectMock.mockResolvedValue({
      id: 4,
      name: "new-repo",
      repoPath: "/Users/kafka0102/workspace/new-repo",
      createdAt: 1_780_581_600_000,
      lastOpenedAt: 1_780_581_600_000,
    });
    openProjectWindowMock.mockResolvedValue({
      projectId: 4,
      windowLabel: "project-4",
    });

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    );
    await user.click(screen.getByRole("button", { name: "当前项目 RedWhisk" }));
    await user.click(screen.getByRole("menuitem", { name: "创建项目" }));

    expect(openDialogMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "选择 Git 仓库",
    });
    expect(validateProjectRepoPathMock).toHaveBeenCalledWith({
      repoPath: "/Users/kafka0102/workspace/new-repo",
    });
    const projectDialog = await screen.findByRole("dialog", {
      name: "新建项目",
    });
    expect(within(projectDialog).getByLabelText("项目名称")).toHaveValue(
      "new-repo",
    );
    expect(within(projectDialog).getByLabelText("仓库路径")).toHaveValue(
      "/Users/kafka0102/workspace/new-repo",
    );

    await user.click(
      within(projectDialog).getByRole("button", { name: "创建项目" }),
    );

    expect(createProjectMock).toHaveBeenCalledWith({
      name: "new-repo",
      repoPath: "/Users/kafka0102/workspace/new-repo",
      worktreeLocation: "repo_sibling",
      worktreeSetupCommand: "",
    });
    expect(openProjectWindowMock).toHaveBeenCalledWith({
      projectId: 4,
    });
    expect(
      screen.getByRole("button", { name: "当前项目 RedWhisk" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "新建项目" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the switcher in the current window when selecting the current project", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    );
    await user.click(screen.getByRole("button", { name: "当前项目 RedWhisk" }));
    await user.click(screen.getByRole("menuitem", { name: /RedWhisk/ }));

    expect(openProjectWindowMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("menu", { name: "项目切换器" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "当前项目 RedWhisk" }),
    ).toBeInTheDocument();
  });

  it("closes the project switcher with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    );
    await user.click(screen.getByRole("button", { name: "当前项目 RedWhisk" }));

    expect(
      screen.getByRole("menu", { name: "项目切换器" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("menu", { name: "项目切换器" }),
    ).not.toBeInTheDocument();
  });

  it("closes the project switcher when clicking outside it", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "打开项目 RedWhisk" }),
    );
    await user.click(screen.getByRole("button", { name: "当前项目 RedWhisk" }));

    expect(
      screen.getByRole("menu", { name: "项目切换器" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { name: "Issues" }));

    expect(
      screen.queryByRole("menu", { name: "项目切换器" }),
    ).not.toBeInTheDocument();
  });
});
