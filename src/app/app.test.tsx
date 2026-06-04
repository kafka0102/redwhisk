import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";
import { initializeLocalData } from "../features/project/project-commands";

vi.mock("../features/project/project-commands", () => ({
  initializeLocalData: vi.fn(),
}));

const initializeLocalDataMock = vi.mocked(initializeLocalData);

describe("App project entry", () => {
  beforeEach(() => {
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
