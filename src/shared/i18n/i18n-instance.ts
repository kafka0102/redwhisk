import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  type Locale,
} from "./i18n-constants";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export function getDefaultLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return SUPPORTED_LOCALES.includes(stored as Locale)
      ? (stored as Locale)
      : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function changeLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore persistence failure; runtime locale still updates.
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    // 全局默认 en：无 provider 的裸渲染（如部分测试）回退 en，兼容旧行为。
    // 生产首启 zh 由 app.tsx 经 initialLocale={getDefaultLocale()} 显式注入。
    lng: "en",
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
