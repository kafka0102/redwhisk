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
  createProject,
  initializeLocalData,
  listProjects,
  openProject,
  openProjectWindow,
  type ProjectListResponse,
} from "../features/project/project-commands";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../features/project/project-commands", () => ({
  createProject: vi.fn(),
  initializeLocalData: vi.fn(),
  listProjects: vi.fn(),
  openProject: vi.fn(),
  openProjectWindow: vi.fn(),
}));

vi.mock("../features/issues/issue-commands", () => ({
  createIssue: vi.fn(),
  listIssues: vi.fn(),
  updateIssue: vi.fn(),
}));

const { open } = await import("@tauri-apps/plugin-dialog");
const openDialogMock = vi.mocked(open);
const createIssueMock = vi.mocked(createIssue);
const listIssuesMock = vi.mocked(listIssues);
const updateIssueMock = vi.mocked(updateIssue);
const createProjectMock = vi.mocked(createProject);
const initializeLocalDataMock = vi.mocked(initializeLocalData);
const listProjectsMock = vi.mocked(listProjects);
const openProjectMock = vi.mocked(openProject);
const openProjectWindowMock = vi.mocked(openProjectWindow);

describe("App project entry", () => {
  let currentProjectList: ProjectListResponse;
  let currentIssues: IssueRecord[];

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    openDialogMock.mockReset();
    createProjectMock.mockReset();
    initializeLocalDataMock.mockReset();
    listProjectsMock.mockReset();
    openProjectMock.mockReset();
    openProjectWindowMock.mockReset();
    createIssueMock.mockReset();
    listIssuesMock.mockReset();
    updateIssueMock.mockReset();
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
    listIssuesMock.mockImplementation(async ({ projectId }) => {
      expect(projectId).toBe(1);
      return { issues: currentIssues };
    });
    createIssueMock.mockImplementation(
      async ({ projectId, title, description }) => {
        const createdIssue = {
          id: 10,
          projectId,
          title,
          description,
          status: "backlog" as const,
          createdAt: 1_780_632_000_000,
          updatedAt: 1_780_632_000_000,
        };
        currentIssues = [createdIssue, ...currentIssues];
        return createdIssue;
      },
    );
    updateIssueMock.mockImplementation(
      async ({ projectId, issueId, title, description }) => {
        const updatedIssue = {
          id: issueId,
          projectId,
          title,
          description,
          status: "backlog" as const,
          createdAt: 1_780_632_000_000,
          updatedAt: 1_780_635_600_000,
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
  });

  it("initializes local data on app start", async () => {
    render(<App />);

    expect(initializeLocalDataMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
  });

  it("opens to Project Home without the Activity Bar", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Activity Bar" }),
    ).not.toBeInTheDocument();

    const projectGrid = screen.getByRole("list", { name: "Local projects" });
    const projectCards = within(projectGrid).getAllByRole("listitem");
    expect(projectCards).toHaveLength(3);
    expect(
      within(projectCards[projectCards.length - 1]).getByRole("button", {
        name: "Create Project",
      }),
    ).toBeInTheDocument();
    expect(
      within(projectCards[0]).getByRole("button", {
        name: "Open project RedWhisk",
      }),
    ).toBeInTheDocument();
  });

  it("opens directly to a project workbench when the window URL carries a project id", async () => {
    window.history.replaceState(null, "", "/?projectId=1");

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Current project RedWhisk" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Projects" }),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: "Current project RedWhisk" })
        .closest(".workbench__header")?.parentElement,
    ).toHaveClass("workbench");
    expect(
      screen
        .getByRole("button", { name: "Current project RedWhisk" })
        .closest(".workbench__header"),
    ).toHaveAttribute("data-tauri-drag-region");
    await waitFor(() =>
      expect(listIssuesMock).toHaveBeenCalledWith({ projectId: 1 }),
    );
  });

  it("shows URL project open failures as project open errors", async () => {
    window.history.replaceState(null, "", "/?projectId=2");

    render(<App />);

    expect(
      await screen.findByRole("status", { name: "Project open status" }),
    ).toHaveTextContent("Project 路径不存在或不可访问。");
    expect(
      screen.queryByRole("status", { name: "Local data status" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Activity Bar" }),
    ).not.toBeInTheDocument();
  });

  it("opens the Project workbench with Issues selected by default", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Open project RedWhisk" }),
    );

    expect(openProjectMock).toHaveBeenCalledWith({ projectId: 1 });
    const activityBar = screen.getByRole("navigation", {
      name: "Activity Bar",
    });
    const activityButtons = within(activityBar).getAllByRole("button");

    expect(activityButtons.map((button) => button.textContent)).toEqual([
      "Issues",
      "Agents",
      "Settings",
    ]);
    expect(
      within(activityBar).getByRole("button", { name: "Issues" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Issues" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Current project RedWhisk" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("PROJECT")).not.toBeInTheDocument();
    expect(
      screen.getByRole("main").querySelector(".eyebrow"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).queryByText("RedWhisk"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(listIssuesMock).toHaveBeenCalledWith({ projectId: 1 }),
    );
  });

  it("creates a minimal issue with title and description only", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Open project RedWhisk" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Create Issue" }),
    );
    await user.type(screen.getByLabelText("Title"), "Draft local issue");
    await user.type(screen.getByLabelText("Description"), "Small task shape");
    await user.click(
      within(screen.getByRole("dialog", { name: "New Issue" })).getByRole(
        "button",
        { name: "Create Issue" },
      ),
    );

    expect(createIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      title: "Draft local issue",
      description: "Small task shape",
    });
    expect(
      await screen.findByRole("button", { name: "Draft local issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByDisplayValue("Draft local issue")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Small task shape")).toBeInTheDocument();
    expect(screen.queryByLabelText(/priority/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/label/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/assignee/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/milestone/i)).not.toBeInTheDocument();
  });

  it("edits an issue by updating only title and description", async () => {
    const user = userEvent.setup();
    currentIssues = [
      {
        id: 20,
        projectId: 1,
        title: "Existing issue",
        description: "Existing description",
        status: "backlog",
        createdAt: 1_780_632_000_000,
        updatedAt: 1_780_632_000_000,
      },
    ];
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Open project RedWhisk" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Existing issue" }),
    );
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Updated issue");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(
      screen.getByLabelText("Description"),
      "Updated description",
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(updateIssueMock).toHaveBeenCalledWith({
      projectId: 1,
      issueId: 20,
      title: "Updated issue",
      description: "Updated description",
    });
    expect(
      await screen.findByRole("button", { name: "Updated issue" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByDisplayValue("Updated issue")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Updated description")).toBeInTheDocument();
    expect(screen.queryByLabelText(/priority/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/label/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/assignee/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/milestone/i)).not.toBeInTheDocument();
  });

  it("shows only the create card when there are no saved projects", async () => {
    currentProjectList = { projects: [] };

    render(<App />);

    const projectGrid = await screen.findByRole("list", {
      name: "Local projects",
    });
    const projectCards = within(projectGrid).getAllByRole("listitem");
    expect(projectCards).toHaveLength(1);
    expect(
      within(projectCards[0]).getByRole("button", { name: "Create Project" }),
    ).toBeInTheDocument();
  });

  it("shows missing project path errors without opening the Activity Bar", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Open project Local Agents Lab",
      }),
    );

    expect(openProjectMock).toHaveBeenCalledWith({
      projectId: 2,
    });
    expect(
      await screen.findByRole("status", { name: "Project open status" }),
    ).toHaveTextContent("Project 路径不存在或不可访问。");
    expect(
      screen.queryByRole("navigation", { name: "Activity Bar" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/path unavailable/i)).toBeInTheDocument();
  });

  it("creates a project from the create card and opens Issues", async () => {
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

    await user.click(
      await screen.findByRole("button", { name: "Create Project" }),
    );

    expect(openDialogMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Select Git Repository",
    });
    expect(createProjectMock).toHaveBeenCalledWith({
      repoPath: "/Users/kafka0102/workspace/new-repo",
    });
    expect(
      await screen.findByRole("heading", { name: "Issues" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Current project new-repo" }),
    ).toBeInTheDocument();
  });

  it("shows project creation failure without opening the Activity Bar", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/Users/kafka0102/workspace/plain-dir");
    createProjectMock.mockRejectedValue({
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

    await user.click(
      await screen.findByRole("button", { name: "Create Project" }),
    );

    expect(
      await screen.findByRole("status", { name: "Project creation status" }),
    ).toHaveTextContent("所选目录不是 Git Repository。");
    expect(
      screen.queryByRole("navigation", { name: "Activity Bar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
  });

  it("shows dialog failures without opening the Activity Bar", async () => {
    const user = userEvent.setup();
    openDialogMock.mockRejectedValue(new Error("dialog unavailable"));

    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Create Project" }),
    );

    expect(
      await screen.findByRole("status", { name: "Project creation status" }),
    ).toHaveTextContent("dialog unavailable");
    expect(createProjectMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("navigation", { name: "Activity Bar" }),
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

    await user.click(
      await screen.findByRole("button", { name: "Create Project" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Creating Project…" }),
    );

    expect(openDialogMock).toHaveBeenCalledTimes(1);

    resolveDialog(null);
    expect(
      await screen.findByRole("button", { name: "Create Project" }),
    ).toBeEnabled();
  });

  it("shows a local data initialization failure without hiding Project Home", async () => {
    initializeLocalDataMock.mockRejectedValue({
      code: "LOCAL_DATA_INITIALIZATION_FAILED",
      message: "本地数据初始化失败。",
    });

    render(<App />);

    expect(
      await screen.findByRole("status", { name: "Local data status" }),
    ).toHaveTextContent("本地数据初始化失败。");
    expect(
      screen.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
  });

  it("opens the project switcher with saved projects and marks the current project", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Open project RedWhisk" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Current project RedWhisk" }),
    );

    const switcher = screen.getByRole("menu", { name: "Project Switcher" });
    expect(
      within(switcher).getByRole("menuitem", { name: /RedWhisk/ }),
    ).toHaveTextContent("/Users/kafka0102/workspace/kafka/redwhisk");
    expect(
      within(switcher).getByLabelText("Current project"),
    ).toBeInTheDocument();
    expect(
      within(switcher).getByRole("menuitem", { name: /Local Agents Lab/ }),
    ).toHaveTextContent("path unavailable");
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
      await screen.findByRole("button", { name: "Open project RedWhisk" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Current project RedWhisk" }),
    );
    await user.click(screen.getByRole("menuitem", { name: /Other Project/ }));

    expect(openProjectWindowMock).toHaveBeenCalledWith({
      projectId: 3,
    });
    expect(
      screen.getByRole("button", { name: "Current project RedWhisk" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menu", { name: "Project Switcher" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the switcher in the current window when selecting the current project", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Open project RedWhisk" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Current project RedWhisk" }),
    );
    await user.click(screen.getByRole("menuitem", { name: /RedWhisk/ }));

    expect(openProjectWindowMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("menu", { name: "Project Switcher" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Current project RedWhisk" }),
    ).toBeInTheDocument();
  });

  it("closes the project switcher with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Open project RedWhisk" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Current project RedWhisk" }),
    );

    expect(
      screen.getByRole("menu", { name: "Project Switcher" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("menu", { name: "Project Switcher" }),
    ).not.toBeInTheDocument();
  });

  it("closes the project switcher when clicking outside it", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Open project RedWhisk" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Current project RedWhisk" }),
    );

    expect(
      screen.getByRole("menu", { name: "Project Switcher" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("heading", { name: "Issues" }));

    expect(
      screen.queryByRole("menu", { name: "Project Switcher" }),
    ).not.toBeInTheDocument();
  });
});
