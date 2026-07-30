import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  APP_THEME_PREFERENCE_CHANGED_EVENT,
  setAppTheme,
} from "../commands/app-commands";
import { subscribeTauriEvent } from "../tauri-event/use-tauri-event";
import { I18nProvider, useI18n } from "./i18n-provider";
import { THEME_STORAGE_KEY } from "./i18n-constants";

vi.mock("../commands/app-commands", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../commands/app-commands")>();
  return {
    ...actual,
    setAppTheme: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../tauri-event/use-tauri-event", () => ({
  subscribeTauriEvent: vi.fn(() => () => {}),
}));

const setAppThemeMock = vi.mocked(setAppTheme);
const subscribeTauriEventMock = vi.mocked(subscribeTauriEvent);

function Probe() {
  const { t, locale, themePreference, contentFontSize, setThemePreference } =
    useI18n();
  return (
    <div>
      <span data-testid="probe">
        {t("globalSettings.language")}|{locale}|{themePreference}|
        {contentFontSize}
      </span>
      <button type="button" onClick={() => setThemePreference("dark")}>
        set-dark
      </button>
      <button type="button" onClick={() => setThemePreference("system")}>
        set-system
      </button>
      <button type="button" onClick={() => setThemePreference("light")}>
        set-light
      </button>
    </div>
  );
}

describe("I18nProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    setAppThemeMock.mockClear();
    subscribeTauriEventMock.mockClear();
    subscribeTauriEventMock.mockImplementation(() => () => {});
  });

  it("exposes t and honors an explicit zh locale", () => {
    render(
      <I18nProvider initialLocale="zh">
        <Probe />
      </I18nProvider>,
    );
    const text = screen.getByTestId("probe").textContent ?? "";
    expect(text).toContain("语言");
    expect(text).toContain("zh");
    expect(text).toContain("light");
  });

  it("defaults to en when no locale is provided", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    const text = screen.getByTestId("probe").textContent ?? "";
    expect(text).toContain("Language");
    expect(text).toContain("en");
  });

  it("returns an English fallback when used without a provider", () => {
    function NoProvider() {
      const { t, locale } = useI18n();
      return (
        <span data-testid="bare">
          {t("globalSettings.language")}|{locale}
        </span>
      );
    }
    render(<NoProvider />);
    const text = screen.getByTestId("bare").textContent ?? "";
    // 全局默认 en，裸渲染不崩溃且走英文
    expect(text).toContain("Language");
    expect(text).toContain("en");
  });

  it("syncs preference and resolved theme to backend on local theme change", async () => {
    render(
      <I18nProvider initialLocale="zh">
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(setAppThemeMock).toHaveBeenCalledWith({
        theme: "light",
        themePreference: "light",
      });
    });

    setAppThemeMock.mockClear();
    await act(async () => {
      screen.getByRole("button", { name: "set-dark" }).click();
    });

    await waitFor(() => {
      expect(setAppThemeMock).toHaveBeenCalledWith({
        theme: "dark",
        themePreference: "dark",
      });
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("subscribes to cross-window theme preference events and unsubscribes on unmount", () => {
    const unlisten = vi.fn();
    subscribeTauriEventMock.mockReturnValue(unlisten);

    const { unmount } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(subscribeTauriEventMock).toHaveBeenCalledWith(
      APP_THEME_PREFERENCE_CHANGED_EVENT,
      expect.any(Function),
    );

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("applies remote theme preference without re-invoking setAppTheme", async () => {
    let remoteHandler:
      | ((payload: { themePreference: string }) => void)
      | undefined;
    subscribeTauriEventMock.mockImplementation((_name, handler) => {
      remoteHandler = handler as (payload: { themePreference: string }) => void;
      return () => {};
    });

    render(
      <I18nProvider initialLocale="zh">
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(setAppThemeMock).toHaveBeenCalled();
    });
    setAppThemeMock.mockClear();

    await act(async () => {
      remoteHandler?.({ themePreference: "dark" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).toContain("dark");
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(setAppThemeMock).not.toHaveBeenCalled();
  });

  it("keeps System preference across windows and does not re-emit same value", async () => {
    let remoteHandler:
      | ((payload: { themePreference: string }) => void)
      | undefined;
    subscribeTauriEventMock.mockImplementation((_name, handler) => {
      remoteHandler = handler as (payload: { themePreference: string }) => void;
      return () => {};
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    render(
      <I18nProvider initialLocale="zh">
        <Probe />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(setAppThemeMock).toHaveBeenCalled();
    });
    setAppThemeMock.mockClear();

    await act(async () => {
      remoteHandler?.({ themePreference: "system" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).toContain("system");
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(setAppThemeMock).not.toHaveBeenCalled();

    setAppThemeMock.mockClear();
    await act(async () => {
      remoteHandler?.({ themePreference: "system" });
    });
    expect(setAppThemeMock).not.toHaveBeenCalled();
  });
});
