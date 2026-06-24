import {
  createContext,
  useEffect,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  I18N_MESSAGES,
  LOCALE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  getInitialLocale,
  getInitialThemePreference,
  type I18nMessages,
  type Locale,
  type ThemePreference,
} from "./messages";

interface I18nContextValue {
  locale: Locale;
  messages: I18nMessages;
  setLocale: (locale: Locale) => void;
  setThemePreference: (themePreference: ThemePreference) => void;
  theme: "light" | "dark";
  themePreference: ThemePreference;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const DEFAULT_I18N_CONTEXT: I18nContextValue = {
  locale: "en",
  messages: I18N_MESSAGES.en,
  setLocale() {
    // Components rendered in isolated tests can read English messages without a provider.
  },
  setThemePreference() {
    // Components rendered in isolated tests can read the Light theme without a provider.
  },
  theme: "light",
  themePreference: "light",
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    getInitialThemePreference,
  );
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(
    getSystemTheme,
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
  }, [theme]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      messages: I18N_MESSAGES[locale],
      setLocale(nextLocale) {
        setLocaleState(nextLocale);
        try {
          window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
        } catch {
          // Ignore persistence failures; runtime state still updates.
        }
      },
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
      theme,
      themePreference,
    }),
    [locale, theme, themePreference],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    return DEFAULT_I18N_CONTEXT;
  }

  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(I18nContext);
  if (!context) {
    return DEFAULT_I18N_CONTEXT;
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
