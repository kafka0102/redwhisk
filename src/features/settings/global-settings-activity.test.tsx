import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { GlobalSettingsActivity } from "./global-settings-activity";
import {
  closeSessionMonitorWindow,
  openSessionMonitorWindow,
} from "../agents/session-notifications/session-monitor-commands";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ label: "main" })),
}));

vi.mock("../agents/session-notifications/session-monitor-commands", () => ({
  closeSessionMonitorWindow: vi.fn(),
  openSessionMonitorWindow: vi.fn(),
}));

const closeSessionMonitorWindowMock = vi.mocked(closeSessionMonitorWindow);
const openSessionMonitorWindowMock = vi.mocked(openSessionMonitorWindow);

function renderGlobalSettings() {
  return render(
    <I18nProvider fixedLocale="zh">
      <GlobalSettingsActivity />
    </I18nProvider>,
  );
}

describe("GlobalSettingsActivity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.stubGlobal("matchMedia", createMatchMedia(false));
    closeSessionMonitorWindowMock.mockReset();
    closeSessionMonitorWindowMock.mockResolvedValue({
      windowLabel: "session-monitor",
    });
    openSessionMonitorWindowMock.mockReset();
    openSessionMonitorWindowMock.mockResolvedValue({
      windowLabel: "session-monitor",
    });
  });

  it("renders Preferences in Chinese with Light theme by default", () => {
    renderGlobalSettings();

    expect(
      screen.getByRole("navigation", { name: "全局设置菜单" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "偏好设置" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "偏好设置" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
    expect(screen.queryByRole("button", { name: "中文" })).toBeNull();
    expect(screen.getByRole("button", { name: "浅色" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "深色" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "跟随系统" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("switch", {
        name: "启用通知浮窗",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("ignores the stored English locale preference", () => {
    window.localStorage.setItem("redwhisk.locale", "en");

    renderGlobalSettings();

    expect(
      screen.getByRole("heading", { name: "偏好设置" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Preferences" })).toBeNull();
  });

  it("persists Dark theme and applies it to the document root", async () => {
    const user = userEvent.setup();
    renderGlobalSettings();

    await user.click(screen.getByRole("button", { name: "深色" }));

    expect(screen.getByRole("button", { name: "深色" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem("redwhisk.theme")).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("persists System theme and follows the current system color scheme", async () => {
    vi.stubGlobal("matchMedia", createMatchMedia(true));
    const user = userEvent.setup();
    renderGlobalSettings();

    await user.click(screen.getByRole("button", { name: "跟随系统" }));

    expect(screen.getByRole("button", { name: "跟随系统" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem("redwhisk.theme")).toBe("system");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("uses the shared sidebar width by default", () => {
    renderGlobalSettings();

    const splitter = screen.getByRole("separator", {
      name: "调整设置菜单宽度",
    });

    expect(splitter).toHaveAttribute("aria-valuemin", "180");
    expect(splitter).toHaveAttribute("aria-valuemax", "420");
    expect(splitter).toHaveAttribute("aria-valuenow", "230");
  });

  it("persists the notification floating window preference and closes the monitor immediately", async () => {
    const user = userEvent.setup();
    renderGlobalSettings();

    await user.click(
      screen.getByRole("switch", {
        name: "启用通知浮窗",
      }),
    );

    expect(window.localStorage.getItem("redwhisk.sessionMonitor.enabled")).toBe(
      "false",
    );
    expect(closeSessionMonitorWindowMock).toHaveBeenCalledWith({
      ownerWindowLabel: "main",
    });
    expect(openSessionMonitorWindowMock).not.toHaveBeenCalled();
  });

  it("opens the notification floating window immediately when re-enabled", async () => {
    window.localStorage.setItem("redwhisk.sessionMonitor.enabled", "false");
    const user = userEvent.setup();
    renderGlobalSettings();

    await user.click(
      screen.getByRole("switch", {
        name: "启用通知浮窗",
      }),
    );

    expect(window.localStorage.getItem("redwhisk.sessionMonitor.enabled")).toBe(
      "true",
    );
    expect(openSessionMonitorWindowMock).toHaveBeenCalledWith({
      ownerWindowLabel: "main",
    });
    expect(closeSessionMonitorWindowMock).not.toHaveBeenCalled();
  });
});

function createMatchMedia(matches: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}
