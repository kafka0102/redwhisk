import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import type { UpdateStatus } from "../../shared/commands/app-update-commands";
import { AboutPanel } from "./about-panel";

const checkForUpdatesMock = vi.fn();
const openReleasePageMock = vi.fn();
let hookState: {
  status: UpdateStatus | null;
  isChecking: boolean;
  checkError: string | null;
  checkForUpdates: () => Promise<void>;
};

vi.mock("../app-update/use-update-status", () => ({
  useUpdateStatus: () => hookState,
}));

vi.mock("../app-update/open-release-page", () => ({
  openReleasePage: (...args: unknown[]) => openReleasePageMock(...args),
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
    errorCode: null,
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
    checkForUpdatesMock.mockReset();
    openReleasePageMock.mockReset();
    openReleasePageMock.mockResolvedValue(true);
    checkForUpdatesMock.mockResolvedValue(undefined);
    hookState = {
      status: buildStatus(),
      isChecking: false,
      checkError: null,
      checkForUpdates: checkForUpdatesMock,
    };
  });

  it("renders product identity and version from shared hook status", () => {
    renderAbout();

    expect(
      screen.getByRole("heading", { name: "RedWhisk" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/以 Issue 为核心的本地 AI Coding 工作台/),
    ).toBeInTheDocument();
    expect(screen.getByText("版本 0.0.3")).toBeInTheDocument();
  });

  it("triggers force check via shared hook", async () => {
    const user = userEvent.setup();
    renderAbout();

    await user.click(screen.getByRole("button", { name: "检查更新" }));
    expect(checkForUpdatesMock).toHaveBeenCalledTimes(1);
  });

  it("shows update available and opens release", async () => {
    const user = userEvent.setup();
    hookState = {
      status: buildStatus({
        hasUpdate: true,
        shouldShowPrompt: true,
        latestVersion: "0.1.0",
        releaseUrl: "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
      }),
      isChecking: false,
      checkError: null,
      checkForUpdates: checkForUpdatesMock,
    };

    renderAbout();
    // 需要先有一次检查反馈 — 点击检查后 About 会记住 hasChecked
    await user.click(screen.getByRole("button", { name: "检查更新" }));

    const updateButton = await screen.findByRole("button", {
      name: "可更新至 0.1.0",
    });
    await user.click(updateButton);
    expect(openReleasePageMock).toHaveBeenCalledWith(
      "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
    );
  });

  it("shows ignored version state after check", async () => {
    const user = userEvent.setup();
    hookState = {
      status: buildStatus({
        hasUpdate: true,
        shouldShowPrompt: false,
        latestVersion: "0.1.0",
        ignoredVersion: "0.1.0",
        releaseUrl: "https://github.com/kafka0102/redwhisk/releases/tag/v0.1.0",
      }),
      isChecking: false,
      checkError: null,
      checkForUpdates: checkForUpdatesMock,
    };

    renderAbout();
    await user.click(screen.getByRole("button", { name: "检查更新" }));

    await waitFor(() => {
      expect(screen.getByText("0.1.0 已忽略")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "打开更新页面" }),
    ).toBeInTheDocument();
  });

  it("shows i18n error for errorCode without raw network body", async () => {
    const user = userEvent.setup();
    hookState = {
      status: buildStatus({
        errorCode: "network",
      }),
      isChecking: false,
      checkError: null,
      checkForUpdates: checkForUpdatesMock,
    };

    renderAbout();
    await user.click(screen.getByRole("button", { name: "检查更新" }));

    await waitFor(() => {
      expect(screen.getByText("网络异常，请稍后重试")).toBeInTheDocument();
    });
  });
});
