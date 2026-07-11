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

import i18next, { changeLocale } from "./i18n-instance";
import {
  CONTENT_FONT_SIZE_STORAGE_KEY,
  getInitialContentFontSize,
  getInitialThemePreference,
  THEME_STORAGE_KEY,
  type ContentFontSize,
  type Locale,
  type ThemePreference,
} from "./i18n-constants";

interface I18nContextValue {
  t: TFunction;
  i18n: ReturnType<typeof useTranslation>["i18n"];
  locale: Locale;
  setLocale: (locale: Locale) => void;
  theme: "light" | "dark";
  themePreference: ThemePreference;
  setThemePreference: (themePreference: ThemePreference) => void;
  contentFontSize: ContentFontSize;
  setContentFontSize: (size: ContentFontSize) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>(getInitialThemePreference);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(
    getSystemTheme,
  );
  const [contentFontSize, setContentFontSizeState] =
    useState<ContentFontSize>(getInitialContentFontSize);
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
      locale: i18n.language as Locale,
      setLocale(nextLocale) {
        void changeLocale(nextLocale);
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
    }),
    [t, i18n, theme, themePreference, contentFontSize],
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
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
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
