export type Locale = "zh" | "en";
export type ThemePreference = "light" | "dark" | "system";
export type ContentFontSize = 13 | 14 | 15 | 16 | 18 | 20 | 22;

export const DEFAULT_LOCALE: Locale = "zh";
export const SUPPORTED_LOCALES: Locale[] = ["zh", "en"];

export const LOCALE_STORAGE_KEY = "redwhisk.locale";
export const THEME_STORAGE_KEY = "redwhisk.theme";
export const CONTENT_FONT_SIZE_STORAGE_KEY = "redwhisk.content-font-size";
export const NOTIFICATION_REMINDER_STORAGE_KEY =
  "redwhisk.notification-reminder";

export const CONTENT_FONT_SIZE_OPTIONS = [13, 14, 15, 16, 18, 20, 22] as const;
export const DEFAULT_CONTENT_FONT_SIZE: ContentFontSize = 14;

export function getInitialThemePreference(): ThemePreference {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedTheme) ? storedTheme : "light";
  } catch {
    return "light";
  }
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function getInitialContentFontSize(): ContentFontSize {
  try {
    const storedValue = window.localStorage.getItem(
      CONTENT_FONT_SIZE_STORAGE_KEY,
    );
    const parsed = storedValue === null ? NaN : Number(storedValue);
    return isContentFontSize(parsed) ? parsed : DEFAULT_CONTENT_FONT_SIZE;
  } catch {
    return DEFAULT_CONTENT_FONT_SIZE;
  }
}

function isContentFontSize(value: number): value is ContentFontSize {
  return (CONTENT_FONT_SIZE_OPTIONS as readonly number[]).includes(value);
}

export const DEFAULT_NOTIFICATION_REMINDER = false;

// localStorage 存 "true"/"false" 字符串；非法或缺失回退默认值，避免脏值污染运行态。
export function getInitialNotificationReminder(): boolean {
  try {
    const storedValue = window.localStorage.getItem(
      NOTIFICATION_REMINDER_STORAGE_KEY,
    );
    if (storedValue === "true") {
      return true;
    }
    if (storedValue === "false") {
      return false;
    }
    return DEFAULT_NOTIFICATION_REMINDER;
  } catch {
    return DEFAULT_NOTIFICATION_REMINDER;
  }
}
