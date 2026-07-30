import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "../../app/app";
import { I18nProvider } from "../../shared/i18n/i18n";
import "../../shared/styles/project-switcher.css";
import { ProjectSwitcher } from "./project-switcher";

vi.mock("./project-commands", () => ({
  openProjectWindow: vi.fn(),
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
