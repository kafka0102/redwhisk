import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import i18next from "./i18n-instance";
import {
  CONTENT_FONT_SIZE_STORAGE_KEY,
  DEFAULT_CONTENT_FONT_SIZE,
  DEFAULT_NOTIFICATION_REMINDER,
  LOCALE_STORAGE_KEY,
  NOTIFICATION_REMINDER_STORAGE_KEY,
  getInitialContentFontSize,
  getInitialNotificationReminder,
  getInitialThemePreference,
  THEME_STORAGE_KEY,
  type ContentFontSize,
  type Locale,
  type ThemePreference,
} from "./i18n-constants";
import { createMessagesProxy } from "./messages-bridge";
import type { I18nMessages } from "./messages";
import { setAppTheme } from "../commands/app-commands";

interface I18nContextValue {
  t: TFunction;
  i18n: ReturnType<typeof useTranslation>["i18n"];
  messages: I18nMessages;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  theme: "light" | "dark";
  themePreference: ThemePreference;
  setThemePreference: (themePreference: ThemePreference) => void;
  contentFontSize: ContentFontSize;
  setContentFontSize: (size: ContentFontSize) => void;
  notificationReminder: boolean;
  setNotificationReminder: (value: boolean) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  fixedLocale,
  initialLocale,
}: {
  children: ReactNode;
  fixedLocale?: Locale;
  initialLocale?: Locale;
}) {
  // 每实例 locale state：用 useTranslation({lng}) 按实例同步绑定语言，
  // 不依赖/不修改全局 i18next，避免跨用例泄漏与异步生效问题。
  // fixedLocale 锁定不可切换；initialLocale 仅作初值；均未给则默认 en（兼容既有测试）。
  // 生产首启 zh 由 app.tsx 显式传 initialLocale={getDefaultLocale()} 实现。
  const [locale, setLocaleState] = useState<Locale>(
    fixedLocale ?? initialLocale ?? "en",
  );
  const { t, i18n } = useTranslation(undefined, { lng: locale });

  const messages = useMemo(
    () => createMessagesProxy(t),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, t],
  );
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    getInitialThemePreference,
  );
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(
    getSystemTheme,
  );
  const [contentFontSize, setContentFontSizeState] = useState<ContentFontSize>(
    getInitialContentFontSize,
  );
  const [notificationReminder, setNotificationReminderState] = useState(
    getInitialNotificationReminder,
  );
  const theme = themePreference === "system" ? systemTheme : themePreference;

  useEffect(() => {
    if (themePreference !== "system" || !canMatchDarkScheme()) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange(event: MediaQueryListEvent) {
      setSystemTheme(event.matches ? "dark" : "light");
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [themePreference]);

  useEffect(() => {
    window.document.documentElement.dataset.theme = theme;
    void setAppTheme({ theme }).catch(() => {
      // 后端未就绪或同步失败时忽略；theme 下次变化会重试。
    });
  }, [theme]);

  useEffect(() => {
    window.document.documentElement.style.setProperty(
      "--content-font-size",
      `${contentFontSize}px`,
    );
  }, [contentFontSize]);

  const value = useMemo<I18nContextValue>(
    () => ({
      t,
      i18n,
      messages,
      locale,
      setLocale(nextLocale) {
        if (fixedLocale) {
          return;
        }
        setLocaleState(nextLocale);
        try {
          window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
        } catch {
          // Ignore persistence failures; runtime locale still updates.
        }
      },
      theme,
      themePreference,
      setThemePreference(nextThemePreference) {
        if (nextThemePreference === "system") {
          setSystemTheme(getSystemTheme());
        }
        setThemePreferenceState(nextThemePreference);
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, nextThemePreference);
        } catch {
          // Ignore persistence failures; runtime state still updates.
        }
      },
      contentFontSize,
      setContentFontSize(nextContentFontSize) {
        setContentFontSizeState(nextContentFontSize);
        try {
          window.localStorage.setItem(
            CONTENT_FONT_SIZE_STORAGE_KEY,
            String(nextContentFontSize),
          );
        } catch {
          // Ignore persistence failures; runtime state still updates.
        }
      },
      notificationReminder,
      setNotificationReminder(nextNotificationReminder) {
        setNotificationReminderState(nextNotificationReminder);
        try {
          window.localStorage.setItem(
            NOTIFICATION_REMINDER_STORAGE_KEY,
            String(nextNotificationReminder),
          );
        } catch {
          // Ignore persistence failures; runtime state still updates.
        }
      },
    }),
    [
      t,
      i18n,
      messages,
      theme,
      themePreference,
      contentFontSize,
      notificationReminder,
      locale,
      fixedLocale,
    ],
  );

  return (
    <I18nextProvider i18n={i18next}>
      <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
    </I18nextProvider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  const { t, i18n } = useTranslation();
  const fallback = useMemo<I18nContextValue>(
    () => ({
      t,
      i18n,
      messages: createMessagesProxy(t),
      locale: i18n.language as Locale,
      setLocale() {
        // No provider: ignore in isolated renders.
      },
      theme: "light",
      themePreference: "light",
      setThemePreference() {
        // No provider: ignore in isolated renders.
      },
      contentFontSize: DEFAULT_CONTENT_FONT_SIZE,
      setContentFontSize() {
        // No provider: ignore in isolated renders.
      },
      notificationReminder: DEFAULT_NOTIFICATION_REMINDER,
      setNotificationReminder() {
        // No provider: ignore in isolated renders.
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n.language, t],
  );
  return context ?? fallback;
}

function getSystemTheme(): "light" | "dark" {
  if (!canMatchDarkScheme()) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function canMatchDarkScheme() {
  return (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
  );
}
