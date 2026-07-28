import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "../../app/app";
import { I18nProvider } from "../../shared/i18n/i18n";
import "../../shared/styles/workbench-shell.css";
import { ProjectHome } from "./project-home";

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

describe("ProjectHome list scrolling", () => {
  it("gives the project list a constrained scroll container when many projects exist", () => {
    render(
      <I18nProvider initialLocale="zh">
        <ProjectHome
          isCreatingProject={false}
          projects={makeProjects(40)}
          onCreateProject={() => undefined}
          onProjectOpen={() => undefined}
          onOpenInCurrentWindow={() => undefined}
          onProjectsRefresh={async () => undefined}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Project 40")).toBeInTheDocument();

    const home = document.querySelector(".project-home");
    const shell = document.querySelector(".project-list-shell");
    const list = document.querySelector(".project-list");

    expect(home).toBeTruthy();
    expect(shell).toBeTruthy();
    expect(list).toBeTruthy();

    const homeStyle = window.getComputedStyle(home!);
    const shellStyle = window.getComputedStyle(shell!);
    const listStyle = window.getComputedStyle(list!);

    // body 全局 overflow:hidden，首页必须自建可滚区域。
    expect(homeStyle.height).toBe("100vh");
    expect(homeStyle.overflow).toMatch(/hidden|clip/);
    expect(shellStyle.minHeight).toBe("0px");
    expect(listStyle.overflowY).toMatch(/auto|scroll/);
    expect(listStyle.minHeight).toBe("0px");
  });
});
