import {
  createContext,
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
  themePreference: "light",
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>(getInitialThemePreference);

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
        setThemePreferenceState(nextThemePreference);
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, nextThemePreference);
        } catch {
          // Ignore persistence failures; runtime state still updates.
        }
      },
      themePreference,
    }),
    [locale, themePreference],
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
