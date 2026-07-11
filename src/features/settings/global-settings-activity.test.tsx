import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { GlobalSettingsActivity } from "./global-settings-activity";
import { selectShadcnOption } from "../../test/select-helpers";

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
    document.documentElement.style.removeProperty("--content-font-size");
    vi.stubGlobal("matchMedia", createMatchMedia(false));
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--content-font-size");
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
    expect(screen.getByRole("button", { name: "浅色" })).toHaveClass(
      "bg-[var(--color-accent-muted)]",
    );
    expect(screen.getByRole("button", { name: "深色" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "深色" })).not.toHaveClass(
      "bg-[var(--color-accent-muted)]",
    );
    expect(screen.getByRole("button", { name: "跟随系统" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByRole("switch", { name: "启用通知浮窗" })).toBeNull();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("renders the language preference with 简体中文 selected by default", () => {
    renderGlobalSettings();

    expect(screen.getByRole("heading", { name: "语言" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "语言" })).toHaveTextContent(
      "简体中文",
    );
  });

  it("switches the UI language to English from the language preference", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="zh">
        <GlobalSettingsActivity />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading", { name: "语言" })).toBeInTheDocument();
    await selectShadcnOption(user, screen, "语言", "English");

    expect(
      screen.getByRole("heading", { name: "Language" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Language" }),
    ).toHaveTextContent("English");
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

  it("renders the content font size select with the default size", () => {
    renderGlobalSettings();

    expect(
      screen.getByRole("heading", { name: "内容字号" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "内容字号" }),
    ).toHaveTextContent("14");
    expect(screen.getByRole("combobox", { name: "内容字号" })).toHaveClass(
      "w-[200px]",
    );
    expect(
      document.documentElement.style.getPropertyValue("--content-font-size"),
    ).toBe("14px");
  });

  it("persists the selected content font size and applies it to the document root", async () => {
    const user = userEvent.setup();
    renderGlobalSettings();

    await selectShadcnOption(user, screen, "内容字号", "16");

    expect(
      screen.getByRole("combobox", { name: "内容字号" }),
    ).toHaveTextContent("16");
    expect(window.localStorage.getItem("redwhisk.content-font-size")).toBe(
      "16",
    );
    expect(
      document.documentElement.style.getPropertyValue("--content-font-size"),
    ).toBe("16px");
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
