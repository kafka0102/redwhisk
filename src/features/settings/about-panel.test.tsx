import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { AboutPanel } from "./about-panel";
import type { UpdateStatus } from "../../shared/commands/app-update-commands";

const getUpdateStatusMock = vi.fn();
const openUrlMock = vi.fn();

vi.mock("../../shared/commands/app-update-commands", async () => {
  const actual = await vi.importActual<
    typeof import("../../shared/commands/app-update-commands")
  >("../../shared/commands/app-update-commands");
  return {
    ...actual,
    getUpdateStatus: (...args: unknown[]) => getUpdateStatusMock(...args),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
}));

function buildStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    shouldShowPrompt: false,
    currentVersion: "0.0.3",
    hasUpdate: false,
    latestVersion: "0.0.3",
    releaseUrl: "https://github.com/kafka0102/redwhisk/releases/tag/v0.0.3",
    ignoredVersion: null,
    snoozeUntil: null,
    checkedAt: "2026-07-14T12:00:00.000Z",
    error: null,
    ...overrides,
  };
}

function renderAbout() {
  return render(
    <I18nProvider fixedLocale="zh">
      <AboutPanel />
    </I18nProvider>,
  );
}

describe("AboutPanel", () => {
  beforeEach(() => {
    getUpdateStatusMock.mockReset();
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue(undefined);
    getUpdateStatusMock.mockResolvedValue(buildStatus());
  });

  it("renders product name, description and loads version quietly", async () => {
    renderAbout();

    expect(
      screen.getByRole("heading", { name: "RedWhisk" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/以 Issue 为核心的本地 AI Coding 工作台/),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("版本 0.0.3")).toBeInTheDocument();
    });
    expect(getUpdateStatusMock).toHaveBeenCalledWith({ forceRefresh: false });
  });

  it("shows up-to-date after manual check", async () => {
    const user = userEvent.setup();
    getUpdateStatusMock
      .mockResolvedValueOnce(buildStatus())
      .mockResolvedValueOnce(buildStatus());

    renderAbout();
    await waitFor(() => {
      expect(screen.getByText("版本 0.0.3")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "检查更新" }));

    await waitFor(() => {
      expect(screen.getByText("已是最新版本")).toBeInTheDocument();
    });
    expect(getUpdateStatusMock).toHaveBeenLastCalledWith({
      forceRefresh: true,
    });
  });

  it("shows available update and opens release page", async () => {
    const user = userEvent.setup();
    getUpdateStatusMock
      .mockResolvedValueOnce(buildStatus())
      .mockResolvedValueOnce(
        buildStatus({
          hasUpdate: true,
          shouldShowPrompt: true,
          latestVersion: "0.1.0",
          releaseUrl:
            "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
        }),
      );

    renderAbout();
    await waitFor(() => {
      expect(screen.getByText("版本 0.0.3")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "检查更新" }));

    const updateButton = await screen.findByRole("button", {
      name: "可更新至 0.1.0",
    });
    await user.click(updateButton);

    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
    );
  });

  it("shows ignored version state", async () => {
    const user = userEvent.setup();
    getUpdateStatusMock
      .mockResolvedValueOnce(buildStatus())
      .mockResolvedValueOnce(
        buildStatus({
          hasUpdate: true,
          shouldShowPrompt: false,
          latestVersion: "0.1.0",
          ignoredVersion: "0.1.0",
          releaseUrl:
            "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
        }),
      );

    renderAbout();
    await waitFor(() => {
      expect(screen.getByText("版本 0.0.3")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "检查更新" }));

    await waitFor(() => {
      expect(screen.getByText("0.1.0 已忽略")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "打开更新页面" }),
    ).toBeInTheDocument();
  });

  it("shows error feedback when force check fails", async () => {
    const user = userEvent.setup();
    getUpdateStatusMock
      .mockResolvedValueOnce(buildStatus())
      .mockRejectedValueOnce(new Error("network down"));

    renderAbout();
    await waitFor(() => {
      expect(screen.getByText("版本 0.0.3")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "检查更新" }));

    await waitFor(() => {
      expect(screen.getByText(/检查更新失败/)).toBeInTheDocument();
      expect(screen.getByText(/network down/)).toBeInTheDocument();
    });
  });
});
