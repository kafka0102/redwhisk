import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { GlobalSettingsActivity } from "./global-settings-activity";

function renderGlobalSettings() {
  return render(
    <I18nProvider>
      <GlobalSettingsActivity />
    </I18nProvider>,
  );
}

describe("GlobalSettingsActivity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.stubGlobal("matchMedia", createMatchMedia(false));
  });

  it("renders Preferences with English language and Light theme by default", () => {
    renderGlobalSettings();

    expect(
      screen.getByRole("navigation", { name: "Global Settings menu" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preferences" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "Preferences" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("persists Dark theme and applies it to the document root", async () => {
    const user = userEvent.setup();
    renderGlobalSettings();

    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
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

    await user.click(screen.getByRole("button", { name: "System" }));

    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem("redwhisk.theme")).toBe("system");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("switches Preferences labels to Chinese immediately", async () => {
    const user = userEvent.setup();
    renderGlobalSettings();

    await user.click(screen.getByRole("button", { name: "中文" }));

    expect(
      screen.getByRole("heading", { name: "偏好设置" }),
    ).toBeInTheDocument();
    expect(screen.getByText("语言")).toBeInTheDocument();
    expect(screen.getByText("主题")).toBeInTheDocument();
    expect(window.localStorage.getItem("redwhisk.locale")).toBe("zh");
  });

  it("uses the shared sidebar width by default", () => {
    renderGlobalSettings();

    const splitter = screen.getByRole("separator", {
      name: "Resize settings menu",
    });

    expect(splitter).toHaveAttribute("aria-valuemin", "180");
    expect(splitter).toHaveAttribute("aria-valuemax", "420");
    expect(splitter).toHaveAttribute("aria-valuenow", "230");
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
