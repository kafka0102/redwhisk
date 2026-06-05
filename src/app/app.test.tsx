import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";
import {
  createProject,
  initializeLocalData,
} from "../features/project/project-commands";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../features/project/project-commands", () => ({
  createProject: vi.fn(),
  initializeLocalData: vi.fn(),
}));

const { open } = await import("@tauri-apps/plugin-dialog");
const openDialogMock = vi.mocked(open);
const createProjectMock = vi.mocked(createProject);
const initializeLocalDataMock = vi.mocked(initializeLocalData);

describe("App project entry", () => {
  beforeEach(() => {
    openDialogMock.mockReset();
    createProjectMock.mockReset();
    initializeLocalDataMock.mockReset();
    initializeLocalDataMock.mockResolvedValue({
      databaseExists: true,
      currentVersion: "0001_core",
      appliedVersions: [],
    });
  });

  it("initializes local data on app start", async () => {
    render(<App />);

    expect(initializeLocalDataMock).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
  });

  it("opens to Project Home without the Activity Bar", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Projects" }),
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
  });

  it("opens the Project workbench with Issues selected by default", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Open project RedWhisk" }),
    );

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
  });

  it("creates a project from the create card and opens Issues", async () => {
    const user = userEvent.setup();
    openDialogMock.mockResolvedValue("/Users/kafka0102/workspace/new-repo");
    createProjectMock.mockResolvedValue({
      id: "project-123",
      name: "new-repo",
      repoPath: "/Users/kafka0102/workspace/new-repo",
      createdAt: "2026-06-04T14:00:00.000Z",
      lastOpenedAt: "2026-06-04T14:00:00.000Z",
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Create Project" }));

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
      screen.getByText("/Users/kafka0102/workspace/new-repo"),
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

    await user.click(screen.getByRole("button", { name: "Create Project" }));

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

    await user.click(screen.getByRole("button", { name: "Create Project" }));

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

    await user.click(screen.getByRole("button", { name: "Create Project" }));
    await user.click(screen.getByRole("button", { name: "Creating Project" }));

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
});
