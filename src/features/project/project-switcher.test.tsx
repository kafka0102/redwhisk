import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "../../app/app";
import { I18nProvider } from "../../shared/i18n/i18n";
import "../../shared/styles/project-switcher.css";
import { openProjectWindow } from "./project-commands";
import { ProjectSwitcher } from "./project-switcher";

const openProjectWindowMock = vi.mocked(openProjectWindow);

vi.mock("./project-commands", () => ({
  openProjectWindow: vi.fn(),
  removeProjectFromList: vi.fn(),
  deleteProject: vi.fn(),
}));

function makeProjects(count: number): ProjectSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Project ${index + 1}`,
    path: `/Users/test/workspace/project-${index + 1}`,
    worktreeLocation: "repo_sibling",
    worktreeSetupCommand: "",
    recentOpenedAt: "2026-07-01T00:00:00.000Z",
    status: "available",
    hasOpenWindow: false,
  }));
}

describe("ProjectSwitcher list scrolling", () => {
  it("constrains the project list so many projects can scroll", async () => {
    const user = userEvent.setup();
    const projects = makeProjects(40);

    render(
      <I18nProvider initialLocale="zh">
        <ProjectSwitcher
          currentProject={projects[0]!}
          projects={projects}
          onCreateProject={() => undefined}
          onOpenInCurrentWindow={async () => undefined}
          onProjectsRefresh={async () => undefined}
        />
      </I18nProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "当前项目 Project 1" }),
    );

    expect(screen.getByText("Project 40")).toBeInTheDocument();

    const list = document.querySelector(".project-switcher__list");
    expect(list).toBeTruthy();

    const listStyle = window.getComputedStyle(list!);
    // 项目较多时列表应自带滚动，而不是被视口裁切且无法查看。
    expect(listStyle.overflowY).toMatch(/auto|scroll/);
    expect(listStyle.maxHeight).not.toBe("none");
    expect(listStyle.maxHeight).not.toBe("");
  });
});

describe("ProjectSwitcher more menu", () => {
  beforeEach(() => {
    openProjectWindowMock.mockReset();
    openProjectWindowMock.mockResolvedValue({
      projectId: 2,
      windowLabel: "project-2",
    });
  });

  async function openMoreMenu(
    user: ReturnType<typeof userEvent.setup>,
    projects: ProjectSummary[],
    onOpenInCurrentWindow: (project: ProjectSummary) => Promise<void>,
  ) {
    render(
      <I18nProvider initialLocale="zh">
        <ProjectSwitcher
          currentProject={projects[0]!}
          projects={projects}
          onCreateProject={() => undefined}
          onOpenInCurrentWindow={onOpenInCurrentWindow}
          onProjectsRefresh={async () => undefined}
        />
      </I18nProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "当前项目 Project 1" }),
    );
    await user.click(screen.getByRole("button", { name: "更多操作" }));
  }

  async function clickMenuItem(name: string) {
    const item = await screen.findByRole("menuitem", { name });
    fireEvent.pointerDown(item, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(item, { button: 0, pointerType: "mouse" });
    fireEvent.click(item);
  }

  it("opens another project in the current window from the more menu", async () => {
    const user = userEvent.setup();
    const projects = makeProjects(2);
    const onOpenInCurrentWindow = vi.fn().mockResolvedValue(undefined);

    await openMoreMenu(user, projects, onOpenInCurrentWindow);
    await clickMenuItem("在当前窗口打开");

    await waitFor(() => {
      expect(onOpenInCurrentWindow).toHaveBeenCalledWith(projects[1]);
    });
  });

  it("opens another project in a new window from the more menu", async () => {
    const user = userEvent.setup();
    const projects = makeProjects(2);

    await openMoreMenu(user, projects, async () => undefined);
    await clickMenuItem("在新窗口打开");

    await waitFor(() => {
      expect(openProjectWindowMock).toHaveBeenCalledWith({ projectId: 2 });
    });
  });

  it("opens the remove confirmation from the more menu", async () => {
    const user = userEvent.setup();
    const projects = makeProjects(2);

    await openMoreMenu(user, projects, async () => undefined);
    await clickMenuItem("从列表中移除");

    expect(await screen.findByRole("dialog")).toHaveTextContent("从列表中移除");
  });

  it("opens the delete confirmation from the more menu", async () => {
    const user = userEvent.setup();
    const projects = makeProjects(2);

    await openMoreMenu(user, projects, async () => undefined);
    await clickMenuItem("删除项目");

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "删除项目将移除该项目的所有数据，确定要删除项目吗？",
    );
  });
});
